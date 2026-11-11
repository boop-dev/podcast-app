package dev.boop.podcastapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.audiofx.LoudnessEnhancer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;

/**
 * Owns the single ExoPlayer for the whole app, plus everything that must keep
 * working while the WebView is frozen or gone: position persistence, queue
 * auto-advance bookkeeping and the sleep timer.
 *
 * The JS side talks to it through NativeAudioPlugin; the media session /
 * notification (PlaybackService) wraps the same player. Everything here runs
 * on the main thread.
 *
 * Position/queue changes made while JS cannot run are stored in
 * SharedPreferences and handed over by drain() the next time JS is awake.
 */
public final class AudioController {
    public interface Listener {
        void onChange();
        void onError(String message);

        void onAdSkipped(String id, long startMs, long endMs);
    }

    private static final String PREFS = "native_audio";
    private static final String KEY_DIRTY = "dirty";
    private static final String KEY_CONSUMED = "consumed";
    private static final long SAVE_INTERVAL_MS = 5000;
    private static final String KEY_SKIP_SILENCE = "opt_skip_silence";
    private static final String KEY_BOOST = "opt_boost";
    private static final String KEY_RESUME = "resume";
    private static final String KEY_SKIP_BACK = "opt_skip_back";
    private static final String KEY_SKIP_FORWARD = "opt_skip_forward";
    private static final String KEY_SKIP_AHEAD = "opt_skip_ahead";
    private static final String KEY_SKIP_ADS = "opt_skip_ad_chapters";
    private static final String KEY_RANGES = "skip_ranges";
    private static final long TICK_INTERVAL_MS = 500;
    private static final int MAX_RANGE_EPISODES = 30;
    private static final int BOOST_GAIN_MB = 600; // +6 dB for quiet voices

    private static AudioController instance;

    public static synchronized AudioController get(Context context) {
        if (instance == null) {
            instance = new AudioController(context.getApplicationContext());
        }
        return instance;
    }

    public final ExoPlayer player;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());

    private JSONObject dirty = new JSONObject();      // id -> {positionMs, durationMs, completed}
    private JSONArray consumed = new JSONArray();     // ids that auto-started from the up-next list
    private String lastId = null;
    private int skipBackSec = 15;
    private int skipForwardSec = 30;
    private int skipAheadSec = 60;
    private boolean skipAdChapters = false;
    @Nullable private String lastError = null;
    // episode id -> [startMs, endMs] ranges to skip (ad chapters), oldest first
    private final Map<String, List<long[]>> ranges = new LinkedHashMap<>();
    private boolean skipSilence = false;
    private boolean boost = false;
    @Nullable private LoudnessEnhancer enhancer;
    private long sleepEndsAt = 0;
    private boolean sleepEndOfEpisode = false;
    @Nullable private Listener listener;

    private final Runnable sleepRunnable = new Runnable() {
        @Override
        public void run() {
            sleepEndsAt = 0;
            player.pause();
            notifyChange();
        }
    };

    private final Runnable saveRunnable = new Runnable() {
        @Override
        public void run() {
            saveNow();
            if (player.isPlaying()) main.postDelayed(this, SAVE_INTERVAL_MS);
        }
    };

    // While playing, every half second: skip ad ranges and the per-show outro.
    private final Runnable tickRunnable = new Runnable() {
        @Override
        public void run() {
            tick();
            if (player.isPlaying()) main.postDelayed(this, TICK_INTERVAL_MS);
        }
    };

    private AudioController(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            dirty = new JSONObject(prefs.getString(KEY_DIRTY, "{}"));
            consumed = new JSONArray(prefs.getString(KEY_CONSUMED, "[]"));
        } catch (JSONException ignored) {
        }

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true) // podcast hosts chain http -> https redirects
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(20000)
                .setUserAgent("PodcastApp/1.0 (Android)");

        // Larger buffer than the default: speech at 1x needs little data, and
        // a long buffer rides out brief network drops with the screen off.
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(30_000, 120_000, 2_500, 5_000)
                .build();

        player = new ExoPlayer.Builder(context)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(context, http)))
                .setLoadControl(loadControl)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                        .build(), /* handleAudioFocus= */ true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .setSeekBackIncrementMs(15_000)
                .setSeekForwardIncrementMs(30_000)
                .build();

        skipBackSec = prefs.getInt(KEY_SKIP_BACK, 15);
        skipForwardSec = prefs.getInt(KEY_SKIP_FORWARD, 30);
        skipAheadSec = prefs.getInt(KEY_SKIP_AHEAD, 60);
        skipAdChapters = prefs.getBoolean(KEY_SKIP_ADS, false);
        loadRanges();
        skipSilence = prefs.getBoolean(KEY_SKIP_SILENCE, false);
        boost = prefs.getBoolean(KEY_BOOST, false);
        player.setSkipSilenceEnabled(skipSilence);

        player.addListener(new Player.Listener() {
            @Override
            public void onAudioSessionIdChanged(int audioSessionId) {
                applyBoost();
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                // Each show can have its own playback speed: apply the new item's.
                if (item != null && item.mediaMetadata.extras != null
                        && item.mediaMetadata.extras.containsKey("speed")) {
                    player.setPlaybackSpeed(item.mediaMetadata.extras.getFloat("speed", 1f));
                }
                String newId = item == null ? null : item.mediaId;
                lastError = null;
                // Per-show intro skip when the queue moves on to the next episode by itself.
                if (item != null && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
                        && item.mediaMetadata.extras != null) {
                    long intro = item.mediaMetadata.extras.getLong("introMs", 0);
                    if (intro > 0) player.seekTo(intro);
                }
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO && lastId != null) {
                    recordCompleted(lastId);
                    if (newId != null) consumed.put(newId);
                    persist();
                }
                lastId = newId;
                notifyChange();
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) lastError = null;
                if (state == Player.STATE_ENDED && lastId != null) {
                    recordCompleted(lastId);
                    persist();
                }
                notifyChange();
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    // Sleep timer "end of episode": playback stopped at the end.
                    if (lastId != null) recordCompleted(lastId);
                    sleepEndOfEpisode = false;
                    player.setPauseAtEndOfMediaItems(false);
                    persist();
                }
                notifyChange();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                main.removeCallbacks(saveRunnable);
                main.removeCallbacks(tickRunnable);
                saveNow();
                if (isPlaying) {
                    main.postDelayed(saveRunnable, SAVE_INTERVAL_MS);
                    main.post(tickRunnable);
                }
                notifyChange();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                lastError = errorKind(error);
                if (listener != null) listener.onError(error.getErrorCodeName() + ": " + error.getMessage());
                notifyChange();
            }
        });
    }

    /** (Re)attach the volume booster to the player's current audio session. */
    private void applyBoost() {
        if (enhancer != null) {
            try {
                enhancer.release();
            } catch (RuntimeException ignored) {
            }
            enhancer = null;
        }
        int id = player.getAudioSessionId();
        if (!boost || id == C.AUDIO_SESSION_ID_UNSET || id == 0) return;
        try {
            enhancer = new LoudnessEnhancer(id);
            enhancer.setTargetGain(BOOST_GAIN_MB);
            enhancer.setEnabled(true);
        } catch (RuntimeException e) {
            enhancer = null; // device without the effect: playback is unaffected
        }
    }

    public void setOptions(boolean skipSilence, boolean boost, int backSec, int forwardSec, int aheadSec, boolean skipAds) {
        this.skipSilence = skipSilence;
        this.boost = boost;
        this.skipBackSec = Math.max(1, backSec);
        this.skipForwardSec = Math.max(1, forwardSec);
        this.skipAheadSec = Math.max(1, aheadSec);
        this.skipAdChapters = skipAds;
        prefs.edit().putBoolean(KEY_SKIP_SILENCE, skipSilence).putBoolean(KEY_BOOST, boost)
                .putInt(KEY_SKIP_BACK, this.skipBackSec).putInt(KEY_SKIP_FORWARD, this.skipForwardSec)
                .putInt(KEY_SKIP_AHEAD, this.skipAheadSec).putBoolean(KEY_SKIP_ADS, skipAds).apply();
        player.setSkipSilenceEnabled(skipSilence);
        applyBoost();
    }

    public JSONObject options() {
        JSONObject o = new JSONObject();
        try {
            o.put("skipSilence", skipSilence);
            o.put("boost", boost);
            o.put("skipBackSec", skipBackSec);
            o.put("skipForwardSec", skipForwardSec);
            o.put("skipAheadSec", skipAheadSec);
            o.put("skipAdChapters", skipAdChapters);
        } catch (JSONException ignored) {
        }
        return o;
    }

    public void setListener(@Nullable Listener l) {
        listener = l;
    }

    private void notifyChange() {
        if (listener != null) listener.onChange();
    }

    // --- persistence ------------------------------------------------------

    private void recordCompleted(String id) {
        try {
            dirty.put(id, new JSONObject().put("positionMs", 0).put("durationMs", 0).put("completed", true));
        } catch (JSONException ignored) {
        }
    }

    /** Remember where the current item is, so JS can pick it up later. */
    // --- skipping ---------------------------------------------------------

    public long skipBackMs() {
        return skipBackSec * 1000L;
    }

    public long skipForwardMs() {
        return skipForwardSec * 1000L;
    }

    public void seekBackConfigured() {
        player.seekTo(Math.max(0, player.getCurrentPosition() - skipBackMs()));
    }

    public void seekForwardConfigured() {
        player.seekTo(player.getCurrentPosition() + skipForwardMs());
    }

    /** Finish the current episode now: mark it played and move on (or end). */
    private void skipToEnd() {
        if (lastId != null) recordCompleted(lastId);
        if (player.hasNextMediaItem()) {
            int next = player.getNextMediaItemIndex();
            if (next != C.INDEX_UNSET) consumed.put(player.getMediaItemAt(next).mediaId);
            persist();
            player.seekToNextMediaItem();
        } else {
            persist();
            long dur = player.getDuration();
            if (dur != C.TIME_UNSET) player.seekTo(dur);
        }
    }

    private void tick() {
        MediaItem item = player.getCurrentMediaItem();
        if (item == null || lastId == null) return;
        long pos = player.getCurrentPosition();
        long dur = player.getDuration();
        if (skipAdChapters) {
            List<long[]> list = ranges.get(lastId);
            if (list != null) {
                for (long[] r : list) {
                    if (pos >= r[0] && pos < r[1] - 400) {
                        String id = lastId;
                        if (dur != C.TIME_UNSET && r[1] >= dur - 1500) skipToEnd();
                        else player.seekTo(r[1]);
                        if (listener != null) listener.onAdSkipped(id, r[0], r[1]);
                        return;
                    }
                }
            }
        }
        long outro = item.mediaMetadata.extras == null ? 0 : item.mediaMetadata.extras.getLong("outroMs", 0);
        if (outro > 0 && dur != C.TIME_UNSET && dur > outro && pos >= dur - outro) skipToEnd();
    }

    /** Ranges to skip for an episode (ad chapters). An empty array clears them. */
    public void setSkipRanges(String id, JSONArray arr) throws JSONException {
        List<long[]> list = new ArrayList<>();
        for (int i = 0; arr != null && i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            long s = o.getLong("startMs");
            long e = o.getLong("endMs");
            if (e > s) list.add(new long[]{s, e});
        }
        ranges.remove(id);
        if (!list.isEmpty()) ranges.put(id, list);
        while (ranges.size() > MAX_RANGE_EPISODES) {
            Iterator<String> it = ranges.keySet().iterator();
            it.next();
            it.remove();
        }
        JSONObject out = new JSONObject();
        for (Map.Entry<String, List<long[]>> en : ranges.entrySet()) {
            JSONArray rs = new JSONArray();
            for (long[] r : en.getValue()) rs.put(new JSONArray().put(r[0]).put(r[1]));
            out.put(en.getKey(), rs);
        }
        prefs.edit().putString(KEY_RANGES, out.toString()).apply();
    }

    private void loadRanges() {
        try {
            JSONObject o = new JSONObject(prefs.getString(KEY_RANGES, "{}"));
            JSONArray names = o.names();
            for (int i = 0; names != null && i < names.length(); i++) {
                String id = names.getString(i);
                JSONArray rs = o.getJSONArray(id);
                List<long[]> list = new ArrayList<>();
                for (int j = 0; j < rs.length(); j++) {
                    JSONArray r = rs.getJSONArray(j);
                    list.add(new long[]{r.getLong(0), r.getLong(1)});
                }
                ranges.put(id, list);
            }
        } catch (JSONException ignored) {
        }
    }

    /** Playback failed: try the current item again. */
    public void retry() {
        lastError = null;
        player.prepare();
        player.play();
        notifyChange();
    }

    private static String errorKind(PlaybackException e) {
        switch (e.errorCode) {
            case PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED:
            case PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT:
                return "network";
            case PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS:
            case PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND:
            case PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE:
            case PlaybackException.ERROR_CODE_IO_NO_PERMISSION:
                return "unavailable";
            case PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED:
            case PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED:
            case PlaybackException.ERROR_CODE_DECODER_INIT_FAILED:
            case PlaybackException.ERROR_CODE_DECODING_FAILED:
            case PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED:
            case PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED:
                return "unsupported";
            default:
                return "unknown";
        }
    }

    /** Persist the playlist + position so a headset/Bluetooth play can restart it after the process died. */
    private void persistResume() {
        int n = player.getMediaItemCount();
        if (n == 0 || player.getPlaybackState() == Player.STATE_ENDED) return;
        try {
            JSONArray items = new JSONArray();
            for (int i = 0; i < n; i++) {
                MediaItem it = player.getMediaItemAt(i);
                MediaMetadata m = it.mediaMetadata;
                items.put(new JSONObject()
                        .put("id", it.mediaId)
                        .put("url", it.localConfiguration == null ? "" : it.localConfiguration.uri.toString())
                        .put("title", m.title == null ? "" : m.title.toString())
                        .put("artist", m.artist == null ? "" : m.artist.toString())
                        .put("artwork", m.artworkUri == null ? "" : m.artworkUri.toString())
                        .put("speed", m.extras == null ? 1.0 : m.extras.getFloat("speed", 1f))
                        .put("introMs", m.extras == null ? 0 : m.extras.getLong("introMs", 0))
                        .put("outroMs", m.extras == null ? 0 : m.extras.getLong("outroMs", 0)));
            }
            prefs.edit().putString(KEY_RESUME, new JSONObject()
                    .put("items", items)
                    .put("index", player.getCurrentMediaItemIndex())
                    .put("positionMs", player.getCurrentPosition()).toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    /** The playlist to restore, or null if there is nothing to resume. */
    @Nullable
    public JSONObject resumeData() {
        String s = prefs.getString(KEY_RESUME, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    public void saveNow() {
        persistResume();
        if (lastId == null || player.getMediaItemCount() == 0) return;
        long pos = player.getCurrentPosition();
        long dur = player.getDuration();
        if (dur == C.TIME_UNSET) dur = 0;
        try {
            JSONObject existing = dirty.optJSONObject(lastId);
            if (existing != null && existing.optBoolean("completed")) return; // finished: keep that
            boolean done = dur > 0 && pos >= dur - 2000;
            dirty.put(lastId, new JSONObject()
                    .put("positionMs", done ? 0 : pos)
                    .put("durationMs", dur)
                    .put("completed", done));
        } catch (JSONException ignored) {
        }
        persist();
    }

    private void persist() {
        prefs.edit().putString(KEY_DIRTY, dirty.toString()).putString(KEY_CONSUMED, consumed.toString()).apply();
    }

    /** Hand everything recorded since the last drain to JS, and clear it. */
    public JSONObject drain() {
        saveNow();
        JSONObject out = new JSONObject();
        try {
            JSONArray positions = new JSONArray();
            JSONArray names = dirty.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String id = names.getString(i);
                    JSONObject o = dirty.getJSONObject(id);
                    positions.put(new JSONObject()
                            .put("id", id)
                            .put("positionMs", o.optLong("positionMs"))
                            .put("durationMs", o.optLong("durationMs"))
                            .put("completed", o.optBoolean("completed")));
                }
            }
            out.put("positions", positions);
            out.put("consumed", consumed);
        } catch (JSONException ignored) {
        }
        dirty = new JSONObject();
        consumed = new JSONArray();
        persist();
        return out;
    }

    // --- playback ---------------------------------------------------------

    public static MediaItem buildItem(JSONObject o) throws JSONException {
        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .setTitle(o.optString("title"))
                .setArtist(o.optString("artist"))
                .setAlbumTitle(o.optString("artist"));
        String art = o.optString("artwork", "");
        if (!art.isEmpty() && art.startsWith("http")) meta.setArtworkUri(Uri.parse(art));
        Bundle extras = new Bundle();
        extras.putFloat("speed", (float) o.optDouble("speed", 1.0));
        extras.putLong("introMs", o.optLong("introMs", 0));
        extras.putLong("outroMs", o.optLong("outroMs", 0));
        meta.setExtras(extras);
        return new MediaItem.Builder()
                .setMediaId(o.getString("id"))
                .setUri(Uri.parse(o.getString("url")))
                .setMediaMetadata(meta.build())
                .build();
    }

    public void load(JSONObject current, List<MediaItem> upNext, long startMs, boolean autoplay, float speed)
            throws JSONException {
        saveNow(); // keep the outgoing episode's position
        List<MediaItem> items = new ArrayList<>();
        items.add(buildItem(current));
        items.addAll(upNext);
        sleepEndOfEpisode = false;
        lastError = null;
        player.setPauseAtEndOfMediaItems(false);
        lastId = current.getString("id");
        player.setMediaItems(items, 0, Math.max(startMs, 0));
        player.setPlaybackParameters(new PlaybackParameters(speed));
        player.prepare();
        player.setPlayWhenReady(autoplay);
    }

    /** Replace everything after the current item. */
    public void setUpNext(List<MediaItem> upNext) {
        int count = player.getMediaItemCount();
        if (count == 0) return;
        int cur = player.getCurrentMediaItemIndex();
        if (cur + 1 < count) player.removeMediaItems(cur + 1, count);
        if (!upNext.isEmpty()) player.addMediaItems(upNext);
    }

    public void setSleep(int minutes, boolean endOfEpisode) {
        main.removeCallbacks(sleepRunnable);
        sleepEndsAt = 0;
        sleepEndOfEpisode = false;
        player.setPauseAtEndOfMediaItems(false);
        if (endOfEpisode) {
            sleepEndOfEpisode = true;
            player.setPauseAtEndOfMediaItems(true);
        } else if (minutes > 0) {
            long ms = minutes * 60_000L;
            sleepEndsAt = System.currentTimeMillis() + ms;
            main.postDelayed(sleepRunnable, ms);
        }
        notifyChange();
    }

    public JSONObject state() {
        JSONObject o = new JSONObject();
        try {
            long dur = player.getDuration();
            String st;
            switch (player.getPlaybackState()) {
                case Player.STATE_BUFFERING: st = "buffering"; break;
                case Player.STATE_READY: st = "ready"; break;
                case Player.STATE_ENDED: st = "ended"; break;
                default: st = "idle";
            }
            o.put("hasMedia", player.getMediaItemCount() > 0);
            o.put("currentId", lastId == null ? JSONObject.NULL : lastId);
            o.put("playing", player.isPlaying());
            o.put("playWhenReady", player.getPlayWhenReady());
            o.put("state", st);
            o.put("positionMs", player.getCurrentPosition());
            o.put("durationMs", dur == C.TIME_UNSET ? 0 : dur);
            o.put("speed", player.getPlaybackParameters().speed);
            o.put("sleepEndsAt", sleepEndsAt);
            o.put("error", lastError == null ? JSONObject.NULL : lastError);
            o.put("skipAdChapters", skipAdChapters);
            o.put("sleepEndOfEpisode", sleepEndOfEpisode);
        } catch (JSONException ignored) {
        }
        return o;
    }
}

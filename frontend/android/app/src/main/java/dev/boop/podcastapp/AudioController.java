package dev.boop.podcastapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
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
    private static final String KEY_LISTENED = "listened";
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
    private static final String KEY_SLEEP_SHAKE = "opt_sleep_shake";
    private static final long SLEEP_FADE_MS = 20_000;     // volume ramps down over the last 20 s
    private static final long SHAKE_WINDOW_MS = 60_000;   // a shake only counts in the last minute
    private static final long SLEEP_EXTEND_MS = 5 * 60_000L;
    private static final double SHAKE_THRESHOLD_G = 2.6;

    private static AudioController instance;

    public static synchronized AudioController get(Context context) {
        if (instance == null) {
            instance = new AudioController(context.getApplicationContext());
        }
        return instance;
    }

    public final ExoPlayer player;
    private final Context appContext;
    private final SharedPreferences prefs;
    private boolean sleepShake = true;
    @Nullable private String chaptersId = null;   // episode the chapter list below belongs to
    private long[] chapterStarts = new long[0];
    private String[] chapterTitles = new String[0];
    private int shownChapter = -2;                // chapter index currently in the notification
    private boolean shaking = false;
    private final Handler main = new Handler(Looper.getMainLooper());

    private JSONObject dirty = new JSONObject();      // id -> {positionMs, durationMs, completed}
    private JSONArray consumed = new JSONArray();     // ids that auto-started from the up-next list
    private JSONObject listened = new JSONObject();   // id -> ms played since the last drain (stats)
    private long playingSince = 0;                    // wall-clock start of the current play stretch, 0 if paused
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

    // Timed sleep timer: ticks once a second, fades the volume out over the last
    // SLEEP_FADE_MS, listens for a shake in the last SHAKE_WINDOW_MS, then pauses.
    private final Runnable sleepRunnable = new Runnable() {
        @Override
        public void run() {
            if (sleepEndsAt == 0) return;
            long left = sleepEndsAt - System.currentTimeMillis();
            if (left <= 0) {
                sleepEndsAt = 0;
                stopShakeDetection();
                player.pause();
                player.setVolume(1f); // restore for the next time the user presses play
                notifyChange();
                return;
            }
            if (left <= SHAKE_WINDOW_MS && sleepShake) startShakeDetection();
            if (left <= SLEEP_FADE_MS) player.setVolume(Math.max(0.05f, (float) left / SLEEP_FADE_MS));
            main.postDelayed(this, left > SLEEP_FADE_MS ? Math.min(1000, left - SLEEP_FADE_MS) : 250);
        }
    };

    private final SensorEventListener shakeListener = new SensorEventListener() {
        private long firstJoltAt = 0;
        private long lastExtendAt = 0;

        @Override
        public void onSensorChanged(SensorEvent e) {
            double g = Math.sqrt(e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2])
                    / SensorManager.GRAVITY_EARTH;
            if (g < SHAKE_THRESHOLD_G) return;
            long now = System.currentTimeMillis();
            if (now - lastExtendAt < 1500) return;
            if (now - firstJoltAt > 900) { // first jolt: wait for a second one so a single bump does nothing
                firstJoltAt = now;
                return;
            }
            if (now - firstJoltAt < 120) return; // same jolt seen twice
            firstJoltAt = 0;
            lastExtendAt = now;
            extendSleep();
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
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
        appContext = context;
        prefs =context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            dirty = new JSONObject(prefs.getString(KEY_DIRTY, "{}"));
            consumed = new JSONArray(prefs.getString(KEY_CONSUMED, "[]"));
            listened = new JSONObject(prefs.getString(KEY_LISTENED, "{}"));
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
        sleepShake = prefs.getBoolean(KEY_SLEEP_SHAKE, true);
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
                // A chapter-title refresh swaps the item's metadata in place: nothing else changed.
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED && item != null
                        && item.mediaMetadata.extras != null && item.mediaMetadata.extras.getBoolean("refresh")) {
                    return;
                }
                accumulateListening(); // credit the outgoing episode before lastId changes
                shownChapter = -2;
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

    public void setOptions(boolean skipSilence, boolean boost, int backSec, int forwardSec, int aheadSec, boolean skipAds,
                           boolean sleepShake) {
        this.sleepShake = sleepShake;
        if (!sleepShake) stopShakeDetection();
        this.skipSilence = skipSilence;
        this.boost = boost;
        this.skipBackSec = Math.max(1, backSec);
        this.skipForwardSec = Math.max(1, forwardSec);
        this.skipAheadSec = Math.max(1, aheadSec);
        this.skipAdChapters = skipAds;
        prefs.edit().putBoolean(KEY_SKIP_SILENCE, skipSilence).putBoolean(KEY_BOOST, boost)
                .putInt(KEY_SKIP_BACK, this.skipBackSec).putInt(KEY_SKIP_FORWARD, this.skipForwardSec)
                .putInt(KEY_SKIP_AHEAD, this.skipAheadSec).putBoolean(KEY_SKIP_ADS, skipAds)
                .putBoolean(KEY_SLEEP_SHAKE, sleepShake).apply();
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
            o.put("sleepShake", sleepShake);
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

    /** The long jump (e.g. past an ad), from the notification or a headset double-press. */
    public void seekAheadConfigured() {
        long target = player.getCurrentPosition() + skipAheadSec * 1000L;
        long dur = player.getDuration();
        if (dur != C.TIME_UNSET) target = Math.min(target, dur);
        player.seekTo(target);
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

    /** Chapter starts (ms) and titles for the episode that is loaded; set by JS once it has them. */
    public void setChapters(String id, JSONArray arr) throws JSONException {
        chaptersId = id;
        chapterStarts = new long[arr == null ? 0 : arr.length()];
        chapterTitles = new String[chapterStarts.length];
        for (int i = 0; i < chapterStarts.length; i++) {
            JSONObject o = arr.getJSONObject(i);
            chapterStarts[i] = o.getLong("startMs");
            chapterTitles[i] = o.optString("title", "");
        }
        shownChapter = -2; // force a refresh on the next look
        MediaItem item = player.getCurrentMediaItem();
        if (item != null) showChapter(item, player.getCurrentPosition());
    }

    /**
     * Put the current chapter's title in the notification / lock-screen card, by
     * swapping the item's artist line. ExoPlayer treats a metadata-only change as
     * an in-place update, so playback is not interrupted.
     */
    private void showChapter(MediaItem item, long pos) {
        if (chaptersId == null || !chaptersId.equals(item.mediaId)) return;
        int idx = -1;
        for (int i = 0; i < chapterStarts.length; i++) if (chapterStarts[i] <= pos) idx = i;
        if (idx == shownChapter) return;
        shownChapter = idx;
        Bundle extras = item.mediaMetadata.extras == null ? new Bundle() : new Bundle(item.mediaMetadata.extras);
        String base = extras.getString("baseArtist", item.mediaMetadata.artist == null ? "" : item.mediaMetadata.artist.toString());
        String title = idx >= 0 ? chapterTitles[idx] : "";
        extras.putBoolean("refresh", true); // lets onMediaItemTransition ignore this metadata-only update
        MediaItem updated = item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon()
                .setArtist(title.isEmpty() ? base : title + " · " + base)
                .setExtras(extras).build()).build();
        player.replaceMediaItem(player.getCurrentMediaItemIndex(), updated);
    }

    private void tick() {
        MediaItem item = player.getCurrentMediaItem();
        if (item == null || lastId == null) return;
        long pos = player.getCurrentPosition();
        long dur = player.getDuration();
        showChapter(item, pos);
        item = player.getCurrentMediaItem(); // may have just been refreshed
        if (item == null) return;
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
                        .put("artist", m.extras != null && m.extras.containsKey("baseArtist")
                                ? m.extras.getString("baseArtist", "") // not the chapter-decorated line
                                : m.artist == null ? "" : m.artist.toString())
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

    /**
     * Listening stats: add the wall-clock time the current episode has been playing since the
     * last call. Called at every save and before the current item changes, so it is exact
     * even while the WebView is frozen. JS collects it with drain().
     */
    private void accumulateListening() {
        long now = System.currentTimeMillis();
        if (playingSince > 0 && lastId != null) {
            long delta = Math.min(now - playingSince, 120_000); // a stalled timer must not invent hours
            if (delta > 0) {
                try {
                    listened.put(lastId, listened.optLong(lastId, 0) + delta);
                } catch (JSONException ignored) {
                }
            }
        }
        playingSince = player.isPlaying() ? now : 0;
    }

    public void saveNow() {
        accumulateListening();
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
        prefs.edit().putString(KEY_DIRTY, dirty.toString()).putString(KEY_CONSUMED, consumed.toString())
                .putString(KEY_LISTENED, listened.toString()).apply();
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
            JSONArray heard = new JSONArray();
            JSONArray ids = listened.names();
            for (int i = 0; ids != null && i < ids.length(); i++) {
                heard.put(new JSONObject().put("id", ids.getString(i)).put("ms", listened.optLong(ids.getString(i))));
            }
            out.put("listened", heard);
        } catch (JSONException ignored) {
        }
        dirty = new JSONObject();
        consumed = new JSONArray();
        listened = new JSONObject();
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
        extras.putString("baseArtist", o.optString("artist"));
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
        stopShakeDetection();
        player.setVolume(1f); // cancelling mid-fade must bring the volume back
        sleepEndsAt = 0;
        sleepEndOfEpisode = false;
        player.setPauseAtEndOfMediaItems(false);
        if (endOfEpisode) {
            sleepEndOfEpisode = true;
            player.setPauseAtEndOfMediaItems(true);
        } else if (minutes > 0) {
            sleepEndsAt = System.currentTimeMillis() + minutes * 60_000L;
            main.post(sleepRunnable);
        }
        notifyChange();
    }

    /** Shake in the last minute of the timer: add more time and undo the fade. */
    private void extendSleep() {
        if (sleepEndsAt == 0) return;
        sleepEndsAt += SLEEP_EXTEND_MS;
        player.setVolume(1f);
        stopShakeDetection(); // sleepRunnable re-arms it when the last minute comes round again
        main.removeCallbacks(sleepRunnable);
        main.post(sleepRunnable);
        notifyChange();
    }

    private void startShakeDetection() {
        if (shaking) return;
        SensorManager sm = (SensorManager) appContext.getSystemService(Context.SENSOR_SERVICE);
        Sensor accel = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (accel == null) return; // no accelerometer: the timer just works without shake
        shaking = sm.registerListener(shakeListener, accel, SensorManager.SENSOR_DELAY_UI);
    }

    private void stopShakeDetection() {
        if (!shaking) return;
        SensorManager sm = (SensorManager) appContext.getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) sm.unregisterListener(shakeListener);
        shaking = false;
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

package dev.boop.podcastapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
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
    }

    private static final String PREFS = "native_audio";
    private static final String KEY_DIRTY = "dirty";
    private static final String KEY_CONSUMED = "consumed";
    private static final long SAVE_INTERVAL_MS = 5000;

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

        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                String newId = item == null ? null : item.mediaId;
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
                saveNow();
                if (isPlaying) main.postDelayed(saveRunnable, SAVE_INTERVAL_MS);
                notifyChange();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (listener != null) listener.onError(error.getErrorCodeName() + ": " + error.getMessage());
                notifyChange();
            }
        });
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
    public void saveNow() {
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
            o.put("sleepEndOfEpisode", sleepEndOfEpisode);
        } catch (JSONException ignored) {
        }
        return o;
    }
}

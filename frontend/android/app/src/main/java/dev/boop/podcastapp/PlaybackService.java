package dev.boop.podcastapp;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;

import androidx.annotation.Nullable;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.CommandButton;
import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaLibraryService;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;

import com.google.common.collect.ImmutableList;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

/**
 * Foreground media service: wraps the shared ExoPlayer in a MediaSession, which
 * gives the notification, lock-screen controls, headset buttons and Bluetooth
 * metadata. Playback lives here, not in the WebView, so it keeps working when
 * the WebView is frozen or the Activity is gone.
 */
public class PlaybackService extends MediaLibraryService {
    private static final SessionCommand SEEK_BACK = new SessionCommand("podcast.seek_back", Bundle.EMPTY);
    private static final SessionCommand SEEK_FORWARD = new SessionCommand("podcast.seek_forward", Bundle.EMPTY);
    private static final SessionCommand SKIP_AHEAD = new SessionCommand("podcast.skip_ahead", Bundle.EMPTY);

    // A paused player stays a foreground service (so Android does not kill the
    // idle service, and with it the notification and lock-screen controls) for
    // this long; after that the service stops and the next play restarts it.
    private static final long PAUSED_KEEPALIVE_MS = 30 * 60 * 1000L;

    private MediaLibraryService.MediaLibrarySession session;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable stopWhenIdle = new Runnable() {
        @Override
        public void run() {
            AudioController.get(PlaybackService.this).saveNow();
            pauseAllPlayersAndStopSelf();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        AudioController controller = AudioController.get(this);

        // Podcasts want -15s / +30s, not previous/next track: hide those commands
        // so the notification shows the custom skip buttons instead.
        Player player = new ForwardingPlayer(controller.player) {
            @Override
            public Commands getAvailableCommands() {
                return super.getAvailableCommands().buildUpon()
                        .removeAll(COMMAND_SEEK_TO_NEXT, COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                                COMMAND_SEEK_TO_PREVIOUS, COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .build();
            }

            @Override
            public boolean isCommandAvailable(int command) {
                return getAvailableCommands().contains(command);
            }

            // The skip amounts are user settings, so seeks go through the controller.
            @Override
            public void seekBack() {
                controller.seekBackConfigured();
            }

            @Override
            public void seekForward() {
                controller.seekForwardConfigured();
            }

            @Override
            public long getSeekBackIncrement() {
                return controller.skipBackMs();
            }

            @Override
            public long getSeekForwardIncrement() {
                return controller.skipForwardMs();
            }
        };

        CommandButton back = new CommandButton.Builder()
                .setDisplayName("Back 15 seconds")
                .setIconResId(R.drawable.ic_seek_back_15)
                .setSessionCommand(SEEK_BACK)
                .build();
        CommandButton forward = new CommandButton.Builder()
                .setDisplayName("Forward 30 seconds")
                .setIconResId(R.drawable.ic_seek_forward_30)
                .setSessionCommand(SEEK_FORWARD)
                .build();

        CommandButton ahead = new CommandButton.Builder()
                .setDisplayName("Skip ahead")
                .setIconResId(R.drawable.ic_skip_ahead)
                .setSessionCommand(SKIP_AHEAD)
                .build();

        PendingIntent open = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        controller.player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                handler.removeCallbacks(stopWhenIdle);
                if (!isPlaying) handler.postDelayed(stopWhenIdle, PAUSED_KEEPALIVE_MS);
            }
        });

        session = new MediaLibraryService.MediaLibrarySession.Builder(this, player, new MediaLibraryService.MediaLibrarySession.Callback() {
                    @Override
                    public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo controllerInfo) {
                        // The library commands (get root / children / search) must be granted too, or a
                        // browser such as Android Auto is refused when it asks for the root.
                        SessionCommands commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
                                .add(SEEK_BACK).add(SEEK_FORWARD).add(SKIP_AHEAD).build();
                        return MediaSession.ConnectionResult.accept(commands, MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS);
                    }

                    // Headset gesture: a double-press sends "next" (and some remotes send
                    // fast-forward). Next is hidden for podcasts, so use it as the long skip.
                    @Override
                    public boolean onMediaButtonEvent(MediaSession s, MediaSession.ControllerInfo controllerInfo, Intent intent) {
                        KeyEvent key = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                        if (key == null) return false;
                        int code = key.getKeyCode();
                        if (code != KeyEvent.KEYCODE_MEDIA_NEXT && code != KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) return false;
                        if (key.getAction() == KeyEvent.ACTION_DOWN && key.getRepeatCount() == 0) controller.seekAheadConfigured();
                        return true; // swallow the up event too
                    }

                    // A headset / Bluetooth / notification play arriving when the player is empty
                    // (process was killed): bring back the last playlist at the saved position.
                    @Override
                    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onPlaybackResumption(
                            MediaSession s, MediaSession.ControllerInfo controllerInfo) {
                        try {
                            JSONObject r = controller.resumeData();
                            if (r == null) throw new IllegalStateException("nothing to resume");
                            JSONArray arr = r.getJSONArray("items");
                            List<MediaItem> items = new ArrayList<>();
                            for (int i = 0; i < arr.length(); i++) items.add(AudioController.buildItem(arr.getJSONObject(i)));
                            return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(
                                    items, r.optInt("index", 0), r.optLong("positionMs", 0)));
                        } catch (Exception e) {
                            return Futures.immediateFailedFuture(e);
                        }
                    }

                    @Override
                    public ListenableFuture<SessionResult> onCustomCommand(MediaSession s, MediaSession.ControllerInfo controllerInfo,
                                                                          SessionCommand command, Bundle args) {
                        if (SEEK_BACK.customAction.equals(command.customAction)) controller.seekBackConfigured();
                        else if (SEEK_FORWARD.customAction.equals(command.customAction)) controller.seekForwardConfigured();
                        else if (SKIP_AHEAD.customAction.equals(command.customAction)) controller.seekAheadConfigured();
                        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                    }

                    // --- Android Auto / media browsers: the library staged by the app ---------

                    @Override
                    public ListenableFuture<LibraryResult<MediaItem>> onGetLibraryRoot(
                            MediaLibraryService.MediaLibrarySession s, MediaSession.ControllerInfo browser,
                            @Nullable MediaLibraryService.LibraryParams params) {
                        return Futures.immediateFuture(LibraryResult.ofItem(
                                LibrarySnapshot.folder(LibrarySnapshot.ROOT, "Podcasts", MediaMetadata.MEDIA_TYPE_FOLDER_MIXED), params));
                    }

                    @Override
                    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetChildren(
                            MediaLibraryService.MediaLibrarySession s, MediaSession.ControllerInfo browser, String parentId,
                            int page, int pageSize, @Nullable MediaLibraryService.LibraryParams params) {
                        Context ctx = PlaybackService.this;
                        ImmutableList.Builder<MediaItem> out = ImmutableList.builder();
                        if (LibrarySnapshot.ROOT.equals(parentId)) {
                            out.add(LibrarySnapshot.folder(LibrarySnapshot.CONTINUE, "Continue listening", MediaMetadata.MEDIA_TYPE_FOLDER_PODCASTS));
                            out.add(LibrarySnapshot.folder(LibrarySnapshot.QUEUE, "Up next", MediaMetadata.MEDIA_TYPE_FOLDER_PODCASTS));
                            out.add(LibrarySnapshot.folder(LibrarySnapshot.SHOWS, "Shows", MediaMetadata.MEDIA_TYPE_FOLDER_PODCASTS));
                        } else if (LibrarySnapshot.SHOWS.equals(parentId)) {
                            for (JSONObject show : LibrarySnapshot.list(ctx, "shows")) out.add(LibrarySnapshot.showItem(show));
                        } else if (LibrarySnapshot.CONTINUE.equals(parentId)) {
                            for (JSONObject e : LibrarySnapshot.list(ctx, "continue")) out.add(LibrarySnapshot.episodeItem(e));
                        } else if (LibrarySnapshot.QUEUE.equals(parentId)) {
                            for (JSONObject e : LibrarySnapshot.list(ctx, "queue")) out.add(LibrarySnapshot.episodeItem(e));
                        } else if (parentId.startsWith(LibrarySnapshot.SHOW_PREFIX)) {
                            for (JSONObject e : LibrarySnapshot.episodesOf(ctx, parentId.substring(LibrarySnapshot.SHOW_PREFIX.length()))) {
                                out.add(LibrarySnapshot.episodeItem(e));
                            }
                        } else {
                            return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
                        }
                        ImmutableList<MediaItem> all = out.build();
                        int from = Math.min(page * pageSize, all.size());
                        int to = Math.min(from + pageSize, all.size());
                        return Futures.immediateFuture(LibraryResult.ofItemList(all.subList(from, to), params));
                    }

                    @Override
                    public ListenableFuture<LibraryResult<MediaItem>> onGetItem(
                            MediaLibraryService.MediaLibrarySession s, MediaSession.ControllerInfo browser, String mediaId) {
                        JSONObject e = LibrarySnapshot.findEpisode(PlaybackService.this, mediaId);
                        if (e == null) return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE));
                        return Futures.immediateFuture(LibraryResult.ofItem(LibrarySnapshot.episodeItem(e), null));
                    }

                    @Override
                    public ListenableFuture<LibraryResult<Void>> onSearch(
                            MediaLibraryService.MediaLibrarySession s, MediaSession.ControllerInfo browser, String query,
                            @Nullable MediaLibraryService.LibraryParams params) {
                        s.notifySearchResultChanged(browser, query, LibrarySnapshot.search(PlaybackService.this, query).size(), params);
                        return Futures.immediateFuture(LibraryResult.ofVoid());
                    }

                    @Override
                    public ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> onGetSearchResult(
                            MediaLibraryService.MediaLibrarySession s, MediaSession.ControllerInfo browser, String query,
                            int page, int pageSize, @Nullable MediaLibraryService.LibraryParams params) {
                        ImmutableList.Builder<MediaItem> out = ImmutableList.builder();
                        for (JSONObject e : LibrarySnapshot.search(PlaybackService.this, query)) out.add(LibrarySnapshot.episodeItem(e));
                        ImmutableList<MediaItem> all = out.build();
                        int from = Math.min(page * pageSize, all.size());
                        return Futures.immediateFuture(LibraryResult.ofItemList(all.subList(from, Math.min(from + pageSize, all.size())), params));
                    }

                    /** Turn what a browser asked to play (an id, or a spoken search) into items that have a URL. */
                    @Override
                    public ListenableFuture<List<MediaItem>> onAddMediaItems(
                            MediaSession s, MediaSession.ControllerInfo controllerInfo, List<MediaItem> mediaItems) {
                        List<MediaItem> resolved = new ArrayList<>();
                        try {
                            for (MediaItem item : mediaItems) {
                                JSONObject e = item.mediaId.isEmpty() ? null : LibrarySnapshot.findEpisode(PlaybackService.this, item.mediaId);
                                if (e == null && item.requestMetadata.searchQuery != null) {
                                    List<JSONObject> hits = LibrarySnapshot.search(PlaybackService.this, item.requestMetadata.searchQuery);
                                    if (!hits.isEmpty()) e = hits.get(0);
                                }
                                if (e != null) resolved.add(AudioController.buildItem(e));
                            }
                        } catch (Exception ex) {
                            return Futures.immediateFailedFuture(ex);
                        }
                        return Futures.immediateFuture(resolved);
                    }

                    /**
                     * Playing from a browser: the chosen episode first, then our Up next queue, starting where
                     * you left off (the freshest position, else the staged one), or after the show's intro skip.
                     */
                    @Override
                    public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onSetMediaItems(
                            MediaSession s, MediaSession.ControllerInfo controllerInfo, List<MediaItem> mediaItems,
                            int startIndex, long startPositionMs) {
                        if (mediaItems.isEmpty()) return Futures.immediateFailedFuture(new IllegalArgumentException("nothing to play"));
                        try {
                            List<MediaItem> resolved = onAddMediaItems(s, controllerInfo, mediaItems).get();
                            if (resolved.isEmpty()) return Futures.immediateFailedFuture(new IllegalArgumentException("not found"));
                            MediaItem first = resolved.get(Math.max(0, Math.min(startIndex, resolved.size() - 1)));
                            controller.saveNow(); // keep the outgoing episode's position
                            List<MediaItem> items = new ArrayList<>();
                            items.add(first);
                            for (JSONObject q : LibrarySnapshot.list(PlaybackService.this, "queue")) {
                                if (!first.mediaId.equals(q.optString("id")) && items.size() < 30) items.add(AudioController.buildItem(q));
                            }
                            JSONObject e = LibrarySnapshot.findEpisode(PlaybackService.this, first.mediaId);
                            long start = controller.dirtyPosition(first.mediaId);
                            if (start < 0 && e != null && !e.optBoolean("played") && e.optLong("positionMs", 0) > 10_000) start = e.optLong("positionMs");
                            if (start < 0) start = e == null ? 0 : e.optLong("introMs", 0);
                            return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(items, 0, start));
                        } catch (Exception ex) {
                            return Futures.immediateFailedFuture(ex);
                        }
                    }
                })
                .setSessionActivity(open)
                .setCustomLayout(ImmutableList.of(back, forward, ahead))
                .build();

        // No MediaController binds to this service (the plugin drives the player
        // directly), so register the session ourselves. Without this Media3 never
        // creates the notification or promotes the service to foreground, and
        // Android stops it as "idle" about a minute after the app is backgrounded.
        addSession(session);
    }

    @Nullable
    @Override
    public MediaLibraryService.MediaLibrarySession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onUpdateNotification(MediaSession session, boolean startInForegroundRequired) {
        // Media3 drops foreground status on pause by default; keep it while an
        // episode is loaded.
        boolean hasMedia = session.getPlayer().getMediaItemCount() > 0;
        super.onUpdateNotification(session, startInForegroundRequired || hasMedia);
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Swiped away from recents: keep going only if something is playing.
        Player p = AudioController.get(this).player;
        if (!p.getPlayWhenReady() || p.getMediaItemCount() == 0) {
            AudioController.get(this).saveNow();
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(stopWhenIdle);
        AudioController.get(this).saveNow();
        if (session != null) {
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}

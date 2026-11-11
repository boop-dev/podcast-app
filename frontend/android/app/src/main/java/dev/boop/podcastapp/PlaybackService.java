package dev.boop.podcastapp;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
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
public class PlaybackService extends MediaSessionService {
    private static final SessionCommand SEEK_BACK = new SessionCommand("podcast.seek_back", Bundle.EMPTY);
    private static final SessionCommand SEEK_FORWARD = new SessionCommand("podcast.seek_forward", Bundle.EMPTY);

    // A paused player stays a foreground service (so Android does not kill the
    // idle service, and with it the notification and lock-screen controls) for
    // this long; after that the service stops and the next play restarts it.
    private static final long PAUSED_KEEPALIVE_MS = 30 * 60 * 1000L;

    private MediaSession session;
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

        session = new MediaSession.Builder(this, player)
                .setSessionActivity(open)
                .setCustomLayout(ImmutableList.of(back, forward))
                .setCallback(new MediaSession.Callback() {
                    @Override
                    public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo controllerInfo) {
                        SessionCommands commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                                .add(SEEK_BACK).add(SEEK_FORWARD).build();
                        return MediaSession.ConnectionResult.accept(commands, MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS);
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
                        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                    }
                })
                .build();

        // No MediaController binds to this service (the plugin drives the player
        // directly), so register the session ourselves. Without this Media3 never
        // creates the notification or promotes the service to foreground, and
        // Android stops it as "idle" about a minute after the app is backgrounded.
        addSession(session);
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
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

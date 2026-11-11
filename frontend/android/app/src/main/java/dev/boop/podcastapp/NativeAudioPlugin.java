package dev.boop.podcastapp;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.MediaItem;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Bridge between the JS player UI and the native ExoPlayer (see AudioController). */
@CapacitorPlugin(
        name = "NativeAudio",
        permissions = {@Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")})
public class NativeAudioPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private AudioController controller;

    @Override
    public void load() {
        controller = AudioController.get(getContext().getApplicationContext());
        controller.setListener(new AudioController.Listener() {
            @Override
            public void onChange() {
                notifyListeners("change", new JSObject());
            }

            @Override
            public void onError(String message) {
                JSObject o = new JSObject();
                o.put("message", message);
                notifyListeners("error", o);
            }

            @Override
            public void onAdSkipped(String id, long startMs, long endMs) {
                JSObject o = new JSObject();
                o.put("id", id);
                o.put("startMs", startMs);
                o.put("endMs", endMs);
                o.put("at", System.currentTimeMillis());
                notifyListeners("adSkipped", o);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        // The Activity is going away; the service keeps playing without JS.
        if (controller != null) controller.setListener(null);
        super.handleOnDestroy();
    }

    private interface Task {
        void run() throws Exception;
    }

    private void onMain(PluginCall call, Task task) {
        main.post(() -> {
            try {
                task.run();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()), e);
            }
        });
    }

    private List<MediaItem> parseItems(JSArray array) throws JSONException {
        List<MediaItem> out = new ArrayList<>();
        if (array == null) return out;
        for (int i = 0; i < array.length(); i++) out.add(AudioController.buildItem(array.getJSONObject(i)));
        return out;
    }

    private void startService() {
        Context ctx = getContext().getApplicationContext();
        // Plain startService from the foreground app; Media3 promotes the
        // service to foreground itself once playback starts.
        ctx.startService(new Intent(ctx, PlaybackService.class));
    }

    @PluginMethod
    public void load(PluginCall call) {
        onMain(call, () -> {
            JSONObject current = call.getObject("item");
            List<MediaItem> upNext = parseItems(call.getArray("upNext"));
            long start = call.getData().optLong("startPositionMs", 0);
            boolean autoplay = call.getBoolean("autoplay", true);
            float speed = call.getFloat("speed", 1f);
            startService();
            controller.load(current, upNext, start, autoplay, speed);
            call.resolve();
        });
    }

    @PluginMethod
    public void setUpNext(PluginCall call) {
        onMain(call, () -> {
            controller.setUpNext(parseItems(call.getArray("items")));
            call.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        onMain(call, () -> {
            startService();
            controller.player.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        onMain(call, () -> {
            controller.player.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        onMain(call, () -> {
            controller.player.seekTo(call.getData().optLong("positionMs", 0));
            call.resolve();
        });
    }

    @PluginMethod
    public void seekBy(PluginCall call) {
        onMain(call, () -> {
            long target = controller.player.getCurrentPosition() + call.getData().optLong("deltaMs", 0);
            controller.player.seekTo(Math.max(0, target));
            call.resolve();
        });
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        onMain(call, () -> {
            controller.player.setPlaybackSpeed(call.getFloat("speed", 1f));
            call.resolve();
        });
    }

    @PluginMethod
    public void setSleep(PluginCall call) {
        onMain(call, () -> {
            controller.setSleep(call.getInt("minutes", 0), call.getBoolean("endOfEpisode", false));
            call.resolve();
        });
    }

    @PluginMethod
    public void setSkipRanges(PluginCall call) {
        onMain(call, () -> {
            controller.setSkipRanges(call.getString("id"), call.getArray("ranges"));
            call.resolve();
        });
    }

    @PluginMethod
    public void setChapters(PluginCall call) {
        onMain(call, () -> {
            controller.setChapters(call.getString("id"), call.getArray("chapters"));
            call.resolve();
        });
    }

    @PluginMethod
    public void retry(PluginCall call) {
        onMain(call, () -> {
            controller.retry();
            call.resolve();
        });
    }

    @PluginMethod
    public void getOptions(PluginCall call) {
        onMain(call, () -> call.resolve(JSObject.fromJSONObject(controller.options())));
    }

    @PluginMethod
    public void setOptions(PluginCall call) {
        onMain(call, () -> {
            controller.setOptions(call.getBoolean("skipSilence", false), call.getBoolean("boost", false),
                    call.getInt("skipBackSec", 15), call.getInt("skipForwardSec", 30),
                    call.getInt("skipAheadSec", 60), call.getBoolean("skipAdChapters", false),
                    call.getBoolean("sleepShake", true));
            call.resolve(JSObject.fromJSONObject(controller.options()));
        });
    }

    // --- background new-episode check ------------------------------------

    private boolean notificationsGranted() {
        return Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (notificationsGranted()) {
            JSObject o = new JSObject();
            o.put("granted", true);
            call.resolve(o);
        } else {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
        }
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", notificationsGranted());
        call.resolve(o);
    }

    @PluginMethod
    public void getFeedWatch(PluginCall call) {
        try {
            JSObject o = JSObject.fromJSONObject(FeedWatch.settings(getContext()));
            o.put("notificationsGranted", notificationsGranted());
            call.resolve(o);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void setFeedWatch(PluginCall call) {
        try {
            FeedWatch.configure(getContext().getApplicationContext(), call.getBoolean("enabled", false),
                    call.getInt("intervalHours", 3), call.getArray("feeds"));
            call.resolve(JSObject.fromJSONObject(FeedWatch.settings(getContext())));
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), e);
        }
    }

    @PluginMethod
    public void checkFeedsNow(PluginCall call) {
        FeedWatch.checkNow(getContext().getApplicationContext());
        call.resolve();
    }

    @PluginMethod
    public void consumeFeedAlerts(PluginCall call) {
        JSObject o = new JSObject();
        o.put("count", FeedWatch.consumeAlerts(getContext()));
        call.resolve(o);
    }

    /** Notification button presses waiting for the app: {queue:[{showId,guid}], play:{showId,guid}|null}. */
    @PluginMethod
    public void consumePendingActions(PluginCall call) {
        android.content.SharedPreferences p = getContext().getSharedPreferences(FeedCheckWorker.PREFS, android.content.Context.MODE_PRIVATE);
        JSObject o = new JSObject();
        try {
            o.put("queue", new org.json.JSONArray(p.getString(NotificationActionReceiver.KEY_PENDING_QUEUE, "[]")));
            String play = p.getString(NotificationActionReceiver.KEY_PENDING_PLAY, null);
            o.put("play", play == null ? org.json.JSONObject.NULL : new org.json.JSONObject(play));
        } catch (Exception ignored) {
        }
        p.edit().remove(NotificationActionReceiver.KEY_PENDING_QUEUE).remove(NotificationActionReceiver.KEY_PENDING_PLAY).apply();
        call.resolve(o);
    }

    /** Files the background worker finished downloading: [{showId, guid, fileName, bytes}]. */
    @PluginMethod
    public void consumeDownloads(PluginCall call) {
        android.content.SharedPreferences p = getContext().getSharedPreferences(FeedCheckWorker.PREFS, android.content.Context.MODE_PRIVATE);
        JSObject o = new JSObject();
        try {
            o.put("downloads", new org.json.JSONArray(p.getString(FeedCheckWorker.KEY_PENDING_DOWNLOADS, "[]")));
        } catch (Exception ignored) {
        }
        p.edit().remove(FeedCheckWorker.KEY_PENDING_DOWNLOADS).apply();
        call.resolve(o);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        onMain(call, () -> call.resolve(JSObject.fromJSONObject(controller.state())));
    }

    @PluginMethod
    public void drain(PluginCall call) {
        onMain(call, () -> call.resolve(JSObject.fromJSONObject(controller.drain())));
    }
}

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
    public void setMarkedRanges(PluginCall call) {
        onMain(call, () -> {
            controller.setMarkedRanges(call.getString("id"), call.getArray("ranges"));
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
            o.put("share", p.getString(NotificationActionReceiver.KEY_PENDING_SHARE, null));
        } catch (Exception ignored) {
        }
        p.edit().remove(NotificationActionReceiver.KEY_PENDING_QUEUE).remove(NotificationActionReceiver.KEY_PENDING_PLAY)
                .remove(NotificationActionReceiver.KEY_PENDING_SHARE).apply();
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

    // --- scheduled backup -----------------------------------------------------

    private JSObject backupSettings() {
        android.content.SharedPreferences p = BackupWorker.prefs(getContext());
        JSObject o = new JSObject();
        o.put("folderName", p.getString(BackupWorker.KEY_FOLDER_NAME, null));
        o.put("hasFolder", p.getString(BackupWorker.KEY_FOLDER_URI, null) != null);
        o.put("enabled", p.getBoolean(BackupWorker.KEY_ENABLED, false));
        o.put("intervalDays", p.getInt(BackupWorker.KEY_INTERVAL_DAYS, 1));
        o.put("lastOkAt", p.getLong(BackupWorker.KEY_LAST_OK, 0));
        o.put("lastError", p.getString(BackupWorker.KEY_LAST_ERROR, null));
        o.put("stagedAt", p.getLong(BackupWorker.KEY_STAGED_AT, 0));
        return o;
    }

    @PluginMethod
    public void getBackupSettings(PluginCall call) {
        call.resolve(backupSettings());
    }

    /** Let the user pick any folder (including a cloud drive's) with the system folder picker. */
    @PluginMethod
    public void pickBackupFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void folderPicked(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null
                || result.getData().getData() == null) {
            call.reject("cancelled");
            return;
        }
        android.net.Uri uri = result.getData().getData();
        getContext().getContentResolver().takePersistableUriPermission(uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        androidx.documentfile.provider.DocumentFile dir =
                androidx.documentfile.provider.DocumentFile.fromTreeUri(getContext(), uri);
        BackupWorker.prefs(getContext()).edit()
                .putString(BackupWorker.KEY_FOLDER_URI, uri.toString())
                .putString(BackupWorker.KEY_FOLDER_NAME, dir != null && dir.getName() != null ? dir.getName() : uri.getLastPathSegment())
                .putBoolean(BackupWorker.KEY_ENABLED, true)
                .remove(BackupWorker.KEY_LAST_ERROR).apply();
        BackupWorker.reschedule(getContext());
        call.resolve(backupSettings());
    }

    @PluginMethod
    public void setBackupSettings(PluginCall call) {
        BackupWorker.prefs(getContext()).edit()
                .putBoolean(BackupWorker.KEY_ENABLED, call.getBoolean("enabled", false))
                .putInt(BackupWorker.KEY_INTERVAL_DAYS, Math.max(1, call.getInt("intervalDays", 1))).apply();
        BackupWorker.reschedule(getContext());
        call.resolve(backupSettings());
    }

    @PluginMethod
    public void clearBackupFolder(PluginCall call) {
        android.content.SharedPreferences p = BackupWorker.prefs(getContext());
        String uri = p.getString(BackupWorker.KEY_FOLDER_URI, null);
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(android.net.Uri.parse(uri),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {
            }
        }
        p.edit().clear().apply();
        BackupWorker.reschedule(getContext());
        call.resolve(backupSettings());
    }

    /** The app hands over its latest backup JSON; the worker copies it to the folder on schedule. */
    @PluginMethod
    public void stageBackup(PluginCall call) {
        String json = call.getString("json");
        if (json == null || json.isEmpty()) {
            call.reject("json is required");
            return;
        }
        try {
            java.io.File dir = getContext().getFilesDir();
            java.io.File tmp = new java.io.File(dir, BackupWorker.STAGED_FILE + ".tmp");
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
                out.write(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            if (!tmp.renameTo(new java.io.File(dir, BackupWorker.STAGED_FILE))) throw new java.io.IOException("rename failed");
            BackupWorker.prefs(getContext()).edit().putLong(BackupWorker.KEY_STAGED_AT, System.currentTimeMillis()).apply();
            call.resolve();
        } catch (java.io.IOException e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void runBackupNow(PluginCall call) {
        BackupWorker.runNow(getContext());
        call.resolve();
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

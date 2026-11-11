package dev.boop.podcastapp;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.MediaItem;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Bridge between the JS player UI and the native ExoPlayer (see AudioController). */
@CapacitorPlugin(name = "NativeAudio")
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
    public void getOptions(PluginCall call) {
        onMain(call, () -> call.resolve(JSObject.fromJSONObject(controller.options())));
    }

    @PluginMethod
    public void setOptions(PluginCall call) {
        onMain(call, () -> {
            controller.setOptions(call.getBoolean("skipSilence", false), call.getBoolean("boost", false));
            call.resolve(JSObject.fromJSONObject(controller.options()));
        });
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

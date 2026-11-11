package dev.boop.podcastapp;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {
    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (non-npm) plugins must be registered before super.onCreate.
        registerPlugin(NativeAudioPlugin.class);
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);
        stashPlayRequest(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        stashPlayRequest(intent);
        pokeJs();
    }

    @Override
    public void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    /**
     * Tell the page that a notification button was pressed. When the app is already on
     * screen nothing else wakes it (no resume event), so without this the press would
     * wait in storage until the next time the app is backgrounded and reopened.
     */
    static void pokeJs() {
        final MainActivity a = current.get();
        if (a == null) return;
        a.runOnUiThread(() -> {
            if (a.getBridge() != null) a.getBridge().triggerWindowJSEvent("notificationaction");
        });
    }

    /** The "Play" button on a new-episode notification: keep the request for the JS side to pick up. */
    private void stashPlayRequest(Intent intent) {
        if (intent == null || intent.getStringExtra("play_guid") == null) return;
        try {
            getSharedPreferences(FeedCheckWorker.PREFS, Context.MODE_PRIVATE).edit()
                    .putString(NotificationActionReceiver.KEY_PENDING_PLAY, new JSONObject()
                            .put("showId", intent.getStringExtra("play_show"))
                            .put("guid", intent.getStringExtra("play_guid")).toString()).apply();
        } catch (Exception ignored) {
        }
        intent.removeExtra("play_guid"); // not again on the next resume
    }
}

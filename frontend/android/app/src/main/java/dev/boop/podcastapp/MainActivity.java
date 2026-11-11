package dev.boop.podcastapp;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (non-npm) plugins must be registered before super.onCreate.
        registerPlugin(NativeAudioPlugin.class);
        super.onCreate(savedInstanceState);
        stashPlayRequest(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        stashPlayRequest(intent);
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

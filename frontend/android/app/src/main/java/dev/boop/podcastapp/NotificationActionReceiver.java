package dev.boop.podcastapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/** "Add to queue" button on a new-episode notification: remember it for the app to apply. */
public class NotificationActionReceiver extends BroadcastReceiver {
    static final String ACTION_QUEUE = "dev.boop.podcastapp.QUEUE_NEW";
    static final String KEY_PENDING_QUEUE = "pending_queue";
    static final String KEY_PENDING_PLAY = "pending_play";
    static final String KEY_PENDING_SHARE = "pending_share"; // text/URL shared to the app, not yet handled

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!ACTION_QUEUE.equals(intent.getAction())) return;
        String showId = intent.getStringExtra("showId");
        String[] guids = intent.getStringArrayExtra("guids");
        if (showId == null || guids == null) return;
        SharedPreferences prefs = ctx.getSharedPreferences(FeedCheckWorker.PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray pending = new JSONArray(prefs.getString(KEY_PENDING_QUEUE, "[]"));
            for (int i = guids.length - 1; i >= 0; i--) { // oldest first, so the queue keeps release order
                pending.put(new JSONObject().put("showId", showId).put("guid", guids[i]));
            }
            prefs.edit().putString(KEY_PENDING_QUEUE, pending.toString()).apply();
        } catch (Exception ignored) {
        }
        NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra("notifId", 0));
        MainActivity.pokeJs(); // if the app is open, apply the queue change now
    }
}

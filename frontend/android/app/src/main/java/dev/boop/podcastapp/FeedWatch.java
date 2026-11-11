package dev.boop.podcastapp;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

/** Configuration + scheduling for the background new-episode check. */
public final class FeedWatch {
    private static final String WORK_NAME = "feed-check";

    private FeedWatch() {
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(FeedCheckWorker.PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject config(Context c) {
        try {
            return new JSONObject(prefs(c).getString(FeedCheckWorker.KEY_CONFIG, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    public static JSONObject settings(Context c) {
        JSONObject cfg = config(c);
        JSONObject out = new JSONObject();
        try {
            out.put("enabled", cfg.optBoolean("enabled", false));
            out.put("intervalHours", cfg.optInt("intervalHours", 3));
            out.put("feeds", cfg.optJSONArray("feeds") == null ? 0 : cfg.optJSONArray("feeds").length());
        } catch (JSONException ignored) {
        }
        return out;
    }

    /** Store the feed list and (re)schedule or cancel the periodic work. */
    public static void configure(Context c, boolean enabled, int intervalHours, JSONArray feeds) throws JSONException {
        JSONObject cfg = new JSONObject();
        cfg.put("enabled", enabled);
        cfg.put("intervalHours", intervalHours);
        cfg.put("feeds", feeds == null ? new JSONArray() : feeds);
        prefs(c).edit().putString(FeedCheckWorker.KEY_CONFIG, cfg.toString()).apply();

        WorkManager wm = WorkManager.getInstance(c);
        if (!enabled) {
            wm.cancelUniqueWork(WORK_NAME);
            return;
        }
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                FeedCheckWorker.class, Math.max(1, intervalHours), TimeUnit.HOURS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build();
        // UPDATE keeps the existing schedule's timing when only the feed list changed.
        wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    public static void checkNow(Context c) {
        WorkManager.getInstance(c).enqueue(new OneTimeWorkRequest.Builder(FeedCheckWorker.class)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build());
    }

    /** New episodes found in the background since the app last asked. Resets to 0. */
    public static int consumeAlerts(Context c) {
        SharedPreferences p = prefs(c);
        int n = p.getInt(FeedCheckWorker.KEY_ALERTS, 0);
        if (n != 0) p.edit().putInt(FeedCheckWorker.KEY_ALERTS, 0).apply();
        return n;
    }
}

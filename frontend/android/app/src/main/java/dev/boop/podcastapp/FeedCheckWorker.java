package dev.boop.podcastapp;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import org.xmlpull.v1.XmlPullParserFactory;

import android.net.ConnectivityManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Periodic background check for new episodes. It only *detects* them and posts
 * a notification: each feed is streamed and the newest few items are compared
 * with the GUIDs the app last knew about. The app itself does the real refresh
 * (and any downloads) the next time it opens.
 *
 * Feed list and known GUIDs are pushed in by the JS side (FeedWatch.configure).
 */
public class FeedCheckWorker extends Worker {
    static final String PREFS = "feed_watch";
    static final String KEY_CONFIG = "config";   // {enabled, intervalHours, feeds:[{id,title,url,known:[]}]}
    static final String KEY_ALERTS = "alerts";   // new episodes found since JS last looked
    static final String CHANNEL = "new_episodes";
    /** Hard ceiling on items read per feed, so a huge back catalogue cannot stall the worker. */
    private static final int ITEMS_TO_CHECK = 300;
    /** Feeds list newest first: after this many already-known items in a row, the rest are old. */
    private static final int KNOWN_RUN_TO_STOP = 3;
    private static final int MAX_KNOWN = 120;

    public FeedCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONObject config = new JSONObject(prefs.getString(KEY_CONFIG, "{}"));
            if (!config.optBoolean("enabled")) return Result.success();
            JSONArray feeds = config.optJSONArray("feeds");
            if (feeds == null) return Result.success();

            int found = 0;
            for (int i = 0; i < feeds.length(); i++) {
                if (isStopped()) return Result.retry();
                JSONObject feed = feeds.getJSONObject(i);
                try {
                    found += checkFeed(ctx, feed);
                } catch (Exception ignored) {
                    // one unreachable feed must not stop the others
                }
            }
            // Persist the updated known-GUID lists so nothing is announced twice.
            prefs.edit().putString(KEY_CONFIG, config.toString())
                    .putInt(KEY_ALERTS, prefs.getInt(KEY_ALERTS, 0) + found).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    /** Returns how many new episodes this feed had; posts a notification if >0. */
    private int checkFeed(Context ctx, JSONObject feed) throws Exception {
        JSONArray knownArr = feed.optJSONArray("known");
        if (knownArr == null || knownArr.length() == 0) return 0; // never baselined: stay quiet
        Set<String> known = new HashSet<>();
        for (int i = 0; i < knownArr.length(); i++) known.add(knownArr.getString(i));

        List<String[]> items = fetchItems(feed.getString("url"), known); // {guid, title}
        List<String[]> fresh = new ArrayList<>();
        for (String[] item : items) if (!known.contains(item[0])) fresh.add(item);
        if (fresh.isEmpty()) return 0;

        // Remember them (newest first), capped.
        JSONArray updated = new JSONArray();
        for (String[] item : fresh) updated.put(item[0]);
        for (int i = 0; i < knownArr.length() && updated.length() < MAX_KNOWN; i++) updated.put(knownArr.getString(i));
        feed.put("known", updated);

        notifyNew(ctx, feed.optString("id"), feed.optString("title", "New episode"), fresh);
        if (feed.optBoolean("autoDownload")) {
            autoDownload(ctx, ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE), feed.optString("id"), fresh);
        }
        return fresh.size();
    }

    private void notifyNew(Context ctx, String showId, String showTitle, List<String[]> fresh) {
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "New episodes", NotificationManager.IMPORTANCE_DEFAULT);
            ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(ctx, 0,
                new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String text = fresh.size() == 1 ? fresh.get(0)[1] : fresh.size() + " new episodes";
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_podcast)
                .setContentTitle(showTitle)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setAutoCancel(true);
        // Play (newest) opens the app and starts it; Queue adds every new one without opening the app.
        Intent play = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("play_show", showId).putExtra("play_guid", fresh.get(0)[0]);
        play.setAction("dev.boop.podcastapp.PLAY_NEW");
        b.addAction(0, "Play", PendingIntent.getActivity(ctx, showId.hashCode() + 1, play,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        String[] guids = new String[Math.min(fresh.size(), 10)];
        for (int i = 0; i < guids.length; i++) guids[i] = fresh.get(i)[0];
        Intent queue = new Intent(ctx, NotificationActionReceiver.class)
                .setAction(NotificationActionReceiver.ACTION_QUEUE)
                .putExtra("showId", showId).putExtra("guids", guids).putExtra("notifId", showId.hashCode());
        b.addAction(0, "Add to queue", PendingIntent.getBroadcast(ctx, showId.hashCode() + 2, queue,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        try {
            NotificationManagerCompat.from(ctx).notify(showId.hashCode(), b.build());
        } catch (SecurityException ignored) {
            // notification permission revoked between the check and the post
        }
    }

    /**
     * Stream a feed and return its items as {guid, title}, newest first. Reading stops
     * once a run of already-known items shows we have caught up, so a burst of new
     * episodes is fully counted without parsing the whole archive.
     */
    static List<String[]> fetchItems(String urlString, Set<String> known) throws Exception {
        HttpURLConnection conn = openFollowingRedirects(urlString, 20000);
        List<String[]> items = new ArrayList<>();
        try (InputStream in = conn.getInputStream()) {
            parseItems(in, known, items);
        } finally {
            conn.disconnect();
        }
        return items;
    }

    /** GET a URL, following http<->https redirects ourselves (HttpURLConnection will not). */
    static HttpURLConnection openFollowingRedirects(String urlString, int readTimeoutMs) throws Exception {
        HttpURLConnection conn = null;
        String current = urlString;
        for (int hop = 0; hop < 6; hop++) { // follow http<->https redirects ourselves
            conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(readTimeoutMs);
            conn.setRequestProperty("User-Agent", "PodcastApp/1.0 (Android)");
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                current = new URL(new URL(current), conn.getHeaderField("Location")).toString();
                conn.disconnect();
                continue;
            }
            if (code < 200 || code >= 300) throw new IllegalStateException("HTTP " + code);
            break;
        }
        return conn;
    }

    private static void parseItems(InputStream in, Set<String> known, List<String[]> items) throws Exception {
        {
            XmlPullParser p = XmlPullParserFactory.newInstance().newPullParser();
            p.setInput(in, null);
            boolean inItem = false;
            String guid = null, link = null, title = null, enclosure = null;
            int knownRun = 0;
            int event = p.getEventType();
            while (event != XmlPullParser.END_DOCUMENT && items.size() < ITEMS_TO_CHECK && knownRun < KNOWN_RUN_TO_STOP) {
                if (event == XmlPullParser.START_TAG) {
                    String name = p.getName();
                    if (name.equals("item") || name.equals("entry")) {
                        inItem = true;
                        guid = link = title = enclosure = null;
                    } else if (inItem) {
                        if (name.equals("guid") || name.equals("id")) guid = p.nextText().trim();
                        else if (name.equals("title") && title == null) title = p.nextText().trim();
                        else if (name.equals("link")) {
                            String href = p.getAttributeValue(null, "href");
                            String text = href != null ? href : p.nextText().trim();
                            if (link == null) link = text;
                        } else if (name.equals("enclosure")) {
                            enclosure = p.getAttributeValue(null, "url");
                        }
                    }
                } else if (event == XmlPullParser.END_TAG && (p.getName().equals("item") || p.getName().equals("entry"))) {
                    inItem = false;
                    String id = firstNonEmpty(guid, link, enclosure); // same fallback order as the JS parser
                    if (id != null) {
                        items.add(new String[]{id, title == null || title.isEmpty() ? "New episode" : title, enclosure});
                        knownRun = known.contains(id) ? knownRun + 1 : 0;
                    }
                }
                event = p.next();
            }
        }
    }

    // --- background download of new episodes ---------------------------------

    static final String KEY_PENDING_DOWNLOADS = "pending_downloads"; // [{showId, guid, fileName, bytes}]
    private static final int AUTO_DOWNLOADS_PER_FEED = 3;

    /** Same FNV-1a hash as episodeIdFor() in src/mobile/store.js, so the app finds the file. */
    static String fnv(String s) {
        int h = 0x811c9dc5;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i);
            h *= 0x01000193;
        }
        return String.format("%08x", h);
    }

    /** Download the newest new episodes of a feed that opted in, on an unmetered network only. */
    private void autoDownload(Context ctx, SharedPreferences prefs, String showId, List<String[]> fresh) {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null || cm.isActiveNetworkMetered()) return;
        int done = 0;
        for (String[] item : fresh) {
            if (done >= AUTO_DOWNLOADS_PER_FEED || isStopped()) break;
            String url = item.length > 2 ? item[2] : null;
            if (url == null || url.isEmpty()) continue;
            Matcher m = Pattern.compile("\\.(mp3|m4a|ogg|wav|aac|flac)$", Pattern.CASE_INSENSITIVE).matcher(url.split("\\?")[0]);
            String name = "ep_" + fnv(showId + "|" + item[0]) + (m.find() ? m.group() : ".mp3");
            File dest = new File(ctx.getFilesDir(), name);
            File part = new File(ctx.getFilesDir(), name + ".part");
            try {
                HttpURLConnection conn = openFollowingRedirects(url, 30000);
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (isStopped()) throw new IllegalStateException("stopped");
                        out.write(buf, 0, n);
                    }
                } finally {
                    conn.disconnect();
                }
                if (!part.renameTo(dest)) throw new IllegalStateException("rename failed");
                JSONArray pending = new JSONArray(prefs.getString(KEY_PENDING_DOWNLOADS, "[]"));
                pending.put(new JSONObject().put("showId", showId).put("guid", item[0])
                        .put("fileName", name).put("bytes", dest.length()));
                prefs.edit().putString(KEY_PENDING_DOWNLOADS, pending.toString()).apply();
                done++;
            } catch (Exception e) {
                part.delete(); // keep no half-written file around
            }
        }
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) if (v != null && !v.isEmpty()) return v;
        return null;
    }
}

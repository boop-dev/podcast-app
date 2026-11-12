package dev.boop.podcastapp;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What Android Auto (and other media browsers) can see of the library. The shows and episodes
 * live in the WebView's IndexedDB, which native code cannot read, so the app stages a snapshot
 * (see src/lib/autoLibrary.js) whenever it is used and this class serves it from a file. The
 * browse tree is: root > Continue listening / Up next / Shows > a show > its episodes.
 *
 * Playable items use the episode id as mediaId; folders use a prefix. Episode JSON fields:
 * id, url, title, artist (show title), artwork, speed, introMs, outroMs, showId, positionMs,
 * durationMs, played.
 */
final class LibrarySnapshot {
    static final String ROOT = "root";
    static final String CONTINUE = "continue";
    static final String QUEUE = "queue";
    static final String SHOWS = "shows";
    static final String SHOW_PREFIX = "show:";
    static final String FILE = "library.json";

    private static JSONObject cache = new JSONObject();
    private static long cacheStamp = -1;

    private LibrarySnapshot() {
    }

    /** The staged library, re-read only when the file changed. Empty when the app never staged one. */
    static synchronized JSONObject get(Context ctx) {
        File f = new File(ctx.getFilesDir(), FILE);
        if (!f.exists()) {
            cache = new JSONObject();
            cacheStamp = -1;
            return cache;
        }
        if (f.lastModified() != cacheStamp) {
            try (FileInputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[32 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                cache = new JSONObject(out.toString("UTF-8"));
                cacheStamp = f.lastModified();
            } catch (Exception e) {
                cache = new JSONObject();
            }
        }
        return cache;
    }

    private static JSONArray arr(Context ctx, String key) {
        JSONArray a = get(ctx).optJSONArray(key);
        return a == null ? new JSONArray() : a;
    }

    static List<JSONObject> list(Context ctx, String key) {
        List<JSONObject> out = new ArrayList<>();
        JSONArray a = arr(ctx, key);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null) out.add(o);
        }
        return out;
    }

    static List<JSONObject> episodesOf(Context ctx, String showId) {
        List<JSONObject> out = new ArrayList<>();
        JSONObject map = get(ctx).optJSONObject("episodes");
        JSONArray a = map == null ? null : map.optJSONArray(showId);
        for (int i = 0; a != null && i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null) out.add(o);
        }
        return out;
    }

    /** An episode by id, from Up next, Continue listening or any show. */
    @Nullable
    static JSONObject findEpisode(Context ctx, String id) {
        for (JSONObject o : list(ctx, "queue")) if (id.equals(o.optString("id"))) return o;
        for (JSONObject o : list(ctx, "continue")) if (id.equals(o.optString("id"))) return o;
        for (JSONObject show : list(ctx, "shows")) {
            for (JSONObject o : episodesOf(ctx, show.optString("id"))) if (id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    // --- MediaItems for browsing (metadata only: no URI until the user plays one) -------------

    static MediaItem folder(String id, String title, int mediaType) {
        return new MediaItem.Builder().setMediaId(id).setMediaMetadata(new MediaMetadata.Builder()
                .setTitle(title).setIsBrowsable(true).setIsPlayable(false).setMediaType(mediaType).build()).build();
    }

    static MediaItem showItem(JSONObject show) {
        MediaMetadata.Builder m = new MediaMetadata.Builder()
                .setTitle(show.optString("title"))
                .setArtist(show.optString("author", ""))
                .setIsBrowsable(true).setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST);
        String art = show.optString("image", "");
        if (art.startsWith("http")) m.setArtworkUri(Uri.parse(art));
        return new MediaItem.Builder().setMediaId(SHOW_PREFIX + show.optString("id")).setMediaMetadata(m.build()).build();
    }

    static MediaItem episodeItem(JSONObject e) {
        MediaMetadata.Builder m = new MediaMetadata.Builder()
                .setTitle(e.optString("title"))
                .setArtist(e.optString("artist"))
                .setIsBrowsable(false).setIsPlayable(true)
                .setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE);
        String art = e.optString("artwork", "");
        if (art.startsWith("http")) m.setArtworkUri(Uri.parse(art));
        long dur = e.optLong("durationMs", 0);
        if (dur > 0) m.setDurationMs(dur);
        return new MediaItem.Builder().setMediaId(e.optString("id")).setMediaMetadata(m.build()).build();
    }

    // --- searching (voice: "play Rotten Mango on Podcasts") ---------------------------------

    private static String norm(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    /**
     * Episodes matching a spoken query, best first. A show name gives that show's newest unplayed
     * episode; otherwise episode titles that contain every word. An empty query means "continue".
     */
    static List<JSONObject> search(Context ctx, @Nullable String query) {
        List<JSONObject> out = new ArrayList<>();
        String q = norm(query);
        if (q.isEmpty()) {
            out.addAll(list(ctx, "continue"));
            out.addAll(list(ctx, "queue"));
            return out;
        }
        for (JSONObject show : list(ctx, "shows")) {
            String t = norm(show.optString("title"));
            if (t.isEmpty() || !(q.contains(t) || t.contains(q))) continue;
            List<JSONObject> eps = episodesOf(ctx, show.optString("id"));
            for (JSONObject e : eps) if (!e.optBoolean("played")) out.add(e);   // newest unplayed first
            for (JSONObject e : eps) if (e.optBoolean("played")) out.add(e);
        }
        String[] words = q.split(" ");
        for (JSONObject show : list(ctx, "shows")) {
            for (JSONObject e : episodesOf(ctx, show.optString("id"))) {
                String t = norm(e.optString("title"));
                boolean all = true;
                for (String w : words) if (!t.contains(w)) all = false;
                if (all && !out.contains(e)) out.add(e);
            }
        }
        return out;
    }
}

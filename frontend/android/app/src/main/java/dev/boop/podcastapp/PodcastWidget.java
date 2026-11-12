package dev.boop.podcastapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.view.KeyEvent;
import android.widget.RemoteViews;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSourceBitmapLoader;
import androidx.media3.session.MediaButtonReceiver;

import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.MoreExecutors;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: what is playing, with play / pause and skip buttons. It is pushed fresh
 * whenever the player changes (AudioController calls refresh()), so it needs no polling.
 * Play / pause goes through the media session (so it also restarts playback after the process
 * was killed); the skips go through WidgetActionReceiver and use the configured skip lengths.
 */
public class PodcastWidget extends AppWidgetProvider {
    private static String artUri = null;      // artwork currently cached for the widget
    private static Bitmap artBitmap = null;
    private static String loadingArtUri = null;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        push(context, manager, ids);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
        push(context, manager, new int[]{id});
    }

    /** Redraw every placed widget from the current player state. Cheap when none is placed. */
    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PodcastWidget.class));
        if (ids.length > 0) push(context, manager, ids);
    }

    private static void push(Context ctx, AppWidgetManager manager, int[] ids) {
        RemoteViews rv = build(ctx);
        for (int id : ids) manager.updateAppWidget(id, rv);
    }

    private static RemoteViews build(Context ctx) {
        String title = "Nothing playing";
        String show = "Tap to open";
        String art = null;
        boolean playing = false;

        AudioController c = AudioController.peek();
        if (c != null && c.player.getMediaItemCount() > 0) {
            MediaItem item = c.player.getCurrentMediaItem();
            if (item != null) {
                title = str(item.mediaMetadata.title, title);
                android.os.Bundle ex = item.mediaMetadata.extras;
                show = ex != null && ex.getString("baseArtist") != null
                        ? ex.getString("baseArtist") : str(item.mediaMetadata.artist, "");
                art = item.mediaMetadata.artworkUri == null ? null : item.mediaMetadata.artworkUri.toString();
            }
            playing = c.player.getPlayWhenReady() && c.player.getPlaybackState() != Player.STATE_ENDED;
        } else {
            // Nothing loaded in this process yet: show what play would resume.
            JSONObject r = AudioController.readResume(ctx);
            try {
                if (r != null) {
                    JSONArray items = r.getJSONArray("items");
                    JSONObject it = items.getJSONObject(Math.min(r.optInt("index", 0), items.length() - 1));
                    title = it.optString("title", title);
                    show = it.optString("artist", "");
                    art = it.optString("artwork", "");
                    if (art.isEmpty()) art = null;
                }
            } catch (Exception ignored) {
            }
        }

        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_player);
        rv.setTextViewText(R.id.widget_title, title);
        rv.setTextViewText(R.id.widget_show, show);
        rv.setImageViewResource(R.id.widget_play, playing ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play);
        rv.setContentDescription(R.id.widget_play, playing ? "Pause" : "Play");

        if (art != null && art.equals(artUri) && artBitmap != null) rv.setImageViewBitmap(R.id.widget_art, artBitmap);
        else if (art != null) loadArtwork(ctx, art);

        rv.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(ctx, 10,
                new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        rv.setOnClickPendingIntent(R.id.widget_play, mediaButton(ctx, 11, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE));
        rv.setOnClickPendingIntent(R.id.widget_back, action(ctx, 12, WidgetActionReceiver.ACTION_BACK));
        rv.setOnClickPendingIntent(R.id.widget_fwd, action(ctx, 13, WidgetActionReceiver.ACTION_FORWARD));
        return rv;
    }

    private static String str(@Nullable CharSequence s, String fallback) {
        return s == null || s.length() == 0 ? fallback : s.toString();
    }

    /** A media-button press, delivered to the media session (restarts the service if needed). */
    private static PendingIntent mediaButton(Context ctx, int requestCode, int keyCode) {
        Intent i = new Intent(Intent.ACTION_MEDIA_BUTTON)
                .setComponent(new ComponentName(ctx, MediaButtonReceiver.class))
                .putExtra(Intent.EXTRA_KEY_EVENT, new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        // A distinct request code per button: PendingIntents ignore extras when comparing.
        return PendingIntent.getBroadcast(ctx, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent action(Context ctx, int requestCode, String action) {
        Intent i = new Intent(ctx, WidgetActionReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Fetch the artwork once per episode, then redraw. A widget's bitmap must stay small. */
    private static void loadArtwork(Context ctx, String uri) {
        if (uri.equals(loadingArtUri) || !uri.startsWith("http")) return;
        loadingArtUri = uri;
        final Context app = ctx.getApplicationContext();
        Futures.addCallback(new DataSourceBitmapLoader(app).loadBitmap(Uri.parse(uri)), new FutureCallback<Bitmap>() {
            @Override
            public void onSuccess(Bitmap bmp) {
                artBitmap = Bitmap.createScaledBitmap(bmp, 192, 192, true);
                artUri = uri;
                loadingArtUri = null;
                refresh(app);
            }

            @Override
            public void onFailure(Throwable t) {
                loadingArtUri = null; // keep the placeholder icon
            }
        }, MoreExecutors.directExecutor());
    }
}

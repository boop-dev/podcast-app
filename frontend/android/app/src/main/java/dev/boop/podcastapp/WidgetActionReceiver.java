package dev.boop.podcastapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The widget's skip buttons. They only act while the player has an episode loaded. */
public class WidgetActionReceiver extends BroadcastReceiver {
    static final String ACTION_BACK = "dev.boop.podcastapp.WIDGET_BACK";
    static final String ACTION_FORWARD = "dev.boop.podcastapp.WIDGET_FORWARD";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        AudioController c = AudioController.peek();
        if (c == null || c.player.getMediaItemCount() == 0) return;
        if (ACTION_BACK.equals(intent.getAction())) c.seekBackConfigured();
        else if (ACTION_FORWARD.equals(intent.getAction())) c.seekForwardConfigured();
    }
}

package dev.boop.podcastapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.documentfile.provider.DocumentFile;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Scheduled automatic backup. The JS side stages the latest backup JSON into app storage whenever
 * the app is used (the data lives in the WebView's IndexedDB, which this worker cannot read). On
 * schedule this worker copies that staged file into the folder the user picked, which can be any
 * Storage Access Framework location, including a cloud drive's folder, and keeps the newest few.
 */
public class BackupWorker extends Worker {
    static final String PREFS = "auto_backup";
    static final String KEY_FOLDER_URI = "folderUri";
    static final String KEY_FOLDER_NAME = "folderName";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_INTERVAL_DAYS = "intervalDays";
    static final String KEY_LAST_OK = "lastOkAt";
    static final String KEY_LAST_ERROR = "lastError";
    static final String KEY_STAGED_AT = "stagedAt";
    static final String STAGED_FILE = "staged-backup.json";
    static final String PREFIX = "podcast-app-backup-";
    private static final String WORK_NAME = "auto-backup";
    private static final int KEEP = 7;

    public BackupWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** (Re)schedule or cancel the periodic work to match the saved settings. */
    static void reschedule(Context c) {
        SharedPreferences p = prefs(c);
        WorkManager wm = WorkManager.getInstance(c);
        if (!p.getBoolean(KEY_ENABLED, false) || p.getString(KEY_FOLDER_URI, null) == null) {
            wm.cancelUniqueWork(WORK_NAME);
            return;
        }
        int days = Math.max(1, p.getInt(KEY_INTERVAL_DAYS, 1));
        // UPDATE keeps the existing timing when only the interval or folder changed.
        wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE,
                new PeriodicWorkRequest.Builder(BackupWorker.class, days, TimeUnit.DAYS).build());
    }

    static void runNow(Context c) {
        WorkManager.getInstance(c).enqueue(new OneTimeWorkRequest.Builder(BackupWorker.class).build());
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = prefs(ctx);
        String uri = p.getString(KEY_FOLDER_URI, null);
        if (uri == null || !p.getBoolean(KEY_ENABLED, false)) return Result.success();
        try {
            File staged = new File(ctx.getFilesDir(), STAGED_FILE);
            if (!staged.exists()) throw new IllegalStateException("Nothing to back up yet. Open the app once.");
            DocumentFile dir = DocumentFile.fromTreeUri(ctx, Uri.parse(uri));
            if (dir == null || !dir.exists() || !dir.canWrite()) {
                throw new IllegalStateException("The backup folder is not available. Choose it again.");
            }
            String name = PREFIX + new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()) + ".json";
            DocumentFile old = dir.findFile(name);
            if (old != null) old.delete(); // one file per day: replace today's
            DocumentFile out = dir.createFile("application/json", name);
            if (out == null) throw new IllegalStateException("Could not create a file in the backup folder.");
            try (InputStream in = new FileInputStream(staged);
                 OutputStream os = ctx.getContentResolver().openOutputStream(out.getUri())) {
                if (os == null) throw new IllegalStateException("Could not write to the backup folder.");
                byte[] buf = new byte[32 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            prune(dir);
            p.edit().putLong(KEY_LAST_OK, System.currentTimeMillis()).remove(KEY_LAST_ERROR).apply();
            return Result.success();
        } catch (Exception e) {
            p.edit().putString(KEY_LAST_ERROR, e.getMessage() == null ? e.toString() : e.getMessage()).apply();
            return Result.success(); // retrying would not help; the next schedule tries again
        }
    }

    /** Keep only the newest KEEP backups (their names sort by date). */
    private static void prune(DocumentFile dir) {
        List<DocumentFile> mine = new ArrayList<>();
        for (DocumentFile f : dir.listFiles()) {
            String n = f.getName();
            if (n != null && n.startsWith(PREFIX) && n.endsWith(".json")) mine.add(f);
        }
        Collections.sort(mine, (a, b) -> b.getName().compareTo(a.getName()));
        for (int i = KEEP; i < mine.size(); i++) mine.get(i).delete();
    }
}

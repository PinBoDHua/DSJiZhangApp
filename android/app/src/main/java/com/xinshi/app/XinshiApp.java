package com.xinshi.app;

import android.app.Application;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.WebView;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 启动阶段诊断：记录 Application / Activity / WebView 的关键节点，日志只写应用私有目录
 * （filesDir），供原生崩溃页与调试排查使用。
 * 只有调试构建或显式诊断构建（-Pxinshi.diag → BuildConfig.XINSHI_DIAG）才会把日志导出到
 * 公共目录（Android 10+：Download/Xinshi/xinshi-diag.txt；Android 5–9：应用外部私有目录
 * Android/data/<包名>/files/Xinshi/xinshi-diag.txt，并不是公共下载目录）。
 * 不联网、不上传。
 */
public class XinshiApp extends Application {

    private static final String TAG = "XinshiDiag";
    private static final String LOG_NAME = "xinshi-diag.log";
    private static final String EXPORT_NAME = "xinshi-diag.txt";
    private static final String EXPORT_DIR = "Xinshi";
    private static final int MAX_LOG_BYTES = 64 * 1024;
    private static final int MAX_STACK_FRAMES = 200;
    private static final int MAX_CAUSE_DEPTH = 8;
    private static final int READ_TAIL_BYTES = 24 * 1024;

    private static XinshiApp instance;
    private static Thread.UncaughtExceptionHandler previousHandler;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        try {
            previousHandler = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
                crash(thread, error);
                if (previousHandler != null) {
                    previousHandler.uncaughtException(thread, error);
                }
            });
            mark("app:onCreate sdk=" + Build.VERSION.SDK_INT
                + " android=" + Build.VERSION.RELEASE
                + " device=" + Build.MANUFACTURER + " " + Build.MODEL
                + " webview=" + webViewVersion());
            // 正式包启动时顺手清掉历史版本可能残留在公共目录的诊断文件（AND-01）。
            cleanupPublicExport();
            if (BuildConfig.XINSHI_DIAG) {
                export();
            }
        } catch (Throwable ignored) {
            // 诊断本身不能影响启动
        }
    }

    /** 记录一个启动节点，同时写进内部日志。 */
    static synchronized void mark(String step) {
        XinshiApp app = instance;
        if (app == null) {
            return;
        }
        try {
            File file = new File(app.getFilesDir(), LOG_NAME);
            if (file.length() > MAX_LOG_BYTES) {
                // 只保留尾部一半，不要把启动节点整份删掉（AND-10）。
                trimToTail(file, MAX_LOG_BYTES / 2);
            }
            String line = timestamp() + "  " + step + "\n";
            try (FileOutputStream stream = new FileOutputStream(file, true)) {
                stream.write(line.getBytes(StandardCharsets.UTF_8));
            }
            Log.i(TAG, step);
        } catch (Throwable ignored) {
            // 忽略写入失败
        }
    }

    /** 记录崩溃堆栈（截断到前 MAX_STACK_FRAMES 帧），日志只保存在应用私有目录。 */
    static synchronized void crash(Thread thread, Throwable error) {
        XinshiApp app = instance;
        if (app == null) {
            return;
        }
        StringWriter writer = new StringWriter();
        writer.append("\n===== CRASH ").append(timestamp()).append(" =====\n");
        if (thread != null) {
            writer.append("thread: ").append(thread.getName()).append('\n');
        }
        appendTruncated(error, writer);
        writer.append("===== CRASH END =====\n");
        String text = writer.toString();
        try {
            File file = new File(app.getFilesDir(), LOG_NAME);
            // 深堆栈/崩溃循环时先滚动截断，避免日志无限膨胀（AND-10）。
            if (file.length() > MAX_LOG_BYTES) {
                trimToTail(file, MAX_LOG_BYTES / 2);
            }
            try (FileOutputStream stream = new FileOutputStream(file, true)) {
                stream.write(text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable ignored) {
            // 忽略写入失败
        }
        Log.e(TAG, text);
        export();
    }

    /**
     * 把内部日志导出到公共目录（Android 10+ 为 Download/Xinshi/xinshi-diag.txt，
     * Android 5–9 为应用外部私有目录）。默认关闭：只有调试构建或显式诊断构建才允许导出，
     * 正式包只写私有 filesDir，避免设备型号/堆栈等诊断信息落在公共目录（AND-01/16）。
     */
    static synchronized void export() {
        XinshiApp app = instance;
        if (app == null) {
            return;
        }
        if (!BuildConfig.XINSHI_DIAG && !BuildConfig.DEBUG) {
            return;
        }
        try {
            File file = new File(app.getFilesDir(), LOG_NAME);
            if (!file.exists()) {
                return;
            }
            byte[] bytes = readAll(file);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeToDownloads(app, bytes);
            } else {
                writeToAppExternal(app, bytes);
            }
        } catch (Throwable ignored) {
            // 导出失败不影响启动
        }
    }

    /** 正式包启动时清理历史版本可能残留在公共目录的诊断文件，确保不会长期残留（AND-01）。 */
    static synchronized void cleanupPublicExport() {
        XinshiApp app = instance;
        if (app == null || BuildConfig.XINSHI_DIAG || BuildConfig.DEBUG) {
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                deleteFromDownloads(app);
            } else {
                File dir = new File(app.getExternalFilesDir(null), EXPORT_DIR);
                File file = new File(dir, EXPORT_NAME);
                if (file.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
            }
        } catch (Throwable ignored) {
            // 清理失败不影响启动
        }
    }

    /** Android 10+：删除本应用此前写入公共下载目录的诊断文件。 */
    private static void deleteFromDownloads(Application app) {
        ContentResolver resolver = app.getContentResolver();
        String relativePath = Environment.DIRECTORY_DOWNLOADS + "/" + EXPORT_DIR + "/";
        try (Cursor cursor = resolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            new String[] { MediaStore.MediaColumns._ID },
            MediaStore.MediaColumns.DISPLAY_NAME + " = ? AND "
                + MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND "
                + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + " = ?",
            new String[] { EXPORT_NAME, relativePath, app.getPackageName() },
            null
        )) {
            if (cursor == null) {
                return;
            }
            while (cursor.moveToNext()) {
                long id = cursor.getLong(0);
                resolver.delete(
                    ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id),
                    null,
                    null
                );
            }
        }
    }

    /** Android 10+：导出到公共下载目录 Download/Xinshi/（仅诊断构建，见 export 守卫）。 */
    private static void writeToDownloads(Application app, byte[] bytes) {
        ContentResolver resolver = app.getContentResolver();
        String relativePath = Environment.DIRECTORY_DOWNLOADS + "/" + EXPORT_DIR + "/";
        try (Cursor cursor = resolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            new String[] { MediaStore.MediaColumns._ID },
            MediaStore.MediaColumns.DISPLAY_NAME + " = ? AND "
                + MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND "
                + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + " = ?",
            new String[] { EXPORT_NAME, relativePath, app.getPackageName() },
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                do {
                    long id = cursor.getLong(0);
                    resolver.delete(
                        ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id),
                        null,
                        null
                    );
                } while (cursor.moveToNext());
            }
        }
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, EXPORT_NAME);
        values.put(MediaStore.MediaColumns.MIME_TYPE, "text/plain");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            return;
        }
        try (OutputStream stream = resolver.openOutputStream(uri, "wt")) {
            if (stream == null) {
                throw new IOException("无法写入诊断文件");
            }
            stream.write(bytes);
            stream.flush();
        } catch (IOException error) {
            resolver.delete(uri, null, null);
            return;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        if (resolver.update(uri, done, null, null) <= 0) {
            resolver.delete(uri, null, null);
        }
    }

    /**
     * Android 5–9：分区存储前没有公共 Downloads API，这里写的是应用外部私有目录
     * Android/data/<包名>/files/Xinshi/xinshi-diag.txt，不是注释曾声称的公共 Download 目录；
     * 仅诊断构建会调用（见 export 守卫）。旧系统上该目录仍可被持 READ_EXTERNAL_STORAGE
     * 的应用读取，因此正式包不应再写（AND-16）。
     */
    private static void writeToAppExternal(Application app, byte[] bytes) {
        File dir = new File(app.getExternalFilesDir(null), EXPORT_DIR);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        try (FileOutputStream stream = new FileOutputStream(new File(dir, EXPORT_NAME))) {
            stream.write(bytes);
        } catch (IOException ignored) {
            // 忽略
        }
    }

    /** 只读取日志尾部 READ_TAIL_BYTES，给原生崩溃页展示，避免整份大日志进内存（AND-10）。 */
    static String readLog() {
        XinshiApp app = instance;
        if (app == null) {
            return "";
        }
        try {
            File file = new File(app.getFilesDir(), LOG_NAME);
            if (!file.exists()) {
                return "";
            }
            return new String(readTail(file, READ_TAIL_BYTES), StandardCharsets.UTF_8);
        } catch (Throwable error) {
            return "";
        }
    }

    /** 读取文件尾部 maxBytes 字节；文件更短时返回全部。 */
    private static byte[] readTail(File file, int maxBytes) throws IOException {
        long length = file.length();
        long skip = Math.max(0, length - maxBytes);
        try (FileInputStream stream = new FileInputStream(file)) {
            long skipped = 0;
            while (skipped < skip) {
                long step = stream.skip(skip - skipped);
                if (step <= 0) {
                    break;
                }
                skipped += step;
            }
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8 * 1024];
            int read;
            while ((read = stream.read(chunk)) > 0) {
                out.write(chunk, 0, read);
            }
            return out.toByteArray();
        }
    }

    /** 日志超限时只保留尾部 keepBytes，滚动写入而不是整份删除。 */
    private static void trimToTail(File file, int keepBytes) {
        try {
            byte[] tail = readTail(file, keepBytes);
            try (FileOutputStream stream = new FileOutputStream(file, false)) {
                stream.write(tail);
            }
        } catch (Throwable ignored) {
            // 截断失败时继续追加，诊断写入不能影响主流程
        }
    }

    /** 截断堆栈：只保留前 MAX_STACK_FRAMES 帧与最多 MAX_CAUSE_DEPTH 层 cause 链。 */
    private static void appendTruncated(Throwable error, StringWriter writer) {
        if (error == null) {
            return;
        }
        Throwable current = error;
        int depth = 0;
        while (current != null && depth < MAX_CAUSE_DEPTH) {
            writer.append(depth == 0 ? "" : "Caused by: ").append(String.valueOf(current)).append('\n');
            StackTraceElement[] frames = current.getStackTrace();
            int limit = Math.min(frames.length, MAX_STACK_FRAMES);
            for (int i = 0; i < limit; i++) {
                writer.append("\tat ").append(frames[i].toString()).append('\n');
            }
            if (frames.length > limit) {
                writer.append("\t... (").append(String.valueOf(frames.length - limit)).append(" 帧已省略)\n");
            }
            current = current.getCause();
            depth += 1;
        }
        if (error.getCause() != null && depth >= MAX_CAUSE_DEPTH) {
            writer.append("\t... (cause 链已截断)\n");
        }
    }

    private static byte[] readAll(File file) throws IOException {
        try (FileInputStream stream = new FileInputStream(file);
             java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream((int) file.length())) {
            byte[] chunk = new byte[8 * 1024];
            int read;
            while ((read = stream.read(chunk)) > 0) {
                out.write(chunk, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static String timestamp() {
        return new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
    }

    private static String webViewVersion() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
                if (info != null) {
                    return info.packageName + "/" + info.versionName;
                }
            }
        } catch (Throwable ignored) {
            // 部分 ROM 不返回 WebView 包信息
        }
        return "unknown";
    }
}

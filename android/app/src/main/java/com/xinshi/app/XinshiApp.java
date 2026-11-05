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
 * 启动阶段诊断：记录 Application / Activity / WebView 的关键节点，
 * 崩溃时把堆栈一起写进 Download/Xinshi/xinshi-diag.txt，方便真机排查。
 * 不联网、不上传，文件只写在本机。
 */
public class XinshiApp extends Application {

    private static final String TAG = "XinshiDiag";
    private static final String LOG_NAME = "xinshi-diag.log";
    private static final String EXPORT_NAME = "xinshi-diag.txt";
    private static final String EXPORT_DIR = "Xinshi";
    private static final int MAX_LOG_BYTES = 64 * 1024;

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
                //noinspection ResultOfMethodCallIgnored
                file.delete();
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

    /** 记录崩溃堆栈，并立刻导出。 */
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
        error.printStackTrace(new PrintWriter(writer));
        writer.append("===== CRASH END =====\n");
        String text = writer.toString();
        try {
            File file = new File(app.getFilesDir(), LOG_NAME);
            try (FileOutputStream stream = new FileOutputStream(file, true)) {
                stream.write(text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable ignored) {
            // 忽略写入失败
        }
        Log.e(TAG, text);
        export();
    }

    /** 把内部日志导出到 Download/Xinshi/xinshi-diag.txt。 */
    static synchronized void export() {
        XinshiApp app = instance;
        if (app == null) {
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

    private static void writeToDownloads(Application app, byte[] bytes) {
        ContentResolver resolver = app.getContentResolver();
        String relativePath = Environment.DIRECTORY_DOWNLOADS + "/" + EXPORT_DIR;
        try (Cursor cursor = resolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            new String[] { MediaStore.MediaColumns._ID },
            MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ?",
            new String[] { "xinshi-diag%" },
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
            if (stream != null) {
                stream.write(bytes);
                stream.flush();
            }
        } catch (IOException error) {
            resolver.delete(uri, null, null);
            return;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, done, null, null);
    }

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

    /** 读取当前日志全文，给原生崩溃页展示。 */
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
            return new String(readAll(file), StandardCharsets.UTF_8);
        } catch (Throwable error) {
            return "";
        }
    }

    private static byte[] readAll(File file) throws IOException {
        try (FileInputStream stream = new FileInputStream(file)) {
            byte[] buffer = new byte[(int) file.length()];
            int read = stream.read(buffer);
            if (read <= 0) {
                return new byte[0];
            }
            byte[] result = new byte[read];
            System.arraycopy(buffer, 0, result, 0, read);
            return result;
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

package com.xinshi.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    private static final String BASE_PATH = Environment.DIRECTORY_DOWNLOADS + "/Xinshi";

    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String data = call.getString("data");
        String subdir = safeSubdir(call.getString("subdir", ""));

        if (filename == null || filename.isEmpty() || data == null) {
            call.reject("保存参数不完整");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("当前 Android 版本请使用分享保存");
            return;
        }
        if (subdir == null) {
            call.reject("目录名称不合法");
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("文件内容编码错误");
            return;
        }

        String relativePath = relativePath(subdir);
        ContentResolver resolver = getContext().getContentResolver();

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("无法在下载目录创建文件");
                return;
            }
            try (OutputStream stream = resolver.openOutputStream(uri)) {
                if (stream == null) {
                    throw new IllegalStateException("无法写入文件");
                }
                stream.write(bytes);
                stream.flush();
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(uri, done, null, null) <= 0) {
                throw new IllegalStateException("文件发布失败");
            }

            resolveSaved(call, uri, subdir, filename);
        } catch (Exception error) {
            if (uri != null) {
                resolver.delete(uri, null, null);
            }
            call.reject(error.getMessage() == null ? "保存失败" : error.getMessage());
        }
    }

    @PluginMethod
    public void prune(PluginCall call) {
        String prefix = call.getString("prefix", "");
        int keep = Math.max(1, call.getInt("keep", 14));
        String subdir = safeSubdir(call.getString("subdir", ""));

        if (prefix == null || prefix.isEmpty()) {
            call.reject("缺少文件前缀");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("当前 Android 版本不支持自动清理");
            return;
        }
        if (subdir == null) {
            call.reject("目录名称不合法");
            return;
        }

        String relativePath = relativePath(subdir);
        ContentResolver resolver = getContext().getContentResolver();
        String selection = MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ? AND "
                + MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND "
                + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + " = ? AND "
                + MediaStore.MediaColumns.IS_PENDING + " = 0";
        String[] args = new String[] { prefix + "%", relativePath, getContext().getPackageName() };
        String[] columns = new String[] {
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.DATE_MODIFIED
        };

        int deleted = 0;
        try (Cursor cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                columns,
                selection,
                args,
                MediaStore.MediaColumns.DATE_MODIFIED + " DESC, " + MediaStore.MediaColumns._ID + " DESC")) {
            if (cursor == null) {
                call.reject("无法读取备份目录");
                return;
            }
            int index = 0;
            while (cursor.moveToNext()) {
                index += 1;
                if (index <= keep) continue;
                long id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID));
                Uri uri = ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id);
                try {
                    deleted += resolver.delete(uri, null, null);
                } catch (Exception ignored) {
                    // 单个文件删除失败不影响其他备份
                }
            }
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "清理失败" : error.getMessage());
            return;
        }

        JSObject result = new JSObject();
        result.put("deleted", deleted);
        call.resolve(result);
    }

    private String relativePath(String subdir) {
        if (subdir == null || subdir.isEmpty()) return BASE_PATH + "/";
        return BASE_PATH + "/" + subdir + "/";
    }

    /** 只允许中文、字母、数字、下划线和短横线，避免目录穿越。 */
    private String safeSubdir(String value) {
        if (value == null || value.isEmpty()) return "";
        String cleaned = value.replaceAll("[^\\p{L}\\p{N}_-]", "");
        if (cleaned.isEmpty() || cleaned.length() > 32) return null;
        return cleaned;
    }

    private void resolveSaved(PluginCall call, Uri uri, String subdir, String filename) {
        JSObject result = new JSObject();
        String path = "下载/Xinshi/";
        if (subdir != null && !subdir.isEmpty()) path += subdir + "/";
        result.put("path", path + filename);
        result.put("uri", uri.toString());
        call.resolve(result);
    }
}

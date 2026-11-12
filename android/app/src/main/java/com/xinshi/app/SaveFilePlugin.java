package com.xinshi.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
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
        if (filename.length() > 120 || filename.matches(".*[\\\\/\\p{Cntrl}].*")) {
            call.reject("文件名称不合法");
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

        // Android 9 及以下没有分区存储的 Downloads API：走系统分享面板保存 / 转发，
        // 否则这些设备上备份、工资条、CSV 全部无法导出。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            shareViaLegacy(call, filename, mimeType, bytes);
            return;
        }

        String relativePath = relativePath(subdir);
        ContentResolver resolver = getContext().getContentResolver();

        String temporaryName = "." + filename + "." + System.nanoTime() + ".tmp";
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, temporaryName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = null;
        boolean published = false;
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
            // 先让新文件以最终名称可见，再清理同名旧文件：
            // 发布失败时只删临时文件，旧备份不受影响；清理失败时最多多留一份。
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(uri, done, null, null) <= 0) {
                throw new IllegalStateException("文件发布失败");
            }
            published = true;
            String finalName = displayNameOf(resolver, uri, filename);
            try {
                removeExistingFiles(resolver, relativePath, filename, uri);
                if (!finalName.equals(filename)) {
                    // 同名旧文件刚才还占着名字，系统把新文件改成了 “name (1)”；旧文件已清理，改名回去。
                    ContentValues rename = new ContentValues();
                    rename.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
                    if (resolver.update(uri, rename, null, null) > 0) {
                        finalName = displayNameOf(resolver, uri, filename);
                    }
                }
            } catch (Exception ignored) {
                // 清理或改名失败时保留实际文件名，新备份已经落盘，不能因此报保存失败。
            }
            resolveSaved(call, uri, subdir, finalName);
        } catch (Exception error) {
            if (uri != null && !published) {
                try {
                    resolver.delete(uri, null, null);
                } catch (Exception ignored) {
                    // 保留原始错误返回给前端。
                }
            }
            call.reject(error.getMessage() == null ? "保存失败" : error.getMessage());
        }
    }

    /** Android 5–9：写入应用缓存目录后经 FileProvider 交给系统分享面板。 */
    private void shareViaLegacy(PluginCall call, String filename, String mimeType, byte[] bytes) {
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建临时目录");
                return;
            }
            File file = new File(dir, filename);
            try (OutputStream stream = new FileOutputStream(file)) {
                stream.write(bytes);
                stream.flush();
            }
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(mimeType);
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(intent, "保存或分享文件");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            JSObject result = new JSObject();
            result.put("path", filename);
            result.put("uri", uri.toString());
            result.put("shared", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "分享失败" : error.getMessage());
        }
    }

    /** 读取已发布文件的实际名称：同名冲突时系统可能自动改名。 */
    private String displayNameOf(ContentResolver resolver, Uri uri, String fallback) {
        try (Cursor cursor = resolver.query(
                uri, new String[] { MediaStore.MediaColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // 查询失败时按请求的文件名返回。
        }
        return fallback;
    }

    private void removeExistingFiles(
            ContentResolver resolver, String relativePath, String filename, Uri keep) {
        String selection = MediaStore.MediaColumns.DISPLAY_NAME + " = ? AND "
                + MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND "
                + MediaStore.MediaColumns.OWNER_PACKAGE_NAME + " = ? AND "
                + MediaStore.MediaColumns.IS_PENDING + " = 0";
        String[] args = new String[] { filename, relativePath, getContext().getPackageName() };
        String[] columns = new String[] { MediaStore.MediaColumns._ID };
        long keepId = -1;
        try {
            keepId = ContentUris.parseId(keep);
        } catch (Exception ignored) {
            // 不是单行 Uri 时不排除任何行。
        }
        try (Cursor cursor = resolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI, columns, selection, args, null)) {
            if (cursor == null) throw new IllegalStateException("无法检查同名文件");
            while (cursor.moveToNext()) {
                long id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID));
                if (id == keepId) continue;
                Uri existing = ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id);
                resolver.delete(existing, null, null);
            }
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

package org.hebrewlearning.app;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Data-only content: downloaded HTML, JavaScript and SVG are never accepted. */
final class UpdateManifest {
    static final long MAX_FILE_BYTES = 64L * 1024 * 1024;
    static final long MAX_CONTENT_BYTES = 512L * 1024 * 1024;
    final JSONObject json;
    final String contentVersion;
    final int minAppVersionCode;
    final List<MediaFile> files;
    final String appVersion;
    final int appVersionCode;
    final String apkUrl;
    final String apkSha256;

    private UpdateManifest(JSONObject json, String contentVersion, int minAppVersionCode,
                           List<MediaFile> files, String appVersion, int appVersionCode,
                           String apkUrl, String apkSha256) {
        this.json = json;
        this.contentVersion = contentVersion;
        this.minAppVersionCode = minAppVersionCode;
        this.files = Collections.unmodifiableList(files);
        this.appVersion = appVersion;
        this.appVersionCode = appVersionCode;
        this.apkUrl = apkUrl;
        this.apkSha256 = apkSha256;
    }

    static UpdateManifest parse(String text) throws IOException {
        try {
            JSONObject root = new JSONObject(text);
            if (requiredInteger(root, "schemaVersion", 1, 1) != 1) {
                throw new IOException("Unsupported update manifest schema.");
            }
            String appVersion = "";
            int appVersionCode = 0;
            String apkUrl = "";
            String apkSha = "";
            if (root.has("app")) {
                JSONObject app = root.getJSONObject("app");
                appVersion = version(requiredString(app, "version"));
                appVersionCode = (int) requiredInteger(app, "versionCode", 1, Integer.MAX_VALUE);
                apkUrl = requiredString(app, "apkUrl");
                SafeNetwork.validateUrl(apkUrl);
                apkSha = sha256(requiredString(app, "sha256"));
            }

            List<MediaFile> files = new ArrayList<>();
            String contentVersion = "";
            int minAppVersionCode = 1;
            if (root.has("content")) {
                JSONObject content = root.getJSONObject("content");
                contentVersion = version(requiredString(content, "version"));
                minAppVersionCode = content.has("minAppVersionCode")
                        ? (int) requiredInteger(content, "minAppVersionCode", 1, Integer.MAX_VALUE) : 1;
                JSONArray list = content.getJSONArray("files");
                if (list.length() < 1 || list.length() > 1000) {
                    throw new IOException("Content batch must have between 1 and 1000 files.");
                }
                Set<String> paths = new HashSet<>();
                long declaredBytes = 0;
                for (int index = 0; index < list.length(); index++) {
                    JSONObject file = list.getJSONObject(index);
                    String path = contentPath(requiredString(file, "path"));
                    if (!paths.add(path)) throw new IOException("Duplicate content path.");
                    String url = requiredString(file, "url");
                    SafeNetwork.validateUrl(url);
                    String sha = sha256(requiredString(file, "sha256"));
                    long maximum = path.endsWith(".json") ? 2L * 1024 * 1024 : MAX_FILE_BYTES;
                    long bytes = file.has("bytes") ? requiredInteger(file, "bytes", 1, maximum) : -1;
                    declaredBytes += Math.max(0, bytes);
                    if (declaredBytes > MAX_CONTENT_BYTES) {
                        throw new IOException("Content batch is too large.");
                    }
                    files.add(new MediaFile(path, url, sha, bytes));
                }
            }
            if (appVersionCode == 0 && files.isEmpty()) {
                throw new IOException("The update manifest has no app or content.");
            }
            return new UpdateManifest(root, contentVersion, minAppVersionCode, files,
                    appVersion, appVersionCode, apkUrl, apkSha);
        } catch (JSONException exception) {
            throw new IOException("Invalid update manifest.", exception);
        }
    }

    static String contentPath(String path) throws IOException {
        if (path == null || path.length() > 220 || !path.startsWith("content/") ||
                !path.matches("[a-zA-Z0-9_./-]+") || path.endsWith("/")) {
            throw new IOException("Invalid content path.");
        }
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) {
                throw new IOException("Unsafe content path.");
            }
        }
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        if (!lower.matches(".*\\.(json|jpg|jpeg|png|webp|wav|mp3)$")) {
            throw new IOException("Unsupported content file type.");
        }
        return path;
    }

    static String requiredString(JSONObject object, String key) throws IOException {
        Object value = object.opt(key);
        if (!(value instanceof String)) throw new IOException("Invalid string field: " + key + ".");
        return (String) value;
    }

    static long requiredInteger(JSONObject object, String key, long minimum, long maximum) throws IOException {
        Object value = object.opt(key);
        if (!(value instanceof Number)) throw new IOException("Invalid integer field: " + key + ".");
        double numeric = ((Number) value).doubleValue();
        long integer = ((Number) value).longValue();
        if (!Double.isFinite(numeric) || numeric != integer || integer < minimum || integer > maximum) {
            throw new IOException("Invalid integer field: " + key + ".");
        }
        return integer;
    }

    static String sha256(String value) throws IOException {
        if (value == null || !value.matches("[a-fA-F0-9]{64}")) {
            throw new IOException("A valid SHA-256 checksum is required.");
        }
        return value.toLowerCase(java.util.Locale.ROOT);
    }

    private static String version(String value) throws IOException {
        if (value.isEmpty() || value.length() > 80 || !value.matches("[A-Za-z0-9._-]+")) {
            throw new IOException("Invalid version identifier.");
        }
        return value;
    }

    static final class MediaFile {
        final String path;
        final String url;
        final String sha256;
        final long bytes;

        MediaFile(String path, String url, String sha256, long bytes) {
            this.path = path;
            this.url = url;
            this.sha256 = sha256;
            this.bytes = bytes;
        }
    }
}

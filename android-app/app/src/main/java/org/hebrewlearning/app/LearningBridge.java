package org.hebrewlearning.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Exposed only to the packaged local page; network activity runs off the UI thread. */
final class LearningBridge {
    private final MainActivity activity;
    private final ContentStore content;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean contentBusy = new AtomicBoolean(false);
    private final AtomicBoolean apkBusy = new AtomicBoolean(false);
    private final AtomicBoolean checkBusy = new AtomicBoolean(false);
    private volatile boolean roundActive;
    private volatile UpdateManifest lastManifest;
    private volatile String updateStatus = "{\"status\":\"idle\"}";
    private volatile String currentCheckJob = "";

    LearningBridge(MainActivity activity, ContentStore content) {
        this.activity = activity;
        this.content = content;
    }

    @JavascriptInterface public String getStatus() {
        return object("platform", "android", "appVersion", BuildConfig.VERSION_NAME,
                "version", BuildConfig.VERSION_NAME, "versionCode", BuildConfig.VERSION_CODE,
                "contentVersion", content.activeVersion(), "readyContentVersion", content.readyVersion(),
                "updateManifestUrl", BuildConfig.UPDATE_MANIFEST_URL, "online", online()).toString();
    }

    @JavascriptInterface public String getAppInfo() { return getStatus(); }

    @JavascriptInterface public String readContentManifest() { return content.readContentManifest(); }

    @JavascriptInterface public String getVocabulary() {
        try { return content.readVocabulary(); } catch (IOException error) { return "null"; }
    }

    @JavascriptInterface public String getUpdateStatus() { return updateStatus; }

    @JavascriptInterface public String checkForUpdates() { return checkUpdates(BuildConfig.UPDATE_MANIFEST_URL); }

    @JavascriptInterface public String checkUpdates(String requestedUrl) {
        String url = requestedUrl == null || requestedUrl.isEmpty()
                ? BuildConfig.UPDATE_MANIFEST_URL : requestedUrl;
        if (url.isEmpty()) return object("status", "not-configured").toString();
        try {
            SafeNetwork.validateUrl(url);
        } catch (IOException exception) {
            return object("status", "error", "error", exception.getMessage()).toString();
        }
        if (!checkBusy.compareAndSet(false, true)) {
            return object("jobId", currentCheckJob, "status", "started").toString();
        }
        String job = UUID.randomUUID().toString();
        currentCheckJob = job;
        worker.execute(() -> {
            try {
                if (!online()) {
                    emit("update-check", job, "offline", "message", "No connection; local content remains available.");
                    return;
                }
                UpdateManifest manifest = UpdateManifest.parse(SafeNetwork.fetchManifest(url));
                lastManifest = manifest;
                boolean appUpdate = manifest.appVersionCode > BuildConfig.VERSION_CODE;
                boolean compatible = manifest.minAppVersionCode <= BuildConfig.VERSION_CODE;
                boolean contentUpdate = !manifest.files.isEmpty() && compatible &&
                        !manifest.contentVersion.equals(content.activeVersion()) &&
                        !manifest.contentVersion.equals(content.readyVersion());
                emit("update-check", job, "checked", "manifest", manifest.json,
                        "appUpdateAvailable", appUpdate, "contentUpdateAvailable", contentUpdate,
                        "contentCompatible", compatible, "readyContentVersion", content.readyVersion());
            } catch (IOException exception) {
                emit("update-check", job, "error", "error", friendlyError(exception));
            } finally {
                checkBusy.set(false);
            }
        });
        return object("jobId", job, "status", "started").toString();
    }

    @JavascriptInterface public String downloadContent(String manifestUrl) {
        String url = manifestUrl == null || manifestUrl.isEmpty()
                ? BuildConfig.UPDATE_MANIFEST_URL : manifestUrl;
        if (url.isEmpty()) return object("status", "not-configured").toString();
        try {
            SafeNetwork.validateUrl(url);
        } catch (IOException exception) {
            return object("status", "error", "error", exception.getMessage()).toString();
        }
        if (!contentBusy.compareAndSet(false, true)) return object("status", "busy").toString();
        String job = UUID.randomUUID().toString();
        worker.execute(() -> {
            try {
                if (!online()) {
                    emit("content-download", job, "offline", "message", "No connection; local content remains available.");
                    return;
                }
                UpdateManifest manifest = UpdateManifest.parse(SafeNetwork.fetchManifest(url));
                lastManifest = manifest;
                if (manifest.files.isEmpty()) throw new IOException("This manifest has no content batch.");
                if (manifest.contentVersion.equals(content.readyVersion()) ||
                        manifest.contentVersion.equals(content.activeVersion())) {
                    emit("content-download", job, "ready", "contentVersion", manifest.contentVersion);
                    return;
                }
                content.stage(manifest, (completed, count, bytes) -> emit("content-download", job,
                        "progress", "completedFiles", completed, "totalFiles", count,
                        "downloadedBytes", bytes, "contentVersion", manifest.contentVersion));
                emit("content-download", job, "ready", "contentVersion", manifest.contentVersion,
                        "files", manifest.files.size());
            } catch (IOException exception) {
                emit("content-download", job, "error", "error", friendlyError(exception));
            } finally {
                contentBusy.set(false);
            }
        });
        return object("jobId", job, "status", "started").toString();
    }

    @JavascriptInterface public synchronized void setRoundActive(boolean active) { roundActive = active; }

    @JavascriptInterface public synchronized String activateContent() {
        String job = UUID.randomUUID().toString();
        if (roundActive) {
            emit("content-activation", job, "deferred", "contentVersion", content.readyVersion());
            return object("status", "deferred", "contentVersion", content.readyVersion()).toString();
        }
        try {
            boolean changed = content.activate();
            emit("content-activation", job, "active", "contentVersion", content.activeVersion(), "changed", changed);
            return object("status", "active", "contentVersion", content.activeVersion(), "changed", changed).toString();
        } catch (IOException exception) {
            emit("content-activation", job, "error", "error", friendlyError(exception));
            return object("status", "error", "error", friendlyError(exception)).toString();
        }
    }

    @JavascriptInterface public String openApkUpdate(String requestedUrl, String requestedSha256) {
        UpdateManifest manifest = lastManifest;
        String url = requestedUrl;
        String sha = requestedSha256;
        if ((url == null || url.isEmpty()) && manifest != null) url = manifest.apkUrl;
        if ((sha == null || sha.isEmpty()) && manifest != null && manifest.apkUrl.equals(url)) {
            sha = manifest.apkSha256;
        }
        try {
            SafeNetwork.validateUrl(url);
            sha = UpdateManifest.sha256(sha);
        } catch (IOException | NullPointerException exception) {
            return object("status", "error", "error", "A trusted APK URL and SHA-256 are required.").toString();
        }
        if (!apkBusy.compareAndSet(false, true)) return object("status", "busy").toString();
        String job = UUID.randomUUID().toString();
        String apkUrl = url;
        String apkSha = sha;
        worker.execute(() -> {
            try {
                if (!online()) {
                    emit("apk-update", job, "offline", "message", "A connection is needed to download an app update.");
                    return;
                }
                File directory = new File(activity.getFilesDir(), "apk-updates");
                File pending = new File(directory, "verified-update.apk");
                emit("apk-update", job, "downloading");
                SafeNetwork.download(apkUrl, pending, apkSha, -1, 256L * 1024 * 1024);
                verifyApk(pending);
                activity.runOnUiThread(() -> activity.offerInstallation(pending, job));
            } catch (IOException exception) {
                emit("apk-update", job, "error", "error", friendlyError(exception));
            } finally {
                apkBusy.set(false);
            }
        });
        return object("jobId", job, "status", "started").toString();
    }

    void shutdown() { worker.shutdownNow(); }

    void installationEvent(String job, String status, Object... fields) {
        emit("apk-update", job, status, fields);
    }

    private void verifyApk(File file) throws IOException {
        PackageManager manager = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (candidate == null || !BuildConfig.APPLICATION_ID.equals(candidate.packageName)) {
            throw new IOException("The update APK does not belong to this app.");
        }
        long versionCode = Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode;
        if (versionCode <= BuildConfig.VERSION_CODE) throw new IOException("This APK is not a newer app version.");
        try {
            PackageInfo installed = manager.getPackageInfo(BuildConfig.APPLICATION_ID, flags);
            Set<String> installedSigners = certificates(installed);
            Set<String> candidateSigners = certificates(candidate);
            if (installedSigners.isEmpty() || candidateSigners.isEmpty() ||
                    !installedSigners.equals(candidateSigners)) {
                throw new IOException("The update APK was signed with a different key.");
            }
        } catch (PackageManager.NameNotFoundException exception) {
            throw new IOException("Cannot verify the currently installed app.", exception);
        }
    }

    @SuppressWarnings("deprecation")
    private static Set<String> certificates(PackageInfo info) throws IOException {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        Set<String> hashes = new HashSet<>();
        if (signatures != null) {
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                for (Signature signature : signatures) hashes.add(SafeNetwork.hex(digest.digest(signature.toByteArray())));
            } catch (NoSuchAlgorithmException exception) {
                throw new IOException("Cannot verify the APK signing certificate.", exception);
            }
        }
        return hashes;
    }

    private boolean online() {
        ConnectivityManager manager = (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        Network network = manager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    private void emit(String event, String job, String status, Object... fields) {
        JSONObject detail = object("event", event, "jobId", job, "status", status);
        for (int index = 0; index + 1 < fields.length; index += 2) {
            try { detail.put(fields[index].toString(), fields[index + 1]); } catch (JSONException ignored) { }
        }
        updateStatus = detail.toString();
        activity.emitNativeEvent(detail);
    }

    private static String friendlyError(IOException exception) {
        return exception.getMessage() == null ? "The update could not be completed; current content is unchanged."
                : exception.getMessage();
    }

    static JSONObject object(Object... fields) {
        JSONObject object = new JSONObject();
        for (int index = 0; index + 1 < fields.length; index += 2) {
            try { object.put(fields[index].toString(), fields[index + 1]); } catch (JSONException ignored) { }
        }
        return object;
    }
}

package org.hebrewlearning.app;

import android.content.Context;
import android.os.StatFs;
import android.util.AtomicFile;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.json.JSONArray;
import org.json.JSONTokener;

/** Immutable generations plus atomic pointers; an unfinished download can never become active. */
final class ContentStore {
    private final Context context;
    private final File root;
    private final File generations;
    private final AtomicFile activePointer;
    private final AtomicFile readyPointer;
    private final String bundledVersion;
    private Generation active;
    private Generation ready;
    private String previousId = "";

    interface Progress {
        void update(int completedFiles, int totalFiles, long downloadedBytes);
    }

    ContentStore(Context context) throws IOException {
        this.context = context;
        root = new File(context.getFilesDir(), "hebrew-content");
        generations = new File(root, "generations");
        if (!generations.isDirectory() && !generations.mkdirs()) {
            throw new IOException("Cannot prepare local content storage.");
        }
        activePointer = new AtomicFile(new File(root, "active.json"));
        readyPointer = new AtomicFile(new File(root, "ready.json"));
        String initialVersion = "0.1.0";
        try (InputStream catalog = context.getAssets().open("content/vocabulary.json")) {
            initialVersion = new JSONObject(readBounded(catalog, 2 * 1024 * 1024)).getString("contentVersion");
        } catch (IOException | JSONException ignored) { }
        bundledVersion = initialVersion;
        android.content.SharedPreferences state=context.getSharedPreferences("bundled-content",Context.MODE_PRIVATE);
        String oldBundle=state.getString("version",bundledVersion);
        if(!oldBundle.equals(bundledVersion)) { activePointer.delete();readyPointer.delete(); }
        state.edit().putString("version",bundledVersion).apply();
        restore();
    }

    synchronized String readVocabulary() throws IOException {
        if (active != null) {
            try (InputStream input = new FileInputStream(confinedFile(active.directory,"content/vocabulary.json"))) {
                return readBounded(input,2*1024*1024);
            }
        }
        try (InputStream input = context.getAssets().open("content/vocabulary.json")) {
            return readBounded(input,2*1024*1024);
        }
    }

    synchronized String activeVersion() {
        return active == null ? bundledVersion : active.manifest.contentVersion;
    }

    synchronized String readyVersion() {
        return ready == null ? "" : ready.manifest.contentVersion;
    }

    synchronized String readContentManifest() {
        return active == null ? "null" : active.manifest.json.toString();
    }

    synchronized boolean hasReadyContent() {
        return ready != null;
    }

    void stage(UpdateManifest manifest, Progress progress) throws IOException {
        if (manifest.files.isEmpty()) throw new IOException("The manifest has no content files.");
        if (manifest.minAppVersionCode > BuildConfig.VERSION_CODE) {
            throw new IOException("This content requires a newer app version.");
        }
        long declaredBytes = 0;
        for (UpdateManifest.MediaFile file : manifest.files) declaredBytes += Math.max(0, file.bytes);
        ensureSpace(declaredBytes + 16L * 1024 * 1024);
        String id = UUID.randomUUID().toString();
        File staging = generationDirectory(id);
        if (!staging.mkdir()) throw new IOException("Cannot prepare the content batch.");
        boolean complete = false;
        try {
            long total = 0;
            int completed = 0;
            for (UpdateManifest.MediaFile file : manifest.files) {
                ensureSpace(Math.max(0, file.bytes) + 8L * 1024 * 1024);
                File target = confinedFile(staging, file.path);
                long fileLimit = file.path.endsWith(".json") ? 2L * 1024 * 1024 : UpdateManifest.MAX_FILE_BYTES;
                long allowance = Math.min(fileLimit,
                        UpdateManifest.MAX_CONTENT_BYTES - total);
                if (allowance < 1) throw new IOException("Content batch exceeds the size limit.");
                total += SafeNetwork.download(file.url, target, file.sha256, file.bytes, allowance);
                progress.update(++completed, manifest.files.size(), total);
            }
            validateDownloadedData(staging, manifest);
            writeAtomic(new AtomicFile(new File(staging, "manifest.json")), manifest.json.toString());
            Generation prepared = loadGeneration(id);
            synchronized (this) {
                String oldReadyId = ready == null ? "" : ready.id;
                writeAtomic(readyPointer, pointer(id, ""));
                ready = prepared;
                complete = true;
                if (!oldReadyId.isEmpty() && !isProtected(oldReadyId)) {
                    try { deleteGeneration(oldReadyId); } catch (IOException ignored) { }
                }
            }
        } finally {
            if (!complete) deleteGeneration(id);
        }
    }

    /** Called only between rounds. Files currently playing remain on the old immutable generation. */
    synchronized boolean activate() throws IOException {
        if (ready == null) return false;
        Generation prepared = loadGeneration(ready.id);
        String oldPrevious = previousId;
        String oldActive = active == null ? "" : active.id;
        writeAtomic(activePointer, pointer(prepared.id, oldActive));
        active = prepared;
        previousId = oldActive;
        ready = null;
        readyPointer.delete();
        if (!oldPrevious.isEmpty() && !isProtected(oldPrevious)) {
            try { deleteGeneration(oldPrevious); } catch (IOException ignored) { }
        }
        return true;
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        String uriPath = request.getUrl().getPath();
        if (uriPath == null || !uriPath.startsWith("/assets/content/")) return null;
        String path = uriPath.substring("/assets/".length());
        Generation snapshot;
        synchronized (this) { snapshot = active; }
        boolean downloaded = snapshot != null && snapshot.paths.contains(path);
        // Chromium's media loader requests byte ranges even for packaged WAVs.
        // The stock asset handler does not provide length/range response headers.
        if (!downloaded && !path.matches("content/assets/audio/[a-z0-9_]+\\.wav")) return null;
        try {
            UpdateManifest.contentPath(path);
            File file = downloaded ? confinedFile(snapshot.directory, path) : null;
            long length;
            if (file != null) {
                if (!file.isFile()) return emptyResponse(404, "Not Found", null);
                length = file.length();
            } else {
                try (android.content.res.AssetFileDescriptor descriptor = context.getAssets().openFd(path)) {
                    length = descriptor.getLength();
                }
            }
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("Accept-Ranges", "bytes");
            headers.put("X-Content-Type-Options", "nosniff");
            String range = null;
            for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
                if ("Range".equalsIgnoreCase(entry.getKey())) range = entry.getValue();
            }
            long start = 0;
            long end = length - 1;
            boolean partial = range != null;
            if (partial) {
                if (!range.matches("bytes=\\d*-\\d*")) return invalidRange(length);
                String[] values = range.substring(6).split("-", -1);
                if (values[0].isEmpty()) {
                    if (values[1].isEmpty()) return invalidRange(length);
                    long suffix = Long.parseLong(values[1]);
                    if (suffix < 1) return invalidRange(length);
                    start = Math.max(0, length - suffix);
                } else {
                    start = Long.parseLong(values[0]);
                    if (!values[1].isEmpty()) end = Math.min(end, Long.parseLong(values[1]));
                }
                if (start < 0 || start >= length || end < start) return invalidRange(length);
                headers.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
            }
            InputStream stream = file == null ? context.getAssets().open(path) : new FileInputStream(file);
            try {
                long remaining = start;
                while (remaining > 0) {
                    long skipped = stream.skip(remaining);
                    if (skipped <= 0) {
                        if (stream.read() == -1) throw new IOException("Incomplete local media.");
                        skipped = 1;
                    }
                    remaining -= skipped;
                }
            } catch (IOException exception) {
                stream.close();
                throw exception;
            }
            long responseLength = end - start + 1;
            headers.put("Content-Length", Long.toString(responseLength));
            return new WebResourceResponse(mimeType(path), path.endsWith(".json") ? "UTF-8" : null,
                    partial ? 206 : 200, partial ? "Partial Content" : "OK", headers,
                    new LimitedInputStream(stream, responseLength));
        } catch (IOException | NumberFormatException exception) {
            return emptyResponse(404, "Not Found", null);
        }
    }

    private synchronized void restore() {
        try {
            JSONObject pointer = new JSONObject(readAtomic(activePointer));
            previousId = pointer.optString("previous", "");
            try {
                active = loadGeneration(pointer.getString("generation"));
            } catch (IOException | JSONException exception) {
                if (!previousId.isEmpty()) {
                    active = loadGeneration(previousId);
                    previousId = "";
                    writeAtomic(activePointer, pointer(active.id, ""));
                }
            }
        } catch (IOException | JSONException exception) {
            active = null;
            previousId = "";
        }
        try {
            JSONObject pointer = new JSONObject(readAtomic(readyPointer));
            Generation prepared = loadGeneration(pointer.getString("generation"));
            if (active == null || !active.id.equals(prepared.id)) ready = prepared;
            else readyPointer.delete();
        } catch (IOException | JSONException exception) {
            ready = null;
        }
        File[] directories = generations.listFiles();
        if (directories != null) {
            for (File directory : directories) {
                if (!isProtected(directory.getName())) {
                    try { deleteGeneration(directory.getName()); } catch (IOException ignored) { }
                }
            }
        }
    }

    private Generation loadGeneration(String id) throws IOException {
        File directory = generationDirectory(id);
        UpdateManifest manifest = UpdateManifest.parse(readAtomic(new AtomicFile(new File(directory, "manifest.json"))));
        if (manifest.files.isEmpty() || manifest.minAppVersionCode > BuildConfig.VERSION_CODE) {
            throw new IOException("Local content batch is incompatible.");
        }
        Set<String> paths = new HashSet<>();
        for (UpdateManifest.MediaFile entry : manifest.files) {
            File file = confinedFile(directory, entry.path);
            if (!file.isFile() || file.length() < 1 || (entry.bytes > 0 && file.length() != entry.bytes)) {
                throw new IOException("Local content batch is incomplete.");
            }
            paths.add(entry.path);
        }
        return new Generation(id, directory, manifest, paths);
    }

    private void validateDownloadedData(File directory, UpdateManifest manifest) throws IOException {
        Set<String> available = new HashSet<>();
        for (UpdateManifest.MediaFile entry : manifest.files) available.add(entry.path);
        if(!available.contains("content/vocabulary.json"))throw new IOException("Vocabulary is missing from the content update.");
        for (UpdateManifest.MediaFile entry : manifest.files) {
            if (!entry.path.endsWith(".json")) continue;
            try (InputStream input = new FileInputStream(confinedFile(directory, entry.path))) {
                JSONTokener parser = new JSONTokener(readBounded(input, 2 * 1024 * 1024));
                Object data = parser.nextValue();
                if (!(data instanceof JSONObject) && !(data instanceof JSONArray)) {
                    throw new IOException("Downloaded JSON must contain an object or an array.");
                }
                if (parser.nextClean() != 0) throw new IOException("Downloaded JSON has trailing data.");
                if (entry.path.equals("content/vocabulary.json")) {
                    if (!(data instanceof JSONObject)) throw new IOException("Invalid vocabulary.");
                    JSONObject catalog=(JSONObject)data;
                    UpdateManifest.requiredInteger(catalog,"schemaVersion",1,1);
                    if(!manifest.contentVersion.equals(UpdateManifest.requiredString(catalog,"contentVersion"))) throw new IOException("Vocabulary version mismatch.");
                    JSONArray categories=catalog.getJSONArray("categories");
                    JSONArray words=catalog.getJSONArray("words");
                    if(categories.length()<1 || words.length()!=categories.length()*10)throw new IOException("Each topic must contain ten words.");
                    Map<String,Integer> counts=new HashMap<>();
                    for(int i=0;i<categories.length();i++) {
                        JSONObject category=categories.getJSONObject(i);
                        String id=UpdateManifest.requiredString(category,"id");
                        if(!id.matches("[a-z][a-z0-9_]{0,79}") || counts.put(id,0)!=null)throw new IOException("Invalid topic ID.");
                        if(UpdateManifest.requiredString(category,"title").isEmpty())throw new IOException("Topic title missing.");
                    }
                    Set<String> ids=new HashSet<>();
                    for(int i=0;i<words.length();i++) {
                        JSONObject word=words.getJSONObject(i);
                        String id=UpdateManifest.requiredString(word,"id");
                        String category=UpdateManifest.requiredString(word,"categoryId");
                        if(!id.matches("[a-z][a-z0-9_]{0,79}") || !ids.add(id) || !counts.containsKey(category))throw new IOException("Invalid vocabulary ID.");
                        counts.put(category,counts.get(category)+1);
                        for(String field:new String[]{"hebrew","english","pronunciation"})if(UpdateManifest.requiredString(word,field).isEmpty())throw new IOException("Word field missing.");
                        if(!"user_verified".equals(word.optString("audioStatus")))throw new IOException("Unapproved learning audio.");
                        String image=UpdateManifest.requiredString(word,"imageAsset");
                        String audio=UpdateManifest.requiredString(word,"audioAsset");
                        if(!image.matches("assets/photos/[a-z0-9_]+\\.(png|jpg|jpeg|webp)") || !audio.matches("assets/audio/[a-z0-9_]+\\.(wav|mp3)"))throw new IOException("Invalid vocabulary media path.");
                        requireCatalogMedia("content/"+image,available);
                        requireCatalogMedia("content/"+audio,available);
                        String audioHash=UpdateManifest.sha256(UpdateManifest.requiredString(word,"audioSha256"));
                        for(UpdateManifest.MediaFile file:manifest.files)if(file.path.equals("content/"+audio) && !file.sha256.equals(audioHash))throw new IOException("Audio checksum differs from vocabulary.");
                    }
                    for(int count:counts.values())if(count!=10)throw new IOException("Incomplete vocabulary topic.");
                }
            } catch (JSONException exception) {
                throw new IOException("Downloaded JSON or the vocabulary is invalid.", exception);
            }
        }
    }

    private static void requireCatalogMedia(String src, Set<String> available) throws IOException {
        String path = src.startsWith("./") ? src.substring(2) : src;
        UpdateManifest.contentPath(path);
        if (!available.contains(path)) throw new IOException("The content batch is missing a catalog media file.");
    }

    private static String readBounded(InputStream input, int maximumBytes) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > maximumBytes) throw new IOException("JSON file exceeds the size limit.");
            output.write(buffer, 0, count);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private boolean isProtected(String id) {
        return (active != null && active.id.equals(id)) || previousId.equals(id) ||
                (ready != null && ready.id.equals(id));
    }

    private void ensureSpace(long requiredBytes) throws IOException {
        if (new StatFs(generations.getAbsolutePath()).getAvailableBytes() < requiredBytes) {
            throw new IOException("There is not enough free space for this content batch.");
        }
    }

    private File generationDirectory(String id) throws IOException {
        if (id == null || !id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) {
            throw new IOException("Invalid local content generation.");
        }
        return confinedFile(generations, id);
    }

    private void deleteGeneration(String id) throws IOException {
        File directory = generationDirectory(id);
        deleteConfinedTree(directory, directory);
    }

    private static void deleteConfinedTree(File root, File file) throws IOException {
        String rootPath = root.getCanonicalPath();
        String filePath = file.getCanonicalPath();
        if (!filePath.equals(rootPath) && !filePath.startsWith(rootPath + File.separator)) {
            throw new IOException("Refusing to remove a file outside its content generation.");
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteConfinedTree(root, child);
        }
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove obsolete content.");
    }

    private static File confinedFile(File directory, String path) throws IOException {
        File target = new File(directory, path);
        String base = directory.getCanonicalPath() + File.separator;
        if (!target.getCanonicalPath().startsWith(base)) throw new IOException("Unsafe local file path.");
        return target;
    }

    private static String pointer(String id, String previous) throws IOException {
        try {
            return new JSONObject().put("generation", id).put("previous", previous).toString();
        } catch (JSONException exception) {
            throw new IOException("Cannot save local content state.", exception);
        }
    }

    private static void writeAtomic(AtomicFile file, String text) throws IOException {
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(text.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (IOException exception) {
            if (output != null) file.failWrite(output);
            throw exception;
        }
    }

    private static String readAtomic(AtomicFile file) throws IOException {
        return new String(file.readFully(), StandardCharsets.UTF_8);
    }

    private static WebResourceResponse invalidRange(long length) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Range", "bytes */" + length);
        return emptyResponse(416, "Range Not Satisfiable", headers);
    }

    static WebResourceResponse emptyResponse(int status, String reason, Map<String, String> headers) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
                headers == null ? new HashMap<>() : headers, new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".wav")) return "audio/wav";
        return "audio/mpeg";
    }

    private static final class Generation {
        final String id;
        final File directory;
        final UpdateManifest manifest;
        final Set<String> paths;

        Generation(String id, File directory, UpdateManifest manifest, Set<String> paths) {
            this.id = id;
            this.directory = directory;
            this.manifest = manifest;
            this.paths = paths;
        }
    }

    private static final class LimitedInputStream extends InputStream {
        private final InputStream input;
        private long remaining;

        LimitedInputStream(InputStream input, long remaining) {
            this.input = input;
            this.remaining = remaining;
        }

        @Override public int read() throws IOException {
            if (remaining <= 0) return -1;
            int result = input.read();
            if (result >= 0) remaining--;
            return result;
        }

        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0) return -1;
            int read = input.read(buffer, offset, (int) Math.min(length, remaining));
            if (read > 0) remaining -= read;
            return read;
        }

        @Override public void close() throws IOException { input.close(); }
    }
}

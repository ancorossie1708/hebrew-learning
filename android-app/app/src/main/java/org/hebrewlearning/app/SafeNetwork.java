package org.hebrewlearning.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** HTTPS only; redirects cannot escape GitHub's documented download hosts. */
final class SafeNetwork {
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList(
            "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com",
            "release-assets.githubusercontent.com", "api.github.com"));
    private static final int MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

    private SafeNetwork() { }

    static URL validateUrl(String text) throws IOException {
        try {
            URI uri = new URI(text);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null ||
                    !HOSTS.contains(host.toLowerCase(Locale.ROOT)) ||
                    (uri.getPort() != -1 && uri.getPort() != 443) ||
                    uri.getUserInfo() != null || uri.getFragment() != null) {
                throw new IOException("Update URLs must use a trusted GitHub HTTPS host.");
            }
            return uri.toURL();
        } catch (URISyntaxException | IllegalArgumentException exception) {
            throw new IOException("Invalid update URL.", exception);
        }
    }

    static String fetchManifest(String url) throws IOException {
        HttpURLConnection connection = open(url);
        try (InputStream input = connection.getInputStream();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Download interrupted.");
                total += count;
                if (total > MAX_MANIFEST_BYTES) throw new IOException("Update manifest is too large.");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } finally {
            connection.disconnect();
        }
    }

    static long download(String url, File target, String expectedHash, long expectedBytes,
                         long maxBytes) throws IOException {
        String validHash = UpdateManifest.sha256(expectedHash);
        File parent = target.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) {
            throw new IOException("Cannot create the download directory.");
        }
        HttpURLConnection connection = open(url);
        boolean complete = false;
        try {
            long reportedBytes = connection.getContentLengthLong();
            if (reportedBytes > maxBytes || (expectedBytes > 0 && reportedBytes > 0 &&
                    reportedBytes != expectedBytes)) {
                throw new IOException("The download size does not match the manifest.");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Download interrupted.");
                    total += count;
                    if (total > maxBytes) throw new IOException("Download exceeds the size limit.");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            if (total == 0 || (expectedBytes > 0 && total != expectedBytes) ||
                    !validHash.equals(hex(digest.digest()))) {
                throw new IOException("The downloaded file failed integrity verification.");
            }
            complete = true;
            return total;
        } catch (NoSuchAlgorithmException exception) {
            throw new IOException("SHA-256 is unavailable.", exception);
        } finally {
            connection.disconnect();
            if (!complete && target.isFile()) target.delete();
        }
    }

    private static HttpURLConnection open(String text) throws IOException {
        URL next = validateUrl(text);
        for (int redirect = 0; redirect <= 6; redirect++) {
            HttpURLConnection connection = (HttpURLConnection) next.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "WorldGameJourney/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept-Encoding", "identity");
            int status;
            try {
                status = connection.getResponseCode();
            } catch (IOException exception) {
                connection.disconnect();
                throw exception;
            }
            if (status >= 300 && status <= 399) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("The download redirect is missing a URL.");
                next = validateUrl(new URL(next, location).toString());
                continue;
            }
            if (status != HttpURLConnection.HTTP_OK) {
                connection.disconnect();
                throw new IOException("The update server returned HTTP " + status + ".");
            }
            return connection;
        }
        throw new IOException("Too many download redirects.");
    }

    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) text.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return text.toString();
    }
}

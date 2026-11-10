package app.kuytu.messenger;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends BridgeActivity {
    private static final String CHANNEL_ID = "kuytu_messages";
    private static final int REQ_NOTIF_PERMISSION = 9101;
    private volatile String pendingApkUrl = null;
    private volatile boolean isDownloadingApk = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        if (window != null) {
            int bg = Color.parseColor("#121110");
            window.setStatusBarColor(bg);
            window.setNavigationBarColor(bg);
        }
        ensureNotificationChannel();
        handleNotificationIntent(getIntent());
    }

    @Override
    protected void load() {
        WebView preWebView = findViewById(com.getcapacitor.android.R.id.webview);
        if (preWebView != null) {
            WebSettings settings = preWebView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            preWebView.addJavascriptInterface(new KuytuBridge(), "KuytuAndroid");
        }
        super.load();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingApkUrl != null && !isDownloadingApk && canInstallUnknownPackages()) {
            String urlToResume = pendingApkUrl;
            pendingApkUrl = null;
            startApkDownloadAndInstall(urlToResume);
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Mesaj Bildirimleri",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Yeni mesaj bildirimleri");
            channel.enableVibration(true);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        final String convId = intent.getStringExtra("kuytu_conv_id");
        if (convId == null || convId.isEmpty()) return;
        intent.removeExtra("kuytu_conv_id");

        if (getBridge() != null && getBridge().getWebView() != null) {
            final WebView wv = getBridge().getWebView();
            wv.postDelayed(() -> {
                String safeConv = JSONObject.quote(convId);
                String js = "window.dispatchEvent(new CustomEvent('kuytu:open-chat', { detail: " + safeConv + " }));";
                wv.evaluateJavascript(js, null);
            }, 350);
        }
    }

    private void dispatchJsEvent(String eventName, String detailJson) {
        runOnUiThread(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            String js = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(eventName) + ", { detail: " + detailJson + " }));";
            getBridge().getWebView().evaluateJavascript(js, null);
        });
    }

    private boolean canInstallUnknownPackages() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    private void openUnknownSourcesSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        }
    }

    private void emitApkProgress(String status, int percent, String message) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("status", status);
            obj.put("percent", percent);
            if (message != null) obj.put("message", message);
            dispatchJsEvent("kuytu:apk-progress", obj.toString());
        } catch (Exception ignored) {
        }
    }

    private void startApkDownloadAndInstall(final String apkUrl) {
        if (apkUrl == null || !apkUrl.startsWith("https://")) {
            emitApkProgress("error", 0, "Geçersiz güncelleme bağlantısı.");
            return;
        }
        if (!canInstallUnknownPackages()) {
            pendingApkUrl = apkUrl;
            emitApkProgress("permission", 0, "Bilinmeyen kaynaklardan kurulum izni gerekli.");
            openUnknownSourcesSettings();
            return;
        }
        if (isDownloadingApk) return;
        isDownloadingApk = true;
        emitApkProgress("downloading", 0, null);

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String currentUrl = apkUrl;
                int redirects = 0;
                while (redirects < 8) {
                    URL url = new URL(currentUrl);
                    String host = url.getHost().toLowerCase();
                    if (!host.equals("github.com") && !host.endsWith(".github.com") && !host.endsWith(".githubusercontent.com")) {
                        throw new SecurityException("Güvenilmeyen indirme kaynağı: " + host);
                    }
                    conn = (HttpURLConnection) url.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "Kuytu-Android-Updater");
                    conn.connect();

                    int code = conn.getResponseCode();
                    if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == HttpURLConnection.HTTP_SEE_OTHER
                        || code == 307
                        || code == 308) {
                        String location = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (location == null || location.isEmpty()) {
                            throw new Exception("Yönlendirme adresi bulunamadı.");
                        }
                        currentUrl = new URL(url, location).toString();
                        redirects++;
                        continue;
                    }
                    if (code != HttpURLConnection.HTTP_OK) {
                        throw new Exception("Sunucu yanıtı: HTTP " + code);
                    }
                    break;
                }

                int totalBytes = conn.getContentLength();
                File updateDir = new File(getCacheDir(), "updates");
                if (!updateDir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    updateDir.mkdirs();
                }
                File apkFile = new File(updateDir, "kuytu-update.apk");
                if (apkFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    apkFile.delete();
                }

                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(apkFile)) {
                    byte[] buffer = new byte[16 * 1024];
                    long downloaded = 0;
                    int lastPercent = -1;
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        downloaded += read;
                        if (totalBytes > 0) {
                            int pct = (int) Math.min(99L, (downloaded * 100L) / totalBytes);
                            if (pct != lastPercent) {
                                lastPercent = pct;
                                emitApkProgress("downloading", pct, null);
                            }
                        }
                    }
                    out.flush();
                }

                emitApkProgress("installing", 100, null);
                runOnUiThread(() -> launchPackageInstaller(apkFile));
            } catch (Exception e) {
                emitApkProgress("error", 0, "İndirme hatası: " + e.getMessage());
            } finally {
                isDownloadingApk = false;
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void launchPackageInstaller(File apkFile) {
        try {
            Uri apkUri = FileProvider.getUriForFile(
                this,
                getPackageName() + ".fileprovider",
                apkFile
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(installIntent);
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().postDelayed(() -> emitApkProgress("idle", 0, null), 2000);
            }
        } catch (Exception e) {
            emitApkProgress("error", 0, "Kurulum başlatılamadı: " + e.getMessage());
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIF_PERMISSION) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            dispatchJsEvent("kuytu:notif-permission", JSONObject.quote(granted ? "granted" : "denied"));
        }
    }

    public class KuytuBridge {
        @JavascriptInterface
        public String getVersionName() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return info.versionName != null ? info.versionName : "1.0.3";
            } catch (Exception e) {
                return "1.0.3";
            }
        }

        @JavascriptInterface
        public String getNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                int status = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS);
                if (status == PackageManager.PERMISSION_GRANTED) return "granted";
                return "default";
            }
            boolean enabled = NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
            return enabled ? "granted" : "denied";
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    int status = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS);
                    if (status == PackageManager.PERMISSION_GRANTED) {
                        dispatchJsEvent("kuytu:notif-permission", JSONObject.quote("granted"));
                        return;
                    }
                    ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQ_NOTIF_PERMISSION
                    );
                } else {
                    boolean enabled = NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
                    if (!enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        Intent settingsIntent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                        startActivity(settingsIntent);
                    }
                    dispatchJsEvent("kuytu:notif-permission", JSONObject.quote(enabled ? "granted" : "denied"));
                }
            });
        }

        @JavascriptInterface
        public void showNotification(String title, String body, String convId) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                        return;
                    }
                }
                Intent tapIntent = new Intent(MainActivity.this, MainActivity.class);
                tapIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                if (convId != null) {
                    tapIntent.putExtra("kuytu_conv_id", convId);
                }
                int reqCode = convId != null ? convId.hashCode() : 1001;
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pendingIntent = PendingIntent.getActivity(MainActivity.this, reqCode, tapIntent, flags);

                NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .setContentTitle(title != null ? title : "Kuytu")
                    .setContentText(body != null ? body : "Yeni mesaj")
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent);

                NotificationManagerCompat.from(MainActivity.this).notify(reqCode, builder.build());
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public boolean canInstallPackages() {
            return canInstallUnknownPackages();
        }

        @JavascriptInterface
        public void openInstallPermissionSettings() {
            runOnUiThread(MainActivity.this::openUnknownSourcesSettings);
        }

        @JavascriptInterface
        public void downloadAndInstallApk(String apkUrl) {
            runOnUiThread(() -> startApkDownloadAndInstall(apkUrl));
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                int duration = Math.max(5, Math.min(200, ms));
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    //noinspection deprecation
                    v.vibrate(duration);
                }
            } catch (Exception ignored) {
            }
        }
    }
}

package app.rdesk.cofre;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/** O que a página pode pedir ao Android. Nada aqui fala com a internet fora do Tor. */
final class Bridge {
    private static final String CHANNEL = "avisos";
    private final MainActivity act;
    private final WebView web;
    private final TorManager tor;
    private final TorNet net;
    private final Handler main = new Handler(Looper.getMainLooper());
    private int notifSeq = 1;
    private BioVault bio;
    private BtcLuz btc;

    Bridge(MainActivity act, WebView web, TorManager tor, TorNet net) {
        this.act = act;
        this.web = web;
        this.tor = tor;
        this.net = net;
    }

    void deliver(int id, JSONObject result) {
        final String js = "window.__rdeskDone&&window.__rdeskDone(" + id + "," + result.toString() + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    void pushTorState(JSONObject st) {
        final String js = "window.__rdeskTor&&window.__rdeskTor(" + st.toString() + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    @JavascriptInterface public void request(int id, String json) {
        net.request(json, r -> deliver(id, r));
    }

    private BioVault bio() { if (bio == null) bio = new BioVault(act); return bio; }

    @JavascriptInterface public boolean bioAvailable() { return bio().available(); }

    @JavascriptInterface public String bioStatus() { return bio().status().toString(); }

    @JavascriptInterface public void bioEncrypt(int id, String plain) { bio().encrypt(plain, r -> deliver(id, r)); }

    @JavascriptInterface public void bioDecrypt(int id, String ct, String iv) { bio().decrypt(ct, iv, r -> deliver(id, r)); }

    @JavascriptInterface public void bioForget() { bio().forget(); }

    private synchronized BtcLuz btc() {
        if (btc == null) btc = new BtcLuz(act, tor, net, st -> {
            final String js = "window.__rdeskBtc&&window.__rdeskBtc(" + st.toString() + ")";
            main.post(() -> web.evaluateJavascript(js, null));
            return kotlin.Unit.INSTANCE;
        });
        return btc;
    }

    @JavascriptInterface public void btcStart(String cfg) { btc().start(cfg); }
    @JavascriptInterface public void btcStop() { btc().stop(); }
    @JavascriptInterface public void btcWipe() { btc().wipe(); }
    @JavascriptInterface public String btcState() { return btc().stateJson(true).toString(); }
    @JavascriptInterface public void btcBroadcast(int id, String hex) {
        new Thread(() -> deliver(id, btc().broadcast(hex)), "btc-envio").start();
    }

    void close() { if (btc != null) btc.close(); }

    @JavascriptInterface public String getBridge() {
        JSONObject o = new JSONObject();
        try { o.put("modo", Pontes.modo(act)); o.put("proprias", Pontes.proprias(act)); } catch (Exception ignored) { }
        return o.toString();
    }

    @JavascriptInterface public void setBridge(String modo, String proprias) {
        Pontes.salvar(act, modo, proprias);
        main.post(tor::restart);
    }

    @JavascriptInterface public String torState() { return tor.stateJson().toString(); }

    @JavascriptInterface public int versionCode() { return BuildConfig.VERSION_CODE; }

    @JavascriptInterface public void copy(String text) {
        main.post(() -> {
            ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return;
            ClipData clip = ClipData.newPlainText("RDESK", text);
            if (Build.VERSION.SDK_INT >= 24) {
                PersistableBundle extras = new PersistableBundle();
                extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
                clip.getDescription().setExtras(extras);
            }
            cm.setPrimaryClip(clip);
            main.postDelayed(() -> {
                try {
                    ClipData now = cm.getPrimaryClip();
                    if (now == null || now.getItemCount() == 0) return;
                    CharSequence t = now.getItemAt(0).getText();
                    if (t == null || !t.toString().equals(text)) return;
                    if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
                    else cm.setPrimaryClip(ClipData.newPlainText("", ""));
                } catch (Exception ignored) { }
            }, 60_000);
        });
    }

    /** Abre um ponto (coordenada) no Waze, no Google Maps ou no app de GPS que a pessoa escolher. Só com toque dela. */
    @JavascriptInterface public void openGeo(double lat, double lon, String app) {
        if (Double.isNaN(lat) || Double.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        String c = String.format(java.util.Locale.US, "%.5f,%.5f", lat, lon);
        main.post(() -> {
            Uri geo = Uri.parse("geo:" + c + "?q=" + c);
            Uri uri = "waze".equals(app) ? Uri.parse("https://waze.com/ul?ll=" + c + "&navigate=yes")
                    : "google".equals(app) ? Uri.parse("google.navigation:q=" + c) : geo;
            try {
                act.startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception e) {
                try { act.startActivity(Intent.createChooser(new Intent(Intent.ACTION_VIEW, geo), "Abrir no GPS")); } catch (Exception ignored) { }
            }
        });
    }

    /** Mantém a tela acesa (corrida em andamento / motorista online no BRLS). Desliga ao sair do app. */
    @JavascriptInterface public void keepScreenOn(boolean liga) {
        main.post(() -> {
            if (liga) act.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else act.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @JavascriptInterface public String paste() {
        FutureTask<String> task = new FutureTask<>(() -> {
            ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip()) return "";
            ClipData c = cm.getPrimaryClip();
            if (c == null || c.getItemCount() == 0) return "";
            CharSequence t = c.getItemAt(0).coerceToText(act);
            return t == null ? "" : t.toString();
        });
        main.post(task);
        try { return task.get(3, TimeUnit.SECONDS); } catch (Exception e) { return ""; }
    }

    @JavascriptInterface public void share(String name, String text, String mime) {
        main.post(() -> {
            try {
                String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
                File dir = new File(act.getCacheDir(), "share");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, safe);
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(text.getBytes(StandardCharsets.UTF_8)); }
                Uri uri = FileProvider.getUriForFile(act, act.getPackageName() + ".arquivos", f);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime == null || mime.isEmpty() ? "text/plain" : mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                act.startActivity(Intent.createChooser(send, "Salvar ou enviar"));
            } catch (Exception ignored) { }
        });
    }

    @JavascriptInterface public String notifPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (act.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return "granted";
            return act.getPreferences(Context.MODE_PRIVATE).getBoolean("notif_asked", false) ? "denied" : "default";
        }
        NotificationManager nm = (NotificationManager) act.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.areNotificationsEnabled() ? "granted" : "denied";
    }

    @JavascriptInterface public void requestNotif(int id) {
        main.post(() -> act.askNotifications(id));
    }

    void notifResult(int id) {
        JSONObject o = new JSONObject();
        try { o.put("perm", notifPermission()); } catch (Exception ignored) { }
        deliver(id, o);
    }

    @JavascriptInterface public void notify(String title, String body) {
        main.post(() -> {
            if (!"granted".equals(notifPermission())) return;
            NotificationManager nm = (NotificationManager) act.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                if (nm.getNotificationChannel(CHANNEL) == null) {
                    nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Avisos do cofre", NotificationManager.IMPORTANCE_DEFAULT));
                }
                b = new Notification.Builder(act, CHANNEL);
            } else {
                b = new Notification.Builder(act);
            }
            b.setSmallIcon(R.drawable.ic_aviso).setContentTitle(title).setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true)
                    .setVisibility(Notification.VISIBILITY_PRIVATE);
            nm.notify(notifSeq++, b.build());
        });
    }

    @SuppressWarnings("unused")
    private static boolean hasText(ClipDescription d) { return d != null && d.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN); }
}

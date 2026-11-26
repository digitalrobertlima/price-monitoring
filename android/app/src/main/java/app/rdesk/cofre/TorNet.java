package app.rdesk.cofre;

import android.util.Base64;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.ConnectionPool;
import okhttp3.CookieJar;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Todas as conexões do app para fora. Só existem por dentro do Tor:
 * - proxy SOCKS do Tor (o nome do site é resolvido na saída do Tor, nunca no DNS do celular);
 * - DNS local proibido (se algum dia for chamado, falha em vez de vazar);
 * - um cliente separado por caminho do Tor (nenhuma conexão é reaproveitada entre endereços);
 * - sem cookies, sem cache, mesmo "navegador" para todo mundo.
 */
public final class TorNet {
    public interface Done { void done(JSONObject result); }

    static final String UA = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0";
    private static final long MAX_BODY = 25L * 1024 * 1024;

    private final TorManager tor;
    private final OkHttpClient[] clients = new OkHttpClient[TorManager.SLOTS];
    private final ExecutorService pool = Executors.newFixedThreadPool(6);

    TorNet(TorManager tor) { this.tor = tor; }

    private OkHttpClient client(int slot) {
        if (slot < 0 || slot >= TorManager.SLOTS) slot = 0;
        synchronized (clients) {
            if (clients[slot] == null) {
                OkHttpClient.Builder b = new OkHttpClient.Builder();
                if (TorManager.SEM_TOR) {
                    // APK direto: rede do celular (sem proxy, DNS normal). Continua sem cookies, sem cache, só https.
                    b.proxy(Proxy.NO_PROXY);
                } else {
                    b.proxy(new Proxy(Proxy.Type.SOCKS, new InetSocketAddress("127.0.0.1", tor.port(slot))))
                     .dns(host -> { throw new UnknownHostException("DNS local bloqueado: " + host); });
                }
                clients[slot] = b
                        .cookieJar(CookieJar.NO_COOKIES)
                        .cache(null)
                        .connectionPool(new ConnectionPool(2, 30, TimeUnit.SECONDS))
                        .connectTimeout(45, TimeUnit.SECONDS)
                        .readTimeout(60, TimeUnit.SECONDS)
                        .writeTimeout(60, TimeUnit.SECONDS)
                        .callTimeout(120, TimeUnit.SECONDS)
                        .followRedirects(true)
                        .followSslRedirects(false)
                        .retryOnConnectionFailure(true)
                        .build();
            }
            return clients[slot];
        }
    }

    public void request(String json, Done cb) {
        pool.execute(() -> cb.done(run(json)));
    }

    private static JSONObject error(String msg) {
        JSONObject o = new JSONObject();
        try { o.put("error", msg); } catch (Exception ignored) { }
        return o;
    }

    private JSONObject run(String json) {
        try {
            JSONObject req = new JSONObject(json);
            String url = req.getString("url");
            if (!url.startsWith("https://")) return error("Só https é permitido.");
            if (!tor.awaitReady(120_000)) return error("O Tor ainda não conectou. Nada sai do app sem ele.");
            String method = req.optString("method", "GET").toUpperCase(Locale.ROOT);
            int slot = req.optInt("slot", 0);

            Headers.Builder hb = new Headers.Builder();
            JSONObject h = req.optJSONObject("headers");
            String contentType = null;
            if (h != null) {
                Iterator<String> it = h.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    String lk = k.toLowerCase(Locale.ROOT);
                    String v = h.optString(k, "");
                    if (lk.equals("content-type")) contentType = v;
                    if (lk.equals("host") || lk.equals("connection") || lk.equals("content-length") || lk.equals("cookie")
                            || lk.equals("user-agent") || lk.equals("origin") || lk.equals("referer")
                            || lk.equals("accept-language") || lk.startsWith("sec-") || lk.startsWith("proxy-")) continue;
                    try { hb.add(k, v); } catch (IllegalArgumentException ignored) { }
                }
            }
            hb.set("User-Agent", UA);

            RequestBody body = null;
            if (!method.equals("GET") && !method.equals("HEAD")) {
                byte[] bytes = req.isNull("body") ? new byte[0] : Base64.decode(req.getString("body"), Base64.NO_WRAP);
                body = RequestBody.create(bytes, contentType == null ? null : MediaType.parse(contentType));
            }
            Request r = new Request.Builder().url(url).headers(hb.build()).method(method, body).build();
            try (Response resp = client(slot).newCall(r).execute()) {
                JSONObject out = new JSONObject();
                out.put("status", resp.code());
                out.put("statusText", resp.message());
                JSONObject rh = new JSONObject();
                for (String name : resp.headers().names()) {
                    String ln = name.toLowerCase(Locale.ROOT);
                    if (ln.equals("set-cookie")) continue;
                    rh.put(ln, resp.header(name));
                }
                out.put("headers", rh);
                ResponseBody rb = resp.body();
                byte[] data = new byte[0];
                if (rb != null) {
                    try (InputStream in = rb.byteStream()) {
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384];
                        long total = 0;
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            total += n;
                            if (total > MAX_BODY) return error("Resposta grande demais.");
                            bos.write(buf, 0, n);
                        }
                        data = bos.toByteArray();
                    }
                }
                out.put("body", Base64.encodeToString(data, Base64.NO_WRAP));
                return out;
            }
        } catch (Exception e) {
            String m = e.getMessage();
            return error((TorManager.SEM_TOR ? "Falha na rede" : "Falha pela rede Tor") + (m == null ? "" : ": " + m));
        }
    }
}

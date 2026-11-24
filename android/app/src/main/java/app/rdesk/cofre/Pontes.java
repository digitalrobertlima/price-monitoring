package app.rdesk.cofre;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import IPtProxy.Controller;
import IPtProxy.OnTransportEvents;

/**
 * Pontes do Tor ("pluggable transports", via IPtProxy, a mesma biblioteca do Orbot).
 * Escondem da operadora que o celular usa Tor e furam bloqueios.
 *   nenhuma   → Tor direto (padrão)
 *   snowflake → parece uma chamada de vídeo; passa por voluntários
 *   obfs4     → tráfego embaralhado, sem cara de nada; pontes embutidas
 *   propria   → linhas "Bridge" que a pessoa recebeu (bridges.torproject.org, Telegram @GetBridgesBot, e-mail)
 */
final class Pontes {
    static final String PREFS = "rede";
    static final String KEY_MODO = "ponte";
    static final String KEY_PROPRIAS = "pontesProprias";

    private static Controller controller;

    static String modo(Context c) { return prefs(c).getString(KEY_MODO, "nenhuma"); }
    static String proprias(Context c) { return prefs(c).getString(KEY_PROPRIAS, ""); }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void salvar(Context c, String modo, String proprias) {
        prefs(c).edit().putString(KEY_MODO, modo == null ? "nenhuma" : modo).putString(KEY_PROPRIAS, proprias == null ? "" : proprias).commit();
    }

    /** Linhas do torrc para a ponte escolhida. Liga o transporte antes de o Tor começar. */
    static List<String> torrc(Context ctx) throws Exception {
        List<String> out = new ArrayList<>();
        String modo = modo(ctx);
        if ("nenhuma".equals(modo)) return out;
        JSONObject cfg = new JSONObject(readRaw(ctx));
        List<String> bridges = new ArrayList<>();
        if ("snowflake".equals(modo)) {
            JSONArray a = cfg.getJSONArray("snowflake");
            for (int i = 0; i < a.length(); i++) bridges.add(a.getString(i));
        } else if ("obfs4".equals(modo)) {
            JSONArray a = cfg.getJSONArray("obfs4");
            for (int i = 0; i < a.length(); i++) bridges.add(a.getString(i));
        } else if ("propria".equals(modo)) {
            for (String l : proprias(ctx).split("\\r?\\n")) {
                String t = l.trim();
                if (t.toLowerCase(Locale.ROOT).startsWith("bridge ")) t = t.substring(7).trim();
                if (!t.isEmpty()) bridges.add(t);
            }
        }
        if (bridges.isEmpty()) return out;

        List<String> transportes = new ArrayList<>();
        for (String b : bridges) {
            String first = b.split("\\s+")[0];
            String tr = first.contains(":") ? "" : first.toLowerCase(Locale.ROOT); // linha sem transporte = ponte comum
            if (!tr.isEmpty() && !transportes.contains(tr)) transportes.add(tr);
        }
        Controller c = controller(ctx);
        JSONObject sf = cfg.getJSONObject("snowflakeConfig");
        for (String tr : transportes) {
            if (tr.equals("snowflake")) {
                c.setSnowflakeBrokerUrl(sf.getString("url"));
                c.setSnowflakeFrontDomains(sf.getString("fronts"));
                c.setSnowflakeIceServers(sf.getString("ice"));
                c.setSnowflakeMaxPeers(1);
            }
            try { c.stop(tr); } catch (Exception ignored) { }
            c.start(tr, "");
            long port = c.port(tr);
            if (port <= 0) throw new IllegalStateException("A ponte " + tr + " não abriu");
            out.add("ClientTransportPlugin " + tr + " socks5 127.0.0.1:" + port);
        }
        out.add("UseBridges 1");
        for (String b : bridges) out.add("Bridge " + b);
        return out;
    }

    static void pararTudo() {
        if (controller == null) return;
        for (String tr : new String[]{"snowflake", "obfs4", "webtunnel", "meek_lite"}) {
            try { controller.stop(tr); } catch (Exception ignored) { }
        }
    }

    private static synchronized Controller controller(Context ctx) {
        if (controller == null) {
            File dir = new File(ctx.getNoBackupFilesDir(), "pontes");
            if (!dir.exists()) dir.mkdirs();
            controller = new Controller(dir.getAbsolutePath(), false, false, "ERROR", new OnTransportEvents() {
                @Override public void connected(String name) { }
                @Override public void error(String name, Exception e) { }
                @Override public void stopped(String name, Exception e) { }
            });
        }
        return controller;
    }

    private static String readRaw(Context ctx) throws Exception {
        try (InputStream in = ctx.getResources().openRawResource(R.raw.pontes)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString(StandardCharsets.UTF_8.name());
        }
    }
}

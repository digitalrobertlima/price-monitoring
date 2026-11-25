package app.rdesk.cofre;

import android.content.res.AssetManager;
import android.webkit.WebResourceResponse;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serve um app de confiança (o BRLS) a partir dos arquivos dentro do APK.
 * Nada é baixado na hora: o app que roda é exatamente o que foi compilado e conferido no build reproduzível.
 */
final class AppAssets {
    private static final Map<String, String> TIPOS = new HashMap<>();
    static {
        TIPOS.put("html", "text/html");
        TIPOS.put("js", "text/javascript");
        TIPOS.put("mjs", "text/javascript");
        TIPOS.put("css", "text/css");
        TIPOS.put("json", "application/json");
        TIPOS.put("webmanifest", "application/manifest+json");
        TIPOS.put("svg", "image/svg+xml");
        TIPOS.put("png", "image/png");
        TIPOS.put("ico", "image/x-icon");
        TIPOS.put("txt", "text/plain");
        TIPOS.put("woff2", "font/woff2");
    }

    private final AssetManager assets;
    private final String prefix;

    AppAssets(AssetManager assets, String prefix) {
        this.assets = assets;
        this.prefix = prefix;
    }

    /** Caminho relativo (ex.: "src/app.js"); vazio ou terminado em "/" abre o index.html. Null se não existir. */
    WebResourceResponse open(String rel) {
        if (rel == null) return null;
        if (rel.isEmpty() || rel.endsWith("/")) rel = rel + "index.html";
        if (rel.contains("..") || rel.contains("\\") || rel.startsWith("/")) return null;
        int dot = rel.lastIndexOf('.');
        String tipo = dot < 0 ? null : TIPOS.get(rel.substring(dot + 1).toLowerCase(Locale.ROOT));
        if (tipo == null) return null; // só tipos conhecidos
        try {
            InputStream in = assets.open(prefix + rel);
            boolean texto = tipo.startsWith("text/") || tipo.startsWith("application/") || tipo.equals("image/svg+xml");
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(tipo, texto ? "utf-8" : null, 200, "OK", headers, in);
        } catch (IOException e) {
            return null;
        }
    }
}

package app.rdesk.cofre;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.os.IBinder;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import org.json.JSONObject;
import org.torproject.jni.TorService;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tor embutido (tor-android, do Guardian Project).
 * Abre 16 portas SOCKS: o Tor nunca mistura, num mesmo caminho, conexões de portas diferentes.
 *   porta 0      → consultas públicas (preço, câmbio)
 *   portas 1..14 → uma por endereço da carteira
 *   porta 15     → envio de transações
 */
public final class TorManager {
    static final int SLOTS = 16;

    interface Listener { void onState(JSONObject state); }

    private final Context ctx;
    private final Listener listener;
    private final int[] ports = new int[SLOTS];
    private volatile String state = "starting";
    private volatile int progress = 0;
    private volatile String summary = "";
    private volatile TorService service;
    private volatile boolean started = false;
    private volatile boolean stopping = false;
    private final Object lock = new Object();

    private final ServiceConnection conn = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((TorService.LocalBinder) binder).getService();
        }
        @Override public void onServiceDisconnected(ComponentName name) { service = null; }
    };

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (TorService.ACTION_ERROR.equals(i.getAction())) {
                setState("error", progress, i.getStringExtra(Intent.EXTRA_TEXT));
                return;
            }
            String st = i.getStringExtra(TorService.EXTRA_STATUS);
            if (TorService.STATUS_ON.equals(st)) setState("on", 100, "");
            else if (TorService.STATUS_STOPPING.equals(st) || TorService.STATUS_OFF.equals(st)) {
                if (!stopping) setState("error", progress, "Tor parou");
            }
        }
    };

    TorManager(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
    }

    /** APK "direto": não existe Tor; a rede é a do celular e está sempre "pronta". */
    static final boolean SEM_TOR = !BuildConfig.TOR;

    void start() {
        if (started) return;
        started = true;
        if (SEM_TOR) { setState("on", 100, "Conexão direta (sem Tor)"); return; }
        try {
            pickPorts();
        } catch (IOException e) {
            setState("error", 0, "Não deu para preparar o Tor: " + e.getMessage());
            return;
        }
        IntentFilter f = new IntentFilter(TorService.ACTION_STATUS);
        f.addAction(TorService.ACTION_ERROR);
        LocalBroadcastManager.getInstance(ctx).registerReceiver(receiver, f);
        Thread poll = new Thread(this::pollBootstrap, "tor-progresso");
        poll.setDaemon(true);
        poll.start();
        launch();
    }

    /** Escreve o torrc (com a ponte escolhida) e liga o Tor. */
    private void launch() {
        new Thread(() -> {
            try {
                writeTorrc();
            } catch (Exception e) {
                setState("error", 0, "Não deu para preparar a ponte do Tor: " + e.getMessage());
                return;
            }
            stopping = false;
            ctx.bindService(new Intent(ctx, TorService.class), conn, Context.BIND_AUTO_CREATE);
        }, "tor-inicio").start();
    }

    /** Religa o Tor (ex.: trocou a ponte). Enquanto isso, nada sai do app. */
    void restart() {
        if (SEM_TOR) return;
        stopping = true;
        setState("starting", 0, "Religando o Tor");
        try { ctx.unbindService(conn); } catch (Exception ignored) { }
        try { ctx.stopService(new Intent(ctx, TorService.class)); } catch (Exception ignored) { }
        service = null;
        Pontes.pararTudo();
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(this::launch, 1500);
    }

    String ponte() { return Pontes.modo(ctx); }

    void stop() {
        if (SEM_TOR) return;
        stopping = true;
        Pontes.pararTudo();
        try { LocalBroadcastManager.getInstance(ctx).unregisterReceiver(receiver); } catch (Exception ignored) { }
        try { ctx.unbindService(conn); } catch (Exception ignored) { }
        try { ctx.stopService(new Intent(ctx, TorService.class)); } catch (Exception ignored) { }
    }

    public int port(int slot) {
        if (slot < 0 || slot >= SLOTS) slot = 0;
        return ports[slot];
    }

    boolean isOn() { return "on".equals(state); }

    /** Espera o Tor ficar pronto. Nunca existe "tenta direto". */
    public boolean awaitReady(long ms) {
        long end = System.currentTimeMillis() + ms;
        synchronized (lock) {
            while (!isOn()) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) return false;
                try { lock.wait(left); } catch (InterruptedException e) { return false; }
            }
        }
        return true;
    }

    JSONObject stateJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            o.put("progress", progress);
            o.put("summary", summary);
            o.put("ponte", Pontes.modo(ctx));
            o.put("direto", SEM_TOR);
        } catch (Exception ignored) { }
        return o;
    }

    private void setState(String st, int pct, String msg) {
        boolean changed = !st.equals(state) || pct != progress;
        state = st;
        progress = pct;
        summary = msg == null ? "" : msg;
        if ("on".equals(st)) synchronized (lock) { lock.notifyAll(); }
        if (changed && listener != null) listener.onState(stateJson());
    }

    private void pollBootstrap() {
        Pattern pp = Pattern.compile("PROGRESS=(\\d+)");
        Pattern ps = Pattern.compile("SUMMARY=\"([^\"]*)\"");
        while (!stopping) {
            try { Thread.sleep(700); } catch (InterruptedException e) { return; }
            TorService s = service;
            if (s == null || s.getTorControlConnection() == null) continue;
            String info = s.getInfo("status/bootstrap-phase");
            if (info == null) continue;
            Matcher m = pp.matcher(info);
            if (!m.find()) continue;
            int pct = Integer.parseInt(m.group(1));
            Matcher sm = ps.matcher(info);
            String sum = sm.find() ? sm.group(1) : "";
            if (stopping) continue;
            if (pct >= 100) setState("on", 100, "");
            else if (!isOn()) setState("starting", pct, sum);
        }
    }

    private void pickPorts() throws IOException {
        ServerSocket[] held = new ServerSocket[SLOTS];
        try {
            InetAddress lo = InetAddress.getByName("127.0.0.1");
            for (int i = 0; i < SLOTS; i++) {
                held[i] = new ServerSocket(0, 1, lo);
                ports[i] = held[i].getLocalPort();
            }
        } finally {
            for (ServerSocket s : held) if (s != null) try { s.close(); } catch (IOException ignored) { }
        }
    }

    private void writeTorrc() throws Exception {
        StringBuilder sb = new StringBuilder();
        for (String l : Pontes.torrc(ctx)) sb.append(l).append('\n');
        for (int p : ports) sb.append("SOCKSPort 127.0.0.1:").append(p).append('\n');
        sb.append("HTTPTunnelPort 0\n");
        sb.append("DNSPort 0\n");
        sb.append("TransPort 0\n");
        sb.append("TestSocks 0\n");
        sb.append("AvoidDiskWrites 1\n");
        sb.append("ClientOnly 1\n");
        File f = TorService.getTorrc(ctx);
        File dir = f.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("sem pasta do Tor");
        try (FileWriter w = new FileWriter(f, false)) { w.write(sb.toString()); }
    }
}

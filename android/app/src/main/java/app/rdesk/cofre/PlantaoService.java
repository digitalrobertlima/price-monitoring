package app.rdesk.cofre;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * "Plantão" do BRLS: enquanto há corrida em andamento, motorista online ou loja recebendo pedidos,
 * um aviso fixo mantém o app vivo em segundo plano. Assim o BRLS (dentro do WebView, pelo Tor)
 * continua conferindo a blockchain e manda notificação de pedido novo, motorista a caminho etc.
 * Nada roda escondido: o aviso fica visível o tempo todo e some quando o plantão acaba.
 */
public final class PlantaoService extends Service {
    static final String CANAL = "plantao";
    static final int ID = 7001;
    static volatile boolean ativo = false;

    static void ligar(Context ctx, String texto) {
        Intent i = new Intent(ctx, PlantaoService.class).putExtra("texto", texto == null ? "" : texto);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
    }

    static void desligar(Context ctx) {
        ctx.stopService(new Intent(ctx, PlantaoService.class));
        ativo = false;
    }

    static PendingIntent abrirApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String texto = intent != null ? intent.getStringExtra("texto") : "";
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            if (nm != null && nm.getNotificationChannel(CANAL) == null) {
                NotificationChannel c = new NotificationChannel(CANAL, "Plantão do BRLS (corrida e pedidos)", NotificationManager.IMPORTANCE_LOW);
                c.setShowBadge(false);
                nm.createNotificationChannel(c);
            }
            b = new Notification.Builder(this, CANAL);
        } else {
            b = new Notification.Builder(this);
        }
        b.setSmallIcon(R.drawable.ic_aviso)
                .setContentTitle("BRLS de plantão")
                .setContentText(texto == null || texto.isEmpty() ? "Conferindo pedidos e corridas" : texto)
                .setOngoing(true)
                .setContentIntent(abrirApp(this))
                .setVisibility(Notification.VISIBILITY_PRIVATE);
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ID, b.build());
        ativo = true;
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() { ativo = false; super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}

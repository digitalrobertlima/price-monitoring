package app.rdesk.cofre;

import android.app.Activity;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Biometria de verdade: a chave que protege a senha do cofre nasce e fica no chip seguro do celular
 * (Android Keystore, StrongBox quando existir) e só funciona depois da digital ou do rosto "forte".
 * Se alguém cadastrar uma digital nova no celular, a chave é invalidada e o cofre pede a senha de novo.
 */
final class BioVault {
    interface Done { void done(JSONObject result); }

    private static final String ALIAS = "cofre_biometria_v1";
    private final Activity act;

    BioVault(Activity act) { this.act = act; }

    // Android 11+: digital/rosto forte OU o bloqueio de tela do celular (PIN, padrão, senha).
    // Nos dois casos a chave do chip só abre depois da verificação (CryptoObject).
    private static int authenticators() {
        return BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    boolean available() {
        try { return availableOrThrow(); } catch (Exception e) { return false; }
    }

    private boolean availableOrThrow() {
        if (Build.VERSION.SDK_INT < 29) return false;
        BiometricManager bm = act.getSystemService(BiometricManager.class);
        if (bm == null) return false;
        if (Build.VERSION.SDK_INT >= 30) return bm.canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS;
        return bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
    }

    private static String why(int code) {
        switch (code) {
            case BiometricManager.BIOMETRIC_SUCCESS: return "ok";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "nada-cadastrado";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "sem-sensor";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE: return "sensor-ocupado";
            default:
                if (Build.VERSION.SDK_INT >= 31 && code == BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED) return "atualizacao";
                return "codigo-" + code;
        }
    }

    /** Diagnóstico para a tela: o que o celular oferece e por que não dá, quando não dá. */
    JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("sdk", Build.VERSION.SDK_INT);
            if (Build.VERSION.SDK_INT < 29) { o.put("ok", false); o.put("motivo", "android-antigo"); return o; }
            BiometricManager bm = act.getSystemService(BiometricManager.class);
            if (bm == null) { o.put("ok", false); o.put("motivo", "sem-sensor"); return o; }
            if (Build.VERSION.SDK_INT >= 30) {
                o.put("forte", why(bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)));
                o.put("fraca", why(bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)));
                o.put("bloqueio", why(bm.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL)));
                int all = bm.canAuthenticate(authenticators());
                o.put("ok", all == BiometricManager.BIOMETRIC_SUCCESS);
                o.put("motivo", why(all));
            } else {
                int c = bm.canAuthenticate();
                o.put("forte", why(c));
                o.put("ok", c == BiometricManager.BIOMETRIC_SUCCESS);
                o.put("motivo", why(c));
            }
        } catch (Exception e) {
            try { o.put("ok", false); o.put("motivo", "erro"); o.put("erro", e.getClass().getSimpleName() + ": " + e.getMessage()); } catch (Exception ignored) { }
        }
        return o;
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
        if (!create) return null;
        try { return generate(true); } catch (StrongBoxUnavailableException e) { return generate(false); }
    }

    private SecretKey generate(boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(b.build());
        return kg.generateKey();
    }

    void forget() {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        } catch (Exception ignored) { }
    }

    private static JSONObject err(String m) {
        JSONObject o = new JSONObject();
        try { o.put("error", m); } catch (Exception ignored) { }
        return o;
    }

    /** Cifra a senha do cofre: pede a digital, devolve {ct, iv}. */
    void encrypt(String plain, Done cb) {
        act.runOnUiThread(() -> {
            if (!available()) { cb.done(err("Este celular não tem digital, rosto forte ou bloqueio de tela cadastrado.")); return; }
            Cipher c;
            try {
                forget(); // cada ativação usa uma chave nova
                c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, key(true));
            } catch (Exception e) { cb.done(err("Não deu para criar a chave da biometria: " + e.getMessage())); return; }
            prompt("Ativar a digital no cofre", c, cipher -> {
                byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
                JSONObject o = new JSONObject();
                o.put("ct", Base64.encodeToString(ct, Base64.NO_WRAP));
                o.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
                return o;
            }, cb);
        });
    }

    /** Decifra a senha do cofre: pede a digital, devolve {text}. */
    void decrypt(String ctB64, String ivB64, Done cb) {
        act.runOnUiThread(() -> {
            Cipher c;
            try {
                SecretKey k = key(false);
                if (k == null) { cb.done(err("A biometria não está ativada neste celular. Use a senha.")); return; }
                c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Base64.decode(ivB64, Base64.NO_WRAP)));
            } catch (KeyPermanentlyInvalidatedException e) {
                forget();
                cb.done(err("A biometria do celular mudou (digital nova?). Por segurança, abra com a senha e ative a digital de novo."));
                return;
            } catch (Exception e) { cb.done(err("Não deu para usar a biometria: " + e.getMessage())); return; }
            prompt("Abrir o cofre", c, cipher -> {
                byte[] pt = cipher.doFinal(Base64.decode(ctB64, Base64.NO_WRAP));
                JSONObject o = new JSONObject();
                o.put("text", new String(pt, StandardCharsets.UTF_8));
                return o;
            }, cb);
        });
    }

    private interface Step { JSONObject run(Cipher c) throws Exception; }

    private void prompt(String title, Cipher cipher, Step step, Done cb) {
        if (Build.VERSION.SDK_INT < 29) { cb.done(err("Biometria precisa de Android 10 ou mais novo.")); return; }
        BiometricPrompt.Builder pb = new BiometricPrompt.Builder(act).setTitle(title);
        if (Build.VERSION.SDK_INT >= 30) {
            // Com o bloqueio de tela permitido, o Android mostra o próprio botão "Usar PIN/padrão"
            pb.setSubtitle("Use a digital, o rosto ou o bloqueio de tela do celular");
            pb.setAllowedAuthenticators(authenticators());
        } else {
            pb.setSubtitle("Use a digital ou o rosto")
              .setNegativeButton("Usar a senha", act.getMainExecutor(), (d, w) -> cb.done(err("Cancelado. Use a senha.")));
        }
        pb.setConfirmationRequired(false);
        BiometricPrompt bp = pb.build();
        bp.authenticate(new BiometricPrompt.CryptoObject(cipher), new CancellationSignal(), act.getMainExecutor(),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                        try { cb.done(step.run(r.getCryptoObject().getCipher())); }
                        catch (Exception e) { cb.done(err("A biometria não confere com o cofre deste aparelho. Use a senha.")); }
                    }
                    @Override public void onAuthenticationError(int code, CharSequence msg) {
                        cb.done(err(msg == null ? "Biometria cancelada." : msg.toString()));
                    }
                });
    }
}

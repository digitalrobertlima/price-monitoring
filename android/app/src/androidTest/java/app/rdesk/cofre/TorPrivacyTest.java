package app.rdesk.cofre;

import android.util.Log;

import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/**
 * Roda o APK de verdade num emulador:
 * - o app abre e o Tor embutido conecta;
 * - a saída para a internet é mesmo pelo Tor (check.torproject.org);
 * - caminhos diferentes por endereço;
 * - o WebView não consegue sair por fora (XHR, imagem, WebSocket bloqueados);
 * - relatório de quais serviços do app aceitam conexões vindas do Tor;
 * - o app BRLS abre de dentro do APK e lê a Polygon pela rede (Tor) da Caixa Forte.
 */
@RunWith(AndroidJUnit4.class)
public class TorPrivacyTest {
    private static final String TAG = "RDESKTEST";

    private static String js(ActivityScenario<MainActivity> sc, String expr, long timeoutMs) throws Exception {
        final String token = "t" + System.nanoTime();
        final String start = "(function(){window.__T=window.__T||{};window.__T['" + token + "']=null;(async()=>{try{const v=await (" + expr + ");"
                + "window.__T['" + token + "']=JSON.stringify({ok:true,v:v});}catch(e){window.__T['" + token + "']=JSON.stringify({ok:false,e:String(e&&e.message||e)});}})();return 1;})()";
        run(sc, start);
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            String raw = run(sc, "(window.__T&&window.__T['" + token + "'])||null");
            if (raw != null && !"null".equals(raw)) {
                String s = new JSONArray("[" + raw + "]").getString(0);
                return s;
            }
            Thread.sleep(400);
        }
        return "{\"ok\":false,\"e\":\"tempo esgotado\"}";
    }

    private static String run(ActivityScenario<MainActivity> sc, String code) throws Exception {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<String> out = new AtomicReference<>();
        sc.onActivity(a -> a.web.evaluateJavascript(code, v -> { out.set(v); done.countDown(); }));
        done.await(20, TimeUnit.SECONDS);
        return out.get();
    }

    private static JSONObject obj(String s) throws Exception { return new JSONObject(s); }

    @Test
    public void tudoPeloTor() throws Exception {
        // Com -e ponte snowflake|obfs4 o mesmo teste roda com o Tor por uma ponte
        String ponte = InstrumentationRegistry.getArguments().getString("ponte", "nenhuma");
        Pontes.salvar(InstrumentationRegistry.getInstrumentation().getTargetContext(), ponte, "");
        boolean comPonte = !"nenhuma".equals(ponte);
        Log.i(TAG, "ponte: " + ponte);
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            // 1. o app carregou
            JSONObject boot = obj(js(sc, "new Promise(r=>{const t=setInterval(()=>{if(window.RdeskRegistry&&window.RDESK_NATIVE&&document.body){clearInterval(t);r(true)}},300)})", 60_000));
            assertTrue("app não carregou: " + boot, boot.optBoolean("ok"));

            // 2. o WebView não sai por fora, nem antes do Tor
            JSONObject xhr = obj(js(sc, "new Promise(r=>{try{const x=new XMLHttpRequest();x.open('GET','https://example.com/');x.onload=()=>r('VAZOU');x.onerror=()=>r('bloqueado');x.send();}catch(e){r('bloqueado')}})", 30_000));
            assertEquals("XHR direto", "bloqueado", xhr.optString("v"));
            JSONObject img = obj(js(sc, "new Promise(r=>{const i=new Image();i.onload=()=>r('VAZOU');i.onerror=()=>r('bloqueado');i.src='https://example.com/x.png?'+Date.now();})", 30_000));
            assertEquals("imagem direta", "bloqueado", img.optString("v"));
            JSONObject ws = obj(js(sc, "typeof WebSocket", 10_000));
            assertEquals("WebSocket", "undefined", ws.optString("v"));
            JSONObject sw = obj(js(sc, "navigator.serviceWorker.register('./sw.js').then(()=>'VAZOU',()=> 'bloqueado')", 10_000));
            assertEquals("service worker", "bloqueado", sw.optString("v"));

            // 2b. biometria: responde sem travar e o cofre só oferece a digital se o celular tiver
            JSONObject bio = obj(js(sc, "({nativo: RdeskNativeBio.available(), cofreOferece: RdeskWallet.isBiometrySupported(), registrada: RdeskWallet.isBiometryRegistered(), status: RdeskNativeBio.status()})", 10_000));
            Log.i(TAG, "biometria: " + bio);
            assertTrue("biometria quebrou: " + bio, bio.optBoolean("ok"));
            JSONObject bv = bio.getJSONObject("v");
            assertEquals("o cofre só oferece digital quando o celular tem", bv.optBoolean("nativo"), bv.optBoolean("cofreOferece"));
            JSONObject bst = bv.optJSONObject("status");
            assertTrue("diagnóstico da biometria vazio: " + bio, bst != null && bst.has("motivo"));
            // Emulador com PIN de tela cadastrado (sem digital): o cofre tem que oferecer o desbloqueio
            if ("ok".equals(bst.optString("bloqueio"))) assertTrue("com PIN de tela o app tem que oferecer a biometria: " + bio, bv.optBoolean("nativo"));

            // 3. Tor conecta
            JSONObject tor = obj(js(sc, "new Promise(r=>{const t=setInterval(()=>{const s=JSON.parse(RdeskNative.torState());if(s.state==='on'){clearInterval(t);r(s)}},1000)})", comPonte ? 480_000 : 300_000));
            Log.i(TAG, "estado do Tor: " + tor);
            assertTrue("Tor não conectou: " + tor, tor.optBoolean("ok"));

            // 4. a saída é mesmo pelo Tor
            JSONObject check = obj(js(sc, "fetch('https://check.torproject.org/api/ip').then(r=>r.json())", 120_000));
            Log.i(TAG, "check.torproject.org: " + check);
            assertTrue("check falhou: " + check, check.optBoolean("ok"));
            assertTrue("não saiu pelo Tor: " + check, check.getJSONObject("v").optBoolean("IsTor"));

            // 5. endereços diferentes → caminhos diferentes (a saída costuma mudar)
            JSONObject iso = obj(js(sc, "Promise.all(['0x1111111111111111111111111111111111111111','0x2222222222222222222222222222222222222222'].map(a=>fetch('https://check.torproject.org/api/ip?a='+a).then(r=>r.json()).then(j=>j.IP)))", 180_000));
            Log.i(TAG, "isolamento: " + iso + " slots=" + run(sc, "JSON.stringify(['0x1111111111111111111111111111111111111111','0x2222222222222222222222222222222222222222'].map(a=>RdeskIsolation.slotFor(a)))"));

            assertEquals("ponte em uso", ponte, tor.getJSONObject("v").optString("ponte"));
            if (comPonte) return; // com ponte basta provar que conecta e sai pelo Tor

            // 6a. App BRLS dentro da carteira: abre de dentro do APK (sem baixar nada) e lê a Polygon pelo Tor da Caixa Forte.
            //     Carteira de mentira só para abrir a janela (endereço público, sem chave).
            JSONObject brls = obj(js(sc, "(async()=>{const real=window.RdeskWallet;window.RdeskWallet={address:'0x2F8Fe2689411Bb336301AD4f2DC4077D433F43d1',isLocked:()=>false,isWatchOnly:()=>false,onAccountChange:()=>()=>{},openModal(){}};"
                    + "try{RdeskApps.abrir('brls');const ifr=document.querySelector('iframe.app-frame');if(!ifr)throw new Error('sem janela');"
                    + "const fim=Date.now()+240000;while(Date.now()<fim&&RdeskApps.redeOk()<3)await new Promise(r=>setTimeout(r,1000));"
                    + "return {src:ifr.src,redeOk:RdeskApps.redeOk()};}finally{RdeskApps.fechar();window.RdeskWallet=real;}})()", 300_000));
            Log.i(TAG, "BRLS dentro da carteira: " + brls);
            assertTrue("BRLS não abriu: " + brls, brls.optBoolean("ok"));
            assertTrue("BRLS sem tor=ponte: " + brls, brls.getJSONObject("v").optString("src").contains("tor=ponte"));
            assertTrue("BRLS não leu a Polygon pelo Tor: " + brls, brls.getJSONObject("v").optInt("redeOk") >= 3);

            // 6. relatório: quais serviços do app aceitam o Tor
            String[][] probes = {
                    {"preços DefiLlama", "fetch('https://coins.llama.fi/prices/current/coingecko:bitcoin').then(r=>r.json()).then(j=>j.coins['coingecko:bitcoin'].price)"},
                    {"preços CoinGecko", "fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl').then(r=>r.json()).then(j=>j.bitcoin.brl)"},
                    {"Polygon publicnode", rpc("https://polygon-bor-rpc.publicnode.com")},
                    {"Polygon drpc", rpc("https://polygon.drpc.org")},
                    {"Polygon 1rpc", rpc("https://1rpc.io/matic")},
                    {"Ethereum publicnode", rpc("https://ethereum-rpc.publicnode.com")},
                    {"Base oficial", rpc("https://mainnet.base.org")},
                    {"Arbitrum oficial", rpc("https://arb1.arbitrum.io/rpc")},
                    {"BNB dataseed", rpc("https://bsc-dataseed.bnbchain.org")},
                    {"BNB publicnode", rpc("https://bsc-rpc.publicnode.com")},
                    {"Celo forno", rpc("https://forno.celo.org")},
                    {"HyperEVM", rpc("https://rpc.hyperliquid.xyz/evm")},
                    {"mempool.space", "fetch('https://mempool.space/api/blocks/tip/height').then(r=>r.text())"},
                    {"blockstream", "fetch('https://blockstream.info/api/blocks/tip/height').then(r=>r.text())"},
                    {"Blockscout Polygon", "fetch('https://polygon.blockscout.com/api/v2/stats').then(r=>r.status)"},
                    {"Banco Central PTAX", "fetch('https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/Moedas?$format=json').then(r=>r.status)"},
                    {"LI.FI", "fetch('https://li.quest/v1/chains').then(r=>r.status)"},
                    {"Dash insight", "fetch('https://insight.dash.org/insight-api/status').then(r=>r.status)"},
                    {"GitHub (atualização)", "fetch('https://api.github.com/repos/digitalrobertlima/price-monitoring/releases?per_page=1').then(r=>r.status)"},
            };
            int okCount = 0;
            for (String[] p : probes) {
                JSONObject res = obj(js(sc, p[1], 90_000));
                if (res.optBoolean("ok")) okCount++;
                Log.i(TAG, "SERVICO " + (res.optBoolean("ok") ? "OK   " : "FALHA") + " " + p[0] + " → " + (res.optBoolean("ok") ? res.opt("v") : res.optString("e")));
            }
            Log.i(TAG, "serviços que aceitam Tor: " + okCount + "/" + probes.length);

            // 7. Bitcoin sem servidor (Kyoto): sincroniza direto com a rede Bitcoin, pelo Tor
            String m = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            JSONObject ini = obj(js(sc, "(async()=>{const d=RdeskBitcoin.accountDescriptors('" + m + "','',0);const b=await RdeskNativeBtc._birthday('novo');"
                    + "RdeskNativeBtc._start({id:'teste-ci',ext:d.ext,int:d.int,height:b.height,hash:b.hash});return {d:d.ext.slice(0,40),b}})()", 120_000));
            Log.i(TAG, "kyoto início: " + ini);
            assertTrue("kyoto não começou: " + ini, ini.optBoolean("ok"));
            JSONObject luz = obj(js(sc, "new Promise(r=>{const t=setInterval(()=>{const s=JSON.parse(RdeskNative.btcState());"
                    + "if(s.estado==='pronto'||s.estado==='erro'){clearInterval(t);r({estado:s.estado,altura:s.altura,msg:s.mensagem,utxos:(s.dados&&s.dados.utxos||[]).length,vigiados:(s.dados&&s.dados.vigiados||[]).length})}},2000)})", 540_000));
            Log.i(TAG, "kyoto: " + luz);
            assertTrue("Kyoto não sincronizou: " + luz, luz.optBoolean("ok") && "pronto".equals(luz.getJSONObject("v").optString("estado")));
            assertTrue("Kyoto sem endereços vigiados", luz.getJSONObject("v").optInt("vigiados") >= 80);
            if (okCount < probes.length / 2) fail("Poucos serviços aceitaram conexões pelo Tor: " + okCount);
        }
    }

    private static String rpc(String url) {
        return "fetch('" + url + "',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})}).then(r=>r.json()).then(j=>parseInt(j.result,16))";
    }
}

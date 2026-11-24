package app.rdesk.cofre

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.bitcoindevkit.Address
import org.bitcoindevkit.BlockHash
import org.bitcoindevkit.BlockId
import org.bitcoindevkit.CbfBuilder
import org.bitcoindevkit.CbfClient
import org.bitcoindevkit.ChainPosition
import org.bitcoindevkit.Descriptor
import org.bitcoindevkit.Info
import org.bitcoindevkit.IpAddress
import org.bitcoindevkit.KeychainKind
import org.bitcoindevkit.Network
import org.bitcoindevkit.NetworkKind
import org.bitcoindevkit.OutPoint
import org.bitcoindevkit.Peer
import org.bitcoindevkit.Persister
import org.bitcoindevkit.RecoveryPoint
import org.bitcoindevkit.ScanType
import org.bitcoindevkit.Script
import org.bitcoindevkit.Socks5Proxy
import org.bitcoindevkit.Transaction
import org.bitcoindevkit.Wallet
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Bitcoin sem perguntar nada a servidor nenhum (BIP157/158, "Kyoto", do Bitcoin Dev Kit).
 * O celular baixa os filtros de cada bloco direto da rede Bitcoin, pelo Tor, e descobre sozinho
 * o que é dele. Nenhum servidor recebe os seus endereços.
 * Só recebe as chaves PÚBLICAS (descritores); as palavras nunca saem do cofre.
 */
class BtcLuz(
    private val ctx: Context,
    private val tor: TorManager,
    private val net: TorNet,
    private val emit: (JSONObject) -> Unit
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    @Volatile private var client: CbfClient? = null
    @Volatile private var wallet: Wallet? = null
    @Volatile private var persister: Persister? = null
    @Volatile private var estado = "desligado"
    @Volatile private var progresso = 0.0
    @Volatile private var altura = 0
    @Volatile private var mensagem = ""
    @Volatile private var snapshot: JSONObject? = null
    @Volatile private var idAtual = ""

    fun stateJson(withSnapshot: Boolean): JSONObject {
        val o = JSONObject()
        o.put("estado", estado)
        o.put("progresso", progresso)
        o.put("altura", altura)
        o.put("mensagem", mensagem)
        o.put("id", idAtual)
        if (withSnapshot) snapshot?.let { o.put("dados", it) }
        return o
    }

    private fun set(st: String, msg: String = mensagem, pct: Double = progresso, snap: Boolean = false) {
        estado = st
        mensagem = msg
        progresso = pct
        emit(stateJson(snap))
    }

    fun start(cfgJson: String) {
        stop()
        val cfg = JSONObject(cfgJson)
        idAtual = cfg.optString("id")
        job = scope.launch {
            try {
                run(cfg)
            } catch (e: Throwable) {
                set("erro", "Bitcoin sem servidor parou: " + (e.message ?: e.javaClass.simpleName))
            }
        }
    }

    fun stop() {
        try { client?.shutdown() } catch (_: Throwable) { }
        client = null
        job?.cancel()
        job = null
        estado = "desligado"
    }

    fun wipe() {
        stop()
        File(ctx.noBackupFilesDir, "btc-luz").deleteRecursively()
        snapshot = null
    }

    private suspend fun run(cfg: JSONObject) {
        set("preparando", "Esperando o Tor", 0.0)
        if (!tor.awaitReady(180_000)) throw IllegalStateException("o Tor não conectou")
        val id = cfg.getString("id").replace(Regex("[^A-Za-z0-9_-]"), "_")
        val dir = File(ctx.noBackupFilesDir, "btc-luz/$id").apply { mkdirs() }
        val ext = Descriptor(cfg.getString("ext"), NetworkKind.MAIN)
        val int = Descriptor(cfg.getString("int"), NetworkKind.MAIN)
        val dbFile = File(dir, "carteira.sqlite")

        var p = Persister.newSqlite(dbFile.absolutePath)
        var w: Wallet? = try { Wallet.load(ext, int, p, 40u) } catch (_: Throwable) { null }
        var nova = false
        if (w == null) {
            // banco de outra carteira ou corrompido: começa do zero
            dir.listFiles()?.forEach { it.deleteRecursively() }
            p = Persister.newSqlite(dbFile.absolutePath)
            w = Wallet(ext, int, Network.BITCOIN, p, 40u)
            nova = true
        }
        wallet = w
        persister = p

        val scan = if (nova || w.latestCheckpoint().height == 0u) {
            val h = cfg.getInt("height")
            val hash = BlockHash.fromString(cfg.getString("hash"))
            ScanType.Recovery(100u, RecoveryPoint.Other(BlockId(h.toUInt(), hash)))
        } else ScanType.Sync

        set("preparando", "Procurando nós da rede Bitcoin pelo Tor")
        val peers = findPeers()
        if (peers.isEmpty()) throw IllegalStateException("nenhum nó da rede Bitcoin encontrado")

        val comps = CbfBuilder()
            .dataDir(dir.absolutePath)
            .scanType(scan)
            .peers(peers)
            .onlyConfiguredPeers()
            .connections(2u)
            .socks5Proxy(Socks5Proxy(IpAddress.fromIpv4(127u, 0u, 0u, 1u), tor.port(0).toUShort()))
            .configureTimeoutMillis(30_000u, 60_000u)
            .build(w)
        comps.node.run()
        val c = comps.client
        client = c
        publish()
        set("sincronizando", "Baixando os filtros dos blocos", 0.0, snap = true)

        scope.launch {
            while (isActive && client === c) {
                try {
                    when (val info = c.nextInfo()) {
                        is Info.Progress -> {
                            altura = info.chainHeight.toInt()
                            if (estado != "pronto") set("sincronizando", "Baixando os filtros dos blocos", info.filtersDownloadedPercent.toDouble())
                        }
                        is Info.ConnectionsMet -> if (estado != "pronto") set("sincronizando", "Conectado a nós da rede Bitcoin")
                        else -> { }
                    }
                } catch (_: Throwable) { break }
            }
        }

        while (scope.isActive && client === c) {
            val upd = c.update()
            w.applyUpdate(upd)
            w.persist(p)
            altura = w.latestCheckpoint().height.toInt()
            publish()
            set("pronto", "Em dia com a rede Bitcoin", 100.0, snap = true)
        }
    }

    /** Endereços de nós Bitcoin vindos dos "seeds" de DNS, perguntados pelo Tor (DNS por HTTPS). */
    private fun findPeers(): List<Peer> {
        val seeds = listOf("seed.bitcoin.sipa.be", "dnsseed.bluematt.me", "seed.bitcoinstats.com", "seed.btc.petertodd.net", "seed.bitcoin.sprovoost.nl")
        val ips = LinkedHashSet<String>()
        for (s in seeds) {
            val latch = java.util.concurrent.CountDownLatch(1)
            var body: JSONObject? = null
            val req = JSONObject().put("url", "https://dns.google/resolve?name=$s&type=A").put("method", "GET").put("slot", 0)
            net.request(req.toString()) { r -> body = r; latch.countDown() }
            latch.await(90, java.util.concurrent.TimeUnit.SECONDS)
            val b64 = body?.optString("body") ?: continue
            try {
                val j = JSONObject(String(android.util.Base64.decode(b64, android.util.Base64.NO_WRAP)))
                val ans = j.optJSONArray("Answer") ?: continue
                for (i in 0 until ans.length()) {
                    val d = ans.getJSONObject(i).optString("data")
                    if (Regex("^\\d+\\.\\d+\\.\\d+\\.\\d+$").matches(d)) ips.add(d)
                }
            } catch (_: Throwable) { }
            if (ips.size >= 24) break
        }
        return ips.shuffled().take(24).map { ip ->
            val q = ip.split(".").map { it.toInt().toUByte() }
            Peer(IpAddress.fromIpv4(q[0], q[1], q[2], q[3]), null, false)
        }
    }

    private fun addr(s: Script): String? = try { Address.fromScript(s, Network.BITCOIN).toString() } catch (_: Throwable) { null }

    /** Fotografia da carteira no formato que o app já usa (estilo Esplora). */
    private fun publish() {
        val w = wallet ?: return
        val utxos = JSONArray()
        for (u in w.listUnspent()) {
            val conf = u.chainPosition is ChainPosition.Confirmed
            utxos.put(JSONObject()
                .put("txid", u.outpoint.txid.toString())
                .put("vout", u.outpoint.vout.toLong())
                .put("value", u.txout.value.toSat().toLong())
                .put("address", addr(u.txout.scriptPubkey))
                .put("confirmed", conf))
        }
        val txs = JSONArray()
        for (ct in w.transactions()) {
            val tx = ct.transaction
            val vout = JSONArray()
            for (o in tx.output()) vout.put(JSONObject().put("scriptpubkey_address", addr(o.scriptPubkey)).put("value", o.value.toSat().toLong()))
            val vin = JSONArray()
            for (i in tx.input()) {
                val prev = try {
                    w.getTx(i.previousOutput.txid)?.transaction?.output()?.getOrNull(i.previousOutput.vout.toInt())
                } catch (_: Throwable) { null }
                vin.put(JSONObject().put("prevout", if (prev == null) JSONObject.NULL else
                    JSONObject().put("scriptpubkey_address", addr(prev.scriptPubkey)).put("value", prev.value.toSat().toLong())))
            }
            val status = JSONObject()
            when (val pos = ct.chainPosition) {
                is ChainPosition.Confirmed -> {
                    status.put("confirmed", true)
                    status.put("block_time", pos.confirmationBlockTime.confirmationTime.toLong())
                    status.put("block_height", pos.confirmationBlockTime.blockId.height.toLong())
                }
                is ChainPosition.Unconfirmed -> status.put("confirmed", false)
            }
            val fee = try { w.calculateFee(tx).toSat().toLong() } catch (_: Throwable) { 0L }
            txs.put(JSONObject().put("txid", tx.computeTxid().toString()).put("vin", vin).put("vout", vout).put("status", status).put("fee", fee))
        }
        val vigiados = JSONArray()
        for (k in listOf(KeychainKind.EXTERNAL, KeychainKind.INTERNAL)) {
            val last = (w.derivationIndex(k)?.toInt() ?: -1) + 40
            for (i in 0..last) vigiados.put(w.peekAddress(k, i.toUInt()).address.toString())
        }
        snapshot = JSONObject().put("utxos", utxos).put("txs", txs).put("vigiados", vigiados).put("altura", altura)
    }

    /** Envia a transação direto para a rede Bitcoin, pelo Tor. Devolve o txid. */
    fun broadcast(hex: String): JSONObject {
        val c = client ?: return JSONObject().put("error", "Bitcoin sem servidor ainda não conectou")
        return try {
            val bytes = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
            val tx = Transaction(bytes)
            runBlocking { c.broadcast(tx) }
            JSONObject().put("txid", tx.computeTxid().toString())
        } catch (e: Throwable) {
            JSONObject().put("error", "A rede recusou: " + (e.message ?: ""))
        }
    }

    fun close() { stop(); scope.cancel() }

    @Suppress("unused") private fun unused(o: OutPoint) = o
}

/* =========================================================================
   RDESK SENTINEL — LEITOR DE QR CODE
   Abre a câmera traseira, lê o QR e devolve o texto. Também lê de uma foto.
   Usa o leitor nativo do navegador quando existe; senão, a biblioteca jsQR
   (guardada em vendor/). Nada sai do aparelho.
   ========================================================================= */
(function (global) {
    'use strict';

    // Interpreta o conteúdo de um QR de pagamento/endereço.
    // Devolve { kind: 'evm' | 'bitcoin' | 'lightning' | 'text', address, chainId, amount, raw }
    function parsePayload(text) {
        const raw = String(text || '').trim();
        const out = { kind: 'text', address: '', chainId: null, amount: null, raw };
        if (!raw) return out;

        if (/^lightning:/i.test(raw) || /^ln(bc|tb|bcrt)[0-9a-z]+$/i.test(raw) || /^lnurl/i.test(raw)) {
            return { ...out, kind: 'lightning', address: raw.replace(/^lightning:/i, '') };
        }

        // bitcoin:<endereço>?amount=0.001
        const btc = raw.match(/^bitcoin:([a-zA-Z0-9]+)(\?.*)?$/i);
        if (btc) {
            const amount = new URLSearchParams((btc[2] || '').slice(1)).get('amount');
            return { ...out, kind: 'bitcoin', address: btc[1], amount: amount && Number(amount) > 0 ? amount : null };
        }

        // ethereum:0xabc…@137  |  ethereum:pay-0xabc…  |  eip155:137:0xabc…
        const evm = raw.match(/^(?:ethereum|polygon|arbitrum|base|optimism|celo):(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?/i);
        if (evm) return { ...out, kind: 'evm', address: evm[1], chainId: evm[2] ? Number(evm[2]) : null };
        const caip = raw.match(/^eip155:(\d+):(0x[0-9a-fA-F]{40})$/i);
        if (caip) return { ...out, kind: 'evm', address: caip[2], chainId: Number(caip[1]) };

        if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return { ...out, kind: 'evm', address: raw };
        if (global.RdeskBitcoin && global.RdeskBitcoin.isValidAddress(raw)) return { ...out, kind: 'bitcoin', address: raw };
        return out;
    }

    function decodeFrame(source, width, height, ctx) {
        ctx.drawImage(source, 0, 0, width, height);
        const image = ctx.getImageData(0, 0, width, height);
        const result = global.jsQR ? global.jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' }) : null;
        return result && result.data ? result.data : null;
    }

    async function decodeImageFile(file) {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        return decodeFrame(bitmap, canvas.width, canvas.height, canvas.getContext('2d', { willReadFrequently: true }));
    }

    // Abre o leitor. Resolve com o texto lido, ou null se a pessoa cancelar.
    function scan(options = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'qr-scan-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-label', 'Leitor de QR Code');
            overlay.innerHTML = `
                <div class="qr-scan-card">
                    <div class="qr-scan-head">
                        <button type="button" class="qr-scan-btn-icon" data-qr-cancel aria-label="Voltar">←</button>
                        <strong class="qr-scan-title"></strong>
                    </div>
                    <div class="qr-scan-viewport">
                        <video playsinline muted></video>
                        <div class="qr-scan-frame" aria-hidden="true"></div>
                    </div>
                    <p class="qr-scan-msg" role="status">Abrindo a câmera…</p>
                    <label class="qr-scan-file">
                        🖼️ Ler de uma foto
                        <input type="file" accept="image/*" hidden>
                    </label>
                </div>`;
            overlay.querySelector('.qr-scan-title').textContent = options.title || 'Aponte para o QR Code';
            document.body.appendChild(overlay);

            const video = overlay.querySelector('video');
            const msg = overlay.querySelector('.qr-scan-msg');
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            let stream = null, timer = 0, done = false;

            const finish = (value) => {
                if (done) return;
                done = true;
                clearInterval(timer);
                if (stream) stream.getTracks().forEach((t) => t.stop());
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(value);
            };
            const onKey = (e) => { if (e.key === 'Escape') finish(null); };
            document.addEventListener('keydown', onKey);
            overlay.querySelector('[data-qr-cancel]').onclick = () => finish(null);

            overlay.querySelector('input[type=file]').onchange = async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const text = await decodeImageFile(file);
                    if (text) finish(text);
                    else msg.textContent = 'Não encontrei um QR Code nessa foto. Tente outra, mais nítida.';
                } catch (err) {
                    msg.textContent = 'Não consegui abrir essa imagem.';
                }
            };

            const detector = ('BarcodeDetector' in global) ? (() => { try { return new global.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { return null; } })() : null;

            const tick = async () => {
                if (done || video.readyState < 2 || !video.videoWidth) return;
                try {
                    if (detector) {
                        const found = await detector.detect(video);
                        if (found && found[0] && found[0].rawValue) return finish(found[0].rawValue);
                    }
                    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
                    canvas.width = Math.round(video.videoWidth * scale);
                    canvas.height = Math.round(video.videoHeight * scale);
                    const text = decodeFrame(video, canvas.width, canvas.height, ctx);
                    if (text) finish(text);
                } catch (e) {}
            };

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                msg.textContent = 'Este navegador não libera a câmera aqui. Use "Ler de uma foto" ou cole o endereço.';
                return;
            }
            navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
                .then((s) => {
                    if (done) { s.getTracks().forEach((t) => t.stop()); return; }
                    stream = s;
                    video.srcObject = s;
                    video.play().catch(() => {});
                    msg.textContent = 'Centralize o QR Code dentro do quadro.';
                    timer = setInterval(tick, 180);
                })
                .catch((err) => {
                    msg.textContent = err && err.name === 'NotAllowedError'
                        ? 'Câmera bloqueada. Libere a câmera para este site nas configurações do navegador, ou use "Ler de uma foto".'
                        : 'Não foi possível abrir a câmera. Use "Ler de uma foto" ou cole o endereço.';
                });
        });
    }

    // Liga um botão "ler QR" a um campo de texto. onResult recebe o conteúdo interpretado e pode
    // devolver uma mensagem de erro (string) para recusar o que foi lido.
    function attach(button, input, options = {}) {
        if (!button || !input) return;
        button.addEventListener('click', async () => {
            const text = await scan({ title: options.title });
            if (text === null) return;
            const parsed = parsePayload(text);
            const value = options.raw ? parsed.raw : (parsed.address || parsed.raw);
            const problem = options.onResult ? options.onResult(parsed) : null;
            if (typeof problem === 'string') return;
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    global.RdeskQrScanner = { scan, attach, parsePayload, decodeImageFile };
})(window);

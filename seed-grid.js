/* =========================================================================
   PALAVRAS DA CHAVE EM QUADRADINHOS NUMERADOS
   Uma caixa por palavra (1, 2, 3…), na ordem do papel. Sugere a palavra certa
   da lista oficial (BIP39) enquanto a pessoa digita, marca de verde a palavra
   que existe e pula para a próxima caixa. Colar a frase inteira em qualquer
   caixa espalha as palavras. O campo de texto original continua guardando a
   frase (é ele que o app lê ao importar).
   ========================================================================= */
(function (global) {
    'use strict';
    let WORDS = null;
    function words() {
        if (WORDS) return WORDS;
        try {
            const wl = global.ethers.wordlists.en;
            WORDS = Array.from({ length: 2048 }, (_, i) => wl.getWord(i));
        } catch (e) { WORDS = []; }
        return WORDS;
    }
    const isWord = (w) => words().includes(w);
    const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').trim();

    function mount(textarea) {
        if (!textarea || textarea.dataset.grid) return;
        textarea.dataset.grid = '1';
        let count = 12;
        const box = document.createElement('div');
        box.className = 'sg';
        box.innerHTML = `
            <div class="ks-seg sg-size" role="radiogroup" aria-label="Quantas palavras tem a sua chave">
                <button type="button" role="radio" data-n="12" aria-checked="true">12 palavras</button>
                <button type="button" role="radio" data-n="24" aria-checked="false">24 palavras</button>
            </div>
            <div class="sg-grid"></div>
            <div class="sg-sugg" aria-live="polite"></div>
            <div class="sg-status"></div>`;
        textarea.before(box);
        textarea.classList.add('sg-source');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.tabIndex = -1;
        const grid = box.querySelector('.sg-grid');
        const sugg = box.querySelector('.sg-sugg');
        const status = box.querySelector('.sg-status');
        let focusIdx = -1;

        const inputs = () => [...grid.querySelectorAll('input')];
        const sync = () => {
            const ws = inputs().map((i) => clean(i.value).split(/\s+/)[0] || '');
            textarea.value = ws.filter(Boolean).length ? ws.join(' ').trim() : '';
            const filled = ws.filter(Boolean).length;
            const bad = ws.filter((w) => w && !isWord(w)).length;
            status.textContent = bad ? `⚠️ ${bad} palavra${bad > 1 ? 's' : ''} não existe${bad > 1 ? 'm' : ''} na lista. Confira no papel.` : `${filled} de ${count} palavras`;
            status.className = `sg-status ${bad ? 'bad' : filled === count ? 'ok' : ''}`;
        };
        const paint = (inp) => {
            const w = clean(inp.value);
            inp.parentElement.classList.toggle('ok', isWord(w));
            inp.parentElement.classList.toggle('bad', Boolean(w) && !isWord(w) && document.activeElement !== inp);
        };
        const showSugg = (inp) => {
            const w = clean(inp.value);
            if (!w || isWord(w)) { sugg.innerHTML = ''; return; }
            const list = words().filter((x) => x.startsWith(w)).slice(0, 4);
            sugg.innerHTML = list.map((x) => `<button type="button" class="sg-chip" data-w="${x}">${x}</button>`).join('');
        };
        // Coloca várias palavras a partir de uma caixa (colar a frase toda)
        const spread = (start, text) => {
            const ws = clean(text).split(/\s+/).filter(Boolean);
            if (ws.length > 12 && count === 12) setCount(24);
            const ins = inputs();
            ws.forEach((w, k) => { if (ins[start + k]) { ins[start + k].value = w; paint(ins[start + k]); } });
            const next = ins[Math.min(start + ws.length, ins.length - 1)];
            next?.focus();
            sync();
        };
        function build() {
            const old = inputs().map((i) => i.value);
            grid.innerHTML = Array.from({ length: count }, (_, i) => `
                <label class="sg-cell"><span class="sg-n">${i + 1}</span><input type="text" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="next" aria-label="Palavra ${i + 1}" data-i="${i}" value="${old[i] || ''}"></label>`).join('');
            inputs().forEach((inp) => {
                paint(inp);
                inp.addEventListener('focus', () => { focusIdx = Number(inp.dataset.i); showSugg(inp); });
                inp.addEventListener('blur', () => paint(inp));
                inp.addEventListener('input', () => {
                    if (/\s/.test(inp.value.trim())) { const v = inp.value; inp.value = ''; spread(Number(inp.dataset.i), v); return; }
                    inp.value = inp.value.toLowerCase().replace(/[^a-z]/g, '');
                    paint(inp); showSugg(inp); sync();
                    // Palavra completa e única: já vai para a próxima caixa
                    const w = inp.value;
                    if (isWord(w) && words().filter((x) => x.startsWith(w)).length === 1) inputs()[Number(inp.dataset.i) + 1]?.focus();
                });
                inp.addEventListener('keydown', (e) => {
                    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); inputs()[Number(inp.dataset.i) + 1]?.focus(); }
                    else if (e.key === 'Backspace' && !inp.value) { const prev = inputs()[Number(inp.dataset.i) - 1]; if (prev) { e.preventDefault(); prev.focus(); } }
                });
                inp.addEventListener('paste', (e) => {
                    const text = (e.clipboardData || global.clipboardData)?.getData('text') || '';
                    if (/\s/.test(text.trim())) { e.preventDefault(); spread(Number(inp.dataset.i), text); }
                });
            });
            sync();
        }
        function setCount(n) {
            count = n;
            box.querySelectorAll('[data-n]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.n) === n)));
            build();
        }
        box.querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => setCount(Number(b.dataset.n)); });
        sugg.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o foco da caixa
        sugg.addEventListener('click', (e) => {
            const c = e.target.closest('.sg-chip');
            if (!c) return;
            const inp = inputs()[focusIdx];
            if (!inp) return;
            inp.value = c.dataset.w; paint(inp); sync(); sugg.innerHTML = '';
            (inputs()[focusIdx + 1] || inp).focus();
        });
        // Frase colocada direto no campo original (QR Code, colar, testes): espalha nas caixas
        textarea.addEventListener('input', () => {
            const ws = clean(textarea.value).split(/\s+/).filter(Boolean);
            const current = inputs().map((i) => clean(i.value)).filter(Boolean).join(' ');
            if (ws.join(' ') === current) return;
            if (ws.length > 12 && count === 12) setCount(24);
            inputs().forEach((inp, k) => { inp.value = ws[k] || ''; paint(inp); });
            sync();
        });
        build();
        setTimeout(() => inputs()[0]?.focus(), 60);
    }

    global.RdeskSeedGrid = { mount, isWord };
})(window);

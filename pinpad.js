/* =========================================================================
   TECLADO DE PIN — bonito, grande, sem o teclado de letras do celular.
   RdeskPinPad.mount(el, { length: 6, title, onComplete(pin), onChange(pin) })
   ========================================================================= */
(function (global) {
    'use strict';
    const buzz = (p) => { try { navigator.vibrate?.(p); } catch (e) { /* sem vibração */ } };

    function mount(el, opts = {}) {
        const length = opts.length || 6;
        let pin = '';
        el.classList.add('pinpad');
        el.innerHTML = `
            ${opts.title ? `<div class="pp-title">${opts.title}</div>` : ''}
            <div class="pp-dots" role="status" aria-live="polite" aria-label="0 de ${length} números">${Array.from({ length }, () => '<i></i>').join('')}</div>
            <div class="pp-msg" aria-live="assertive"></div>
            <div class="pp-keys">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="pp-key" data-d="${n}">${n}</button>`).join('')}
                <button type="button" class="pp-key pp-fn" data-act="clear" aria-label="Limpar">Limpar</button>
                <button type="button" class="pp-key" data-d="0">0</button>
                <button type="button" class="pp-key pp-fn" data-act="back" aria-label="Apagar">⌫</button>
            </div>`;
        const dots = el.querySelector('.pp-dots');
        const msg = el.querySelector('.pp-msg');
        const paint = () => {
            dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < pin.length));
            dots.setAttribute('aria-label', `${pin.length} de ${length} números`);
            opts.onChange?.(pin);
        };
        const press = (d) => {
            if (pin.length >= length) return;
            pin += d;
            buzz(8);
            msg.textContent = '';
            paint();
            if (pin.length === length) setTimeout(() => opts.onComplete?.(pin), 120);
        };
        el.querySelectorAll('.pp-key').forEach((b) => {
            b.addEventListener('click', () => {
                const act = b.getAttribute('data-act');
                if (act === 'back') { pin = pin.slice(0, -1); paint(); return; }
                if (act === 'clear') { pin = ''; paint(); return; }
                press(b.getAttribute('data-d'));
            });
        });
        // Teclado físico também funciona (computador)
        const onKey = (e) => {
            if (!el.isConnected) { document.removeEventListener('keydown', onKey); return; }
            // Digitando em outro campo (palavras, nome, senha…): o teclado do PIN não mexe em nada.
            // (Antes ele engolia a tecla de apagar e os números da página inteira.)
            const tg = e.target;
            if (tg && tg !== document.body && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
            if (!el.offsetParent && el !== document.activeElement) return; // teclado escondido
            if (/^[0-9]$/.test(e.key)) { press(e.key); e.preventDefault(); }
            else if (e.key === 'Backspace') { pin = pin.slice(0, -1); paint(); e.preventDefault(); }
        };
        document.addEventListener('keydown', onKey);
        paint();
        return {
            reset(text = '') { pin = ''; paint(); msg.textContent = text; },
            error(text) {
                pin = ''; paint();
                msg.textContent = text || '';
                dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
                buzz([40, 50, 40]);
            },
            value: () => pin
        };
    }

    global.RdeskPinPad = { mount };
})(window);

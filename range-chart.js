/* =========================================================================
   RDESK SENTINEL — GRÁFICO DE PREÇO COM FAIXAS (canvas próprio, sem CDN)
   Desenha as velas do par, o preço atual e cada faixa de liquidez como uma
   banda colorida, para ver de relance se o preço está dentro ou fora.
   ========================================================================= */
(function (global) {
    'use strict';

    const THEME = {
        bg: '#0b0e14',
        grid: 'rgba(255,255,255,0.05)',
        axis: '#7c8798',
        up: '#10b981',
        down: '#f43f5e',
        spot: '#f8fafc',
        font: '11px "JetBrains Mono", ui-monospace, monospace'
    };

    function hexToRgba(hex, alpha) {
        const h = hex.replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }

    function niceStep(range, targetTicks) {
        const raw = range / Math.max(1, targetTicks);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
        return step * mag;
    }

    function create(container, options = {}) {
        const height = options.height || 290;
        const decimals = options.decimals ?? 4;
        const canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = `${height}px`;
        canvas.setAttribute('role', 'img');
        container.replaceChildren(canvas);

        const state = { candles: [], bands: [], spot: 0 };
        const fmt = (v) => `$${Number(v).toFixed(decimals)}`;

        function describe() {
            const parts = state.bands.map((b) => `${b.label}: ${fmt(b.min)} a ${fmt(b.max)}`);
            if (state.spot > 0) parts.unshift(`Preço atual ${fmt(state.spot)}`);
            canvas.setAttribute('aria-label', parts.join('. ') || 'Gráfico de preço');
        }

        function draw() {
            const width = Math.max(240, container.clientWidth || 340);
            const dpr = global.devicePixelRatio || 1;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = THEME.bg;
            ctx.fillRect(0, 0, width, height);
            ctx.font = THEME.font;

            const padR = 62, padL = 8, padT = 14, padB = 22;
            const plotW = width - padL - padR;
            const plotH = height - padT - padB;

            // Escala: cobre velas, faixas e preço atual
            const values = [];
            state.candles.forEach((c) => values.push(c.high, c.low));
            state.bands.forEach((b) => values.push(b.min, b.max));
            if (state.spot > 0) values.push(state.spot);
            if (!values.length) {
                ctx.fillStyle = THEME.axis;
                ctx.textAlign = 'center';
                ctx.fillText('Carregando preços…', width / 2, height / 2);
                return;
            }
            let lo = Math.min(...values), hi = Math.max(...values);
            if (hi - lo < hi * 0.002) { lo *= 0.995; hi *= 1.005; }
            const pad = (hi - lo) * 0.09;
            lo -= pad; hi += pad;
            const y = (price) => padT + (1 - (price - lo) / (hi - lo)) * plotH;

            // Grade + eixo de preço
            const step = niceStep(hi - lo, 5);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
                ctx.strokeStyle = THEME.grid;
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(padL, Math.round(y(p)) + 0.5); ctx.lineTo(padL + plotW, Math.round(y(p)) + 0.5); ctx.stroke();
                ctx.fillStyle = THEME.axis;
                ctx.fillText(Number(p).toFixed(decimals), padL + plotW + 8, y(p));
            }

            // Faixas (bandas preenchidas, por baixo das velas)
            state.bands.forEach((b) => {
                const top = y(b.max), bottom = y(b.min);
                ctx.fillStyle = hexToRgba(b.color, b.dashed ? 0.10 : 0.16);
                ctx.fillRect(padL, top, plotW, bottom - top);
                ctx.strokeStyle = hexToRgba(b.color, 0.95);
                ctx.lineWidth = b.dashed ? 1 : 2;
                ctx.setLineDash(b.dashed ? [5, 4] : []);
                [top, bottom].forEach((yy) => { ctx.beginPath(); ctx.moveTo(padL, Math.round(yy) + 0.5); ctx.lineTo(padL + plotW, Math.round(yy) + 0.5); ctx.stroke(); });
                ctx.setLineDash([]);
            });

            // Velas
            const n = state.candles.length;
            if (n) {
                const slot = plotW / n;
                const body = Math.max(1.5, Math.min(9, slot * 0.62));
                state.candles.forEach((c, i) => {
                    const x = padL + slot * (i + 0.5);
                    const color = c.close >= c.open ? THEME.up : THEME.down;
                    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y(c.high)); ctx.lineTo(Math.round(x) + 0.5, y(c.low)); ctx.stroke();
                    const yo = y(c.open), yc = y(c.close);
                    ctx.fillRect(x - body / 2, Math.min(yo, yc), body, Math.max(1, Math.abs(yc - yo)));
                });

                // Eixo de tempo (4 marcas)
                ctx.fillStyle = THEME.axis; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
                const spanSec = state.candles[n - 1].time - state.candles[0].time;
                for (let k = 0; k < 4; k++) {
                    const i = Math.min(n - 1, Math.round(((k + 0.5) / 4) * n));
                    const d = new Date(state.candles[i].time * 1000);
                    const label = spanSec > 3 * 86400
                        ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
                        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    ctx.fillText(label, padL + slot * (i + 0.5), height - 7);
                }
            }

            // Etiquetas das faixas (canto esquerdo, dentro da banda)
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            const usedY = [];
            state.bands.forEach((b) => {
                const text = `${b.label}  ${fmt(b.min)} – ${fmt(b.max)}`;
                const w = ctx.measureText(text).width + 12;
                let ly = y(b.max) + 11;
                while (usedY.some((u) => Math.abs(u - ly) < 18)) ly += 18;
                usedY.push(ly);
                ctx.fillStyle = 'rgba(11,14,20,0.82)';
                ctx.fillRect(padL + 6, ly - 8, w, 16);
                ctx.fillStyle = b.color;
                ctx.fillText(text, padL + 12, ly);
            });

            // Preço atual
            if (state.spot > 0) {
                const ys = y(state.spot);
                ctx.strokeStyle = hexToRgba(THEME.spot, 0.7); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
                ctx.beginPath(); ctx.moveTo(padL, Math.round(ys) + 0.5); ctx.lineTo(padL + plotW, Math.round(ys) + 0.5); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = THEME.spot;
                ctx.fillRect(padL + plotW + 2, ys - 9, padR - 4, 18);
                ctx.fillStyle = '#0b0e14'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.fillText(Number(state.spot).toFixed(decimals), padL + plotW + 8, ys);
            }
        }

        let frame = 0;
        function schedule() {
            describe();
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(draw);
        }

        global.addEventListener('resize', schedule);
        if (global.ResizeObserver) new ResizeObserver(schedule).observe(container);
        schedule();

        return {
            setCandles(candles) { state.candles = Array.isArray(candles) ? candles : []; schedule(); },
            // bands: [{ min, max, color, label, dashed }]
            setBands(bands) { state.bands = (bands || []).filter((b) => b.max > b.min && b.min > 0); schedule(); },
            setSpot(price) { state.spot = Number(price) || 0; schedule(); },
            redraw: draw,
            getState: () => ({ candles: state.candles.length, bands: state.bands.map((b) => ({ ...b })), spot: state.spot })
        };
    }

    global.RdeskRangeChart = { create };
})(window);

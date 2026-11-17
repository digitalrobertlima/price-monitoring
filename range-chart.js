/* =========================================================================
   RDESK SENTINEL — GRÁFICO DE PREÇO COM FAIXAS (canvas próprio, sem CDN)
   Velas do par, preço atual e cada faixa de liquidez como uma banda.
   Toque: arrastar para os lados navega no tempo, pinça (ou roda do mouse)
   aproxima, tocar mostra o preço daquele momento, toque duplo volta ao
   início. A faixa editável tem duas alças que a pessoa arrasta para cima
   ou para baixo para escolher o próprio mínimo e máximo.
   ========================================================================= */
(function (global) {
    'use strict';

    const THEME = {
        bg: '#0f131b',
        grid: 'rgba(255,255,255,0.05)',
        axis: '#8b95a7',
        up: '#34d399',
        down: '#fb7185',
        spot: '#f8fafc',
        font: '11px Inter, system-ui, sans-serif',
        fontBold: '600 12px Inter, system-ui, sans-serif'
    };
    const MIN_VISIBLE = 12;
    const HANDLE_HIT = 22; // px de tolerância para pegar a alça com o dedo

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
        const onRangeChange = typeof options.onRangeChange === 'function' ? options.onRangeChange : null;

        const wrap = document.createElement('div');
        wrap.className = 'rc-wrap';
        const canvas = document.createElement('canvas');
        canvas.className = 'rc-canvas';
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = `${height}px`;
        canvas.style.touchAction = 'none'; // o gráfico recebe os gestos; a página rola fora dele
        canvas.setAttribute('role', 'img');
        canvas.tabIndex = 0;
        const tip = document.createElement('div');
        tip.className = 'rc-tip';
        tip.hidden = true;
        wrap.append(canvas, tip);
        container.replaceChildren(wrap);

        const state = {
            candles: [], bands: [], spot: 0, editable: null,
            view: { end: null, count: null }, // janela de velas visível (null = automático: tudo)
            cross: null, // { x, y } do toque para mostrar o preço
            layout: null
        };
        const fmt = (v) => `$${Number(v).toFixed(decimals)}`;

        function describe() {
            const parts = state.bands.map((b) => `${b.label}: ${fmt(b.min)} a ${fmt(b.max)}`);
            if (state.editable) parts.unshift(`Sua faixa: ${fmt(state.editable.min)} a ${fmt(state.editable.max)}`);
            if (state.spot > 0) parts.unshift(`Preço atual ${fmt(state.spot)}`);
            canvas.setAttribute('aria-label', parts.join('. ') || 'Gráfico de preço');
        }

        function visibleRange() {
            const n = state.candles.length;
            if (!n) return { start: 0, end: 0 };
            const count = Math.max(Math.min(MIN_VISIBLE, n), Math.min(n, state.view.count || n));
            const end = Math.min(n, Math.max(count, state.view.end == null ? n : state.view.end));
            return { start: end - count, end };
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

            const padR = 64, padL = 8, padT = 14, padB = 24;
            const plotW = width - padL - padR;
            const plotH = height - padT - padB;
            const { start, end } = visibleRange();
            const shown = state.candles.slice(start, end);

            // Escala: velas visíveis, faixas, faixa editável e preço atual
            const values = [];
            shown.forEach((c) => values.push(c.high, c.low));
            state.bands.forEach((b) => values.push(b.min, b.max));
            if (state.editable) values.push(state.editable.min, state.editable.max);
            if (state.spot > 0) values.push(state.spot);
            if (!values.length) {
                state.layout = null;
                ctx.fillStyle = THEME.axis;
                ctx.textAlign = 'center';
                ctx.fillText('Carregando preços…', width / 2, height / 2);
                return;
            }
            let lo = Math.min(...values), hi = Math.max(...values);
            if (hi - lo < hi * 0.002) { lo *= 0.995; hi *= 1.005; }
            const pad = (hi - lo) * 0.1;
            lo -= pad; hi += pad;
            const y = (price) => padT + (1 - (price - lo) / (hi - lo)) * plotH;
            const priceAt = (yy) => lo + (1 - (yy - padT) / plotH) * (hi - lo);
            const slot = plotW / Math.max(1, shown.length);
            state.layout = { padL, padR, padT, padB, plotW, plotH, width, lo, hi, y, priceAt, slot, start, end };

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
            const drawBand = (b, alphaFill) => {
                const top = y(b.max), bottom = y(b.min);
                ctx.fillStyle = hexToRgba(b.color, alphaFill);
                ctx.fillRect(padL, top, plotW, bottom - top);
                ctx.strokeStyle = hexToRgba(b.color, 0.95);
                ctx.lineWidth = b.dashed ? 1 : 2;
                ctx.setLineDash(b.dashed ? [5, 4] : []);
                [top, bottom].forEach((yy) => { ctx.beginPath(); ctx.moveTo(padL, Math.round(yy) + 0.5); ctx.lineTo(padL + plotW, Math.round(yy) + 0.5); ctx.stroke(); });
                ctx.setLineDash([]);
            };
            state.bands.forEach((b) => drawBand(b, b.dashed ? 0.08 : 0.14));
            if (state.editable) drawBand({ ...state.editable, dashed: false }, 0.12);

            // Velas
            if (shown.length) {
                const body = Math.max(1.5, Math.min(10, slot * 0.62));
                shown.forEach((c, i) => {
                    const x = padL + slot * (i + 0.5);
                    const color = c.close >= c.open ? THEME.up : THEME.down;
                    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y(c.high)); ctx.lineTo(Math.round(x) + 0.5, y(c.low)); ctx.stroke();
                    const yo = y(c.open), yc = y(c.close);
                    ctx.fillRect(x - body / 2, Math.min(yo, yc), body, Math.max(1, Math.abs(yc - yo)));
                });

                // Eixo de tempo (4 marcas)
                ctx.fillStyle = THEME.axis; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
                const spanSec = shown[shown.length - 1].time - shown[0].time;
                for (let k = 0; k < 4; k++) {
                    const i = Math.min(shown.length - 1, Math.round(((k + 0.5) / 4) * shown.length));
                    const d = new Date(shown[i].time * 1000);
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
                ctx.fillStyle = 'rgba(15,19,27,0.85)';
                ctx.fillRect(padL + 6, ly - 8, w, 16);
                ctx.fillStyle = b.color;
                ctx.fillText(text, padL + 12, ly);
            });

            // Alças da faixa editável (pílulas que dá para arrastar)
            if (state.editable) {
                const e = state.editable;
                ctx.font = THEME.fontBold;
                [['máx', e.max], ['mín', e.min]].forEach(([name, price]) => {
                    const yy = y(price);
                    const text = `↕ ${name} ${Number(price).toFixed(decimals)}`;
                    const w = ctx.measureText(text).width + 18;
                    const x0 = padL + plotW - w - 6;
                    ctx.fillStyle = e.color;
                    roundRect(ctx, x0, yy - 12, w, 24, 12);
                    ctx.fill();
                    ctx.fillStyle = '#0b0e14';
                    ctx.fillText(text, x0 + 9, yy);
                });
                ctx.font = THEME.font;
            }

            // Preço atual
            if (state.spot > 0) {
                const ys = y(state.spot);
                ctx.strokeStyle = hexToRgba(THEME.spot, 0.7); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
                ctx.beginPath(); ctx.moveTo(padL, Math.round(ys) + 0.5); ctx.lineTo(padL + plotW, Math.round(ys) + 0.5); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = THEME.spot;
                roundRect(ctx, padL + plotW + 2, ys - 10, padR - 4, 20, 6);
                ctx.fill();
                ctx.fillStyle = '#0b0e14'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                ctx.fillText(Number(state.spot).toFixed(decimals), padL + plotW + 7, ys);
            }

            // Mira do toque: linha vertical na vela + linha horizontal no preço tocado
            if (state.cross && shown.length) {
                const i = Math.max(0, Math.min(shown.length - 1, Math.floor((state.cross.x - padL) / slot)));
                const cx = padL + slot * (i + 0.5);
                const cy = Math.max(padT, Math.min(padT + plotH, state.cross.y));
                ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
                ctx.beginPath(); ctx.moveTo(Math.round(cx) + 0.5, padT); ctx.lineTo(Math.round(cx) + 0.5, padT + plotH); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(padL, Math.round(cy) + 0.5); ctx.lineTo(padL + plotW, Math.round(cy) + 0.5); ctx.stroke();
                ctx.setLineDash([]);
                const c = shown[i];
                const d = new Date(c.time * 1000);
                const when = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                tip.hidden = false;
                tip.textContent = `${when} • fechou em ${fmt(c.close)} • linha: ${fmt(priceAt(cy))}`;
                state.lastCross = { time: c.time, close: c.close, price: priceAt(cy) };
            } else {
                tip.hidden = true;
            }
        }

        function roundRect(ctx, x, y0, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y0);
            ctx.arcTo(x + w, y0, x + w, y0 + h, r);
            ctx.arcTo(x + w, y0 + h, x, y0 + h, r);
            ctx.arcTo(x, y0 + h, x, y0, r);
            ctx.arcTo(x, y0, x + w, y0, r);
            ctx.closePath();
        }

        let frame = 0;
        function schedule() {
            describe();
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(draw);
        }

        // ------------------------------------------------------------------ gestos
        const pointers = new Map(); // pointerId -> { x, y }
        let gesture = null; // { type: 'pan'|'edge'|'pinch', ... }
        let lastTap = 0;

        const local = (ev) => {
            const r = canvas.getBoundingClientRect();
            return { x: ev.clientX - r.left, y: ev.clientY - r.top };
        };
        const edgeAt = (pt) => {
            const L = state.layout;
            if (!state.editable || !L) return null;
            const dMax = Math.abs(pt.y - L.y(state.editable.max));
            const dMin = Math.abs(pt.y - L.y(state.editable.min));
            if (Math.min(dMax, dMin) > HANDLE_HIT) return null;
            return dMax <= dMin ? 'max' : 'min';
        };
        const zoomAround = (factor, anchorX) => {
            const L = state.layout;
            const n = state.candles.length;
            if (!L || !n) return;
            const { start, end } = visibleRange();
            const count = end - start;
            const newCount = Math.round(Math.max(Math.min(MIN_VISIBLE, n), Math.min(n, count / factor)));
            const frac = Math.max(0, Math.min(1, (anchorX - L.padL) / L.plotW));
            const anchorIdx = start + frac * count;
            let newStart = Math.round(anchorIdx - frac * newCount);
            newStart = Math.max(0, Math.min(n - newCount, newStart));
            state.view = { end: newStart + newCount, count: newCount };
            schedule();
        };

        canvas.addEventListener('pointerdown', (ev) => {
            try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
            const pt = local(ev);
            pointers.set(ev.pointerId, pt);
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: (a.x + b.x) / 2 };
                return;
            }
            const edge = edgeAt(pt);
            if (edge) {
                gesture = { type: 'edge', edge, moved: false };
            } else {
                const { end, start } = visibleRange();
                gesture = { type: 'pan', x0: pt.x, y0: pt.y, end0: end, count: end - start, moved: false };
            }
        });

        canvas.addEventListener('pointermove', (ev) => {
            if (!pointers.has(ev.pointerId)) return;
            const pt = local(ev);
            pointers.set(ev.pointerId, pt);
            const L = state.layout;
            if (!gesture || !L) return;
            if (gesture.type === 'pinch' && pointers.size >= 2) {
                const [a, b] = [...pointers.values()];
                const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                const factor = dist / gesture.dist;
                if (Math.abs(factor - 1) > 0.04) { zoomAround(factor, gesture.mid); gesture.dist = dist; }
                return;
            }
            if (gesture.type === 'edge') {
                gesture.moved = true;
                const price = L.priceAt(pt.y);
                const e = state.editable;
                const minGap = Math.max(e.max, e.min) * 0.002;
                if (gesture.edge === 'max') e.max = Math.max(e.min + minGap, price);
                else e.min = Math.max(0.000001, Math.min(e.max - minGap, price));
                state.cross = null;
                schedule();
                return;
            }
            if (gesture.type === 'pan') {
                const dx = pt.x - gesture.x0;
                if (!gesture.moved && Math.hypot(dx, pt.y - gesture.y0) < 6) return;
                gesture.moved = true;
                const n = state.candles.length;
                const shift = Math.round(dx / L.slot);
                const end = Math.max(gesture.count, Math.min(n, gesture.end0 - shift));
                state.view = { end, count: gesture.count };
                state.cross = { x: pt.x, y: pt.y };
                schedule();
            }
        });

        const finish = (ev) => {
            if (!pointers.has(ev.pointerId)) return;
            const pt = local(ev);
            pointers.delete(ev.pointerId);
            if (!gesture) return;
            if (gesture.type === 'edge') {
                if (gesture.moved && onRangeChange) onRangeChange({ min: state.editable.min, max: state.editable.max });
                gesture = null;
                return;
            }
            if (gesture.type === 'pinch') { if (pointers.size === 0) gesture = null; return; }
            if (gesture.type === 'pan' && !gesture.moved) {
                const now = Date.now();
                if (now - lastTap < 320) { // toque duplo: volta a ver tudo
                    state.view = { end: null, count: null };
                    state.cross = null;
                    lastTap = 0;
                } else {
                    lastTap = now;
                    state.cross = state.cross && Math.abs(state.cross.x - pt.x) < 4 ? null : { x: pt.x, y: pt.y };
                }
                schedule();
            }
            gesture = null;
        };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);
        canvas.addEventListener('wheel', (ev) => {
            ev.preventDefault();
            zoomAround(ev.deltaY < 0 ? 1.15 : 1 / 1.15, local(ev).x);
        }, { passive: false });
        canvas.addEventListener('keydown', (ev) => {
            const L = state.layout;
            if (!L) return;
            if (ev.key === '+' || ev.key === '=') zoomAround(1.25, L.padL + L.plotW / 2);
            else if (ev.key === '-') zoomAround(0.8, L.padL + L.plotW / 2);
            else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                const { start, end } = visibleRange();
                const step = Math.max(1, Math.round((end - start) / 8)) * (ev.key === 'ArrowLeft' ? -1 : 1);
                state.view = { end: Math.max(end - start, Math.min(state.candles.length, end + step)), count: end - start };
                schedule();
            } else if (ev.key === '0') { state.view = { end: null, count: null }; schedule(); }
        });

        global.addEventListener('resize', schedule);
        if (global.ResizeObserver) new ResizeObserver(schedule).observe(container);
        schedule();

        return {
            setCandles(candles) {
                const prevLen = state.candles.length;
                state.candles = Array.isArray(candles) ? candles : [];
                // Se a pessoa estava vendo o fim (o agora), continua acompanhando as velas novas
                if (state.view.end != null && state.view.end >= prevLen) state.view.end = state.candles.length;
                if (state.view.end != null && state.view.end > state.candles.length) state.view = { end: null, count: null };
                schedule();
            },
            // bands: [{ min, max, color, label, dashed }]
            setBands(bands) { state.bands = (bands || []).filter((b) => b.max > b.min && b.min > 0); schedule(); },
            // faixa que a pessoa pode arrastar: { min, max, color } ou null
            setEditableBand(band) {
                if (gesture && gesture.type === 'edge') return; // não atropela o dedo no meio do arraste
                state.editable = band && band.max > band.min && band.min > 0 ? { color: '#38bdf8', ...band } : null;
                schedule();
            },
            setSpot(price) { state.spot = Number(price) || 0; schedule(); },
            resetView() { state.view = { end: null, count: null }; state.cross = null; schedule(); },
            redraw: draw,
            getState: () => {
                const { start, end } = visibleRange();
                return {
                    candles: state.candles.length, visible: end - start, viewEnd: end,
                    bands: state.bands.map((b) => ({ ...b })),
                    editable: state.editable ? { min: state.editable.min, max: state.editable.max } : null,
                    spot: state.spot,
                    cross: state.cross && !tip.hidden ? { ...state.lastCross } : null,
                    yOf: state.layout ? { max: state.editable ? state.layout.y(state.editable.max) : null, min: state.editable ? state.layout.y(state.editable.min) : null } : null
                };
            }
        };
    }

    global.RdeskRangeChart = { create };
})(window);

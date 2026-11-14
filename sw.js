const CACHE_VERSION = 'rdesk-defi-v22.1';
const APP_SHELL_ASSETS = [
    './',
    './index.html',
    './app.js',
    './manifest.json'
];

const IMMUTABLE_CDN_HOSTS = [
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'unpkg.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

// 1. Instalação: pré-carrega a casca do app e ativa imediatamente
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(APP_SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// 2. Ativação: limpa versões antigas do cache a cada novo commit no GitHub
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key.startsWith('rdesk-defi-') && key !== CACHE_VERSION)
                    .map((oldKey) => caches.delete(oldKey))
            )
        ).then(() => self.clients.claim())
    );
});

// 3. Interceptação Inteligente de Rede
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Nunca interceptar POST (chamadas RPC Multicall3 / eth_call) ou WebSockets
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Bibliotecas externas imutáveis (Ethers, Lightweight Charts, Fontes): Cache-First para abrir em <0.2s
    if (IMMUTABLE_CDN_HOSTS.some((host) => url.hostname.includes(host))) {
        event.respondWith(
            caches.match(req).then((cached) => {
                if (cached) return cached;
                return fetch(req).then((netRes) => {
                    if (netRes && netRes.status === 200) {
                        const copy = netRes.clone();
                        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
                    }
                    return netRes;
                });
            })
        );
        return;
    }

    // Arquivos locais do PWA (mesma origem): Network-First com fallback instantâneo offline
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req)
                .then((netRes) => {
                    if (netRes && netRes.status === 200) {
                        const copy = netRes.clone();
                        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
                    }
                    return netRes;
                })
                .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }

    // APIs de preço, RPCs, bridges e exploradores passam direto pela rede (zero dado antigo)
});

// 4. Canal de Mensagens & Alertas Nativos em Segundo Plano
self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (data.type === 'SHOW_RANGE_ALERT' && self.registration) {
        const title = String(data.title || 'RDESK DeFi — Alerta de Faixa').slice(0, 80);
        const body = String(data.body || 'Verifique o status da sua posição de liquidez.').slice(0, 200);
        const tag = String(data.tag || 'rdesk-range-alert').slice(0, 40);

        event.waitUntil(
            self.registration.showNotification(title, {
                body,
                tag,
                renotify: true,
                vibrate: [180, 90, 180],
                data: { url: './?tab=pools' }
            })
        );
    }
});

// 5. Ao tocar na notificação no celular/PC, foca ou abre o app direto na aba Pools
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || './';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(targetUrl).catch(() => {});
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});

/* =========================================================================
   RDESK SENTINEL — SERVICE WORKER (CACHE INTELIGENTE NETWORK-FIRST)
   Arquivo 7 de 7: sw.js (v23)
   ========================================================================= */

const CACHE_NAME = 'rdesk-sentinel-v23-shell';
const CORE_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './wallet-service.js',
    './defi-pix-service.js',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then((networkRes) => {
                if (networkRes && networkRes.status === 200) {
                    const clone = networkRes.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                }
                return networkRes;
            })
            .catch(() => caches.match(req))
    );
});

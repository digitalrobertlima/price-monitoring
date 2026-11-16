/* =========================================================================
   RDESK SENTINEL — SERVICE WORKER (NETWORK-FIRST PWA)
   Arquivo 2 de 7: sw.js
   ========================================================================= */

const CACHE_NAME = 'rdesk-sentinel-v24';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './range-chart.js',
  './wallet-service.js',
  './defi-pix-service.js',
  './app.js',
  './manifest.json',
  './vendor/ethers-5.7.2.umd.min.js',
  './vendor/qrcode-1.0.0.min.js',
  './vendor/chart-4.4.1.umd.min.js'
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
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca faz cache de chamadas RPC blockchain, APIs de cotação, Blockscout, BCB ou LI.FI
  const isStaticCdn =
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  const isLocalAsset = url.origin === self.location.origin;

  // APIs e RPCs seguem direto para a rede, sem passar pelo service worker.
  if (!isLocalAsset && !isStaticCdn) return;

  // Network-First: baixa sempre a versão mais recente do GitHub Pages com fallback offline
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

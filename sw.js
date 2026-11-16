const CACHE_NAME = 'rdesk-sentinel-v22-superapp';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './vault-core.js',
  './ledger-advisor.js',
  './gateway-pix.js',
  './sentinel-engine.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca faz cache de RPCs blockchain, cotações, Blockscout, LI.FI ou APIs financeiras
  const isStaticCdn =
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  const isLocalAsset = url.origin === self.location.origin;

  if (!isLocalAsset && !isStaticCdn) {
    event.respondWith(fetch(req));
    return;
  }

  // Network-First para arquivos locais (sempre baixa commits novos do GitHub Pages)
  // com fallback instantâneo para cache em caso de oscilação de sinal no celular
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(req))
  );
});

/* =========================================================================
   RDESK SENTINEL — SERVICE WORKER (NETWORK-FIRST PWA)
   Arquivo 2 de 7: sw.js
   ========================================================================= */

importScripts('./version.js');
const CACHE_NAME = `rdesk-sentinel-${self.RDESK_VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './version.js',
  './updater.js',
  './styles.css',
  './range-chart.js',
  './registry.js',
  './bitcoin.js',
  './pix.js',
  './qr-scanner.js',
  './wallet-views.js',
  './onboarding.js',
  './pinpad.js',
  './seed-grid.js',
  './anon.js',
  './vault-door.js',
  './lessons.js',
  './learn.js',
  './sats-trail.js',
  './airgap.js',
  './feel.js',
  './asset-info.js',
  './history.js',
  './ledger.js',
  './market.js',
  './pools.js',
  './relayer.js',
  './wallet-service.js',
  './defi-pix-service.js',
  './swap-picker.js',
  './app.js',
  './manifest.json',
  './fonts/fonts.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
  './vendor/ethers-5.7.2.umd.min.js',
  './wordlist-pt.js',
  './dash.js',
  './vendor/qrcode-1.0.0.min.js',
  './vendor/jsqr-1.4.0.js',
  './vendor/chart-4.4.1.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Um arquivo faltando não pode derrubar o modo offline inteiro
      .then((cache) => Promise.all(CORE_ASSETS.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          // só os caches deste app (o domínio é dividido com outros sites)
          keys.filter((key) => key.startsWith('rdesk-') && key !== CACHE_NAME).map((key) => caches.delete(key))
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
  const isStaticCdn = false; // fontes agora vêm do próprio site (fonts/), sem Google

  const isLocalAsset = url.origin === self.location.origin;

  // APIs e RPCs seguem direto para a rede, sem passar pelo service worker.
  if (!isLocalAsset && !isStaticCdn) return;

  // Network-First: baixa sempre a versão mais recente do GitHub Pages com fallback offline
  // version.js nunca vem de cache (é por ele que o app descobre a versão nova)
  if (isLocalAsset && url.pathname.endsWith('/version.js')) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.open(CACHE_NAME).then((c) => c.match(req))));
    return;
  }
  // Arquivos do app: sempre pergunta ao servidor se mudou (sem usar cache do navegador)
  const fresh = isLocalAsset ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : req;
  event.respondWith(
    fetch(fresh)
      .then((networkRes) => {
        // Navegação não pode receber resposta redirecionada: devolve um redirecionamento de verdade
        if (req.mode === 'navigate' && networkRes.redirected) return Response.redirect(networkRes.url, 302);
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      })
      .catch(() => caches.open(CACHE_NAME).then((c) => c.match(req)))
  );
});

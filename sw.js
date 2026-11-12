/* Sahm PWA — activate new builds immediately; app code is always network-first so old cached copies are never preferred. */
const CACHE_NAME = 'sahm-pwa-v21';
const APP_SHELL = [
  '/',
  '/Sahm_Preview_ROLE_SEPARATION.html',
  '/sahm-core.js',
  '/sahm-data.js',
  '/manifest.webmanifest',
  '/icons/sahm.svg'
];
/* files that define app behaviour: fetched fresh whenever the network is available */
const APP_CODE = /\.(?:js|html|css|webmanifest)$/i;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(APP_SHELL.map(url =>
        fetch(url, { cache: 'reload' }).then(res => { if (res && res.ok) return cache.put(url, res); })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('sahm-pwa-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbacks) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { cache: 'no-store', redirect: 'follow' });
    if (fresh && fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    for (const url of fallbacks || []) {
      const alt = await cache.match(url);
      if (alt) return alt;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, ['/Sahm_Preview_ROLE_SEPARATION.html', '/']));
    return;
  }

  if (APP_CODE.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  /* static assets (icons, images): cache-first */
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

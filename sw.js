/* Sahm PWA — network-first documents, versioned offline assets, automatic activation. */
const CACHE_NAME = 'sahm-pwa-v3';
const APP_SHELL = [
  '/',
  '/Sahm_Preview_ROLE_SEPARATION.html',
  '/manifest.webmanifest',
  '/icons/sahm.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
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

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh && fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch (error) {
        return (await cache.match(request)) ||
          (await cache.match('/Sahm_Preview_ROLE_SEPARATION.html')) ||
          (await cache.match('/'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

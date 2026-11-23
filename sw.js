const CACHE_NAME = "sahm-pwa-shell-v25";
const CACHE_PREFIX = "sahm-pwa-shell-";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.location.href).href));

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Update checks are deliberately network-only and must never enter Cache Storage.
  if (url.searchParams.has("__sahm_update_check")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async response => {
          if (response.ok) {
            const copy = response.clone();
            await caches.open(CACHE_NAME)
              .then(cache => cache.put("./index.html", copy))
              .catch(error => console.warn("تعذر تحديث نسخة الصفحة المخزنة:", error));
          }
          return response;
        })
        .catch(() => caches.match("./index.html").then(cached => cached || caches.match("./")))
    );
    return;
  }

  // Cache only the explicit app-shell assets. Never cache arbitrary same-origin
  // responses such as query-backed data, generated URLs, or future API routes.
  if (url.search || !SHELL_URLS.has(url.href)) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(async response => {
        if (response.ok) {
          const copy = response.clone();
          await caches.open(CACHE_NAME)
            .then(cache => cache.put(request, copy))
            .catch(error => console.warn("تعذر تخزين ملف التطبيق:", error));
        }
        return response;
      });
    })
  );
});

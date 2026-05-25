// Diamond Landscapes Service Worker
// Never caches index.html — always fetches fresh from network
// Responds to SKIP_WAITING so new versions activate immediately

const CACHE_NAME = 'diamond-static-v2';

self.addEventListener('install', function(event) {
  // Activate immediately — don't wait for old SW to close
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    // Delete any old caches
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      // Take control of ALL open tabs immediately
      return self.clients.claim();
    })
  );
});

// Listen for SKIP_WAITING message from the page
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // NEVER cache index.html — always get fresh from network
  // This is what makes updates automatic without clearing cache
  if (req.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(function() {
          // Only use cache if completely offline
          return caches.match(req);
        })
    );
    return;
  }

  // sw.js itself — never cache, always fresh
  if (url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  // Everything else (images, fonts, etc) — cache for speed
  event.respondWith(
    caches.match(req).then(function(cached) {
      return cached || fetch(req).then(function(networkRes) {
        var clone = networkRes.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, clone);
        });
        return networkRes;
      });
    }).catch(function() {
      return caches.match(req);
    })
  );
});

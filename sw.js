// ─── Service Worker ───────────────────────────────────────────────────────────
// Strategy:
//   index.html  → always network-first, never served from cache when online
//   everything else → cache-first for speed
//
// You never need to touch this file. Just upload a new index.html and every
// user's phone fetches it fresh on their next visit — no cache clearing needed.

const CACHE_NAME = 'diamond-app-static-v1';

// ── Install: activate immediately ─────────────────────────────────────────────
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

// ── Activate: claim all clients right away ────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Message: allow page to trigger skip waiting ───────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // Always go to network for the HTML page — every load gets the latest version
  if (req.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(req).catch(function() {
        return caches.match(req); // offline fallback only
      })
    );
    return;
  }

  // Everything else: cache-first for speed
  event.respondWith(
    caches.match(req).then(function(cached) {
      return cached || fetch(req).then(function(networkRes) {
        var clone = networkRes.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
        return networkRes;
      });
    }).catch(function() {
      return caches.match(req);
    })
  );
});

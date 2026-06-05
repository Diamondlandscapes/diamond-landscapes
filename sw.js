// Diamond Landscapes Service Worker v2.0
// Firebase-aware: never caches index.html or Firebase SDK URLs
// New version activates immediately across all devices

const CACHE_NAME = 'diamond-static-v3';

// URLs that should never be cached
const NEVER_CACHE = [
  'firebase',
  'gstatic.com/firebasejs',
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'firebasestorage.googleapis.com',
  'googleapis.com',
  'index.html',
  'sw.js',
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

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

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  var url = new URL(req.url);

  // Never cache: navigation, index.html, Firebase SDK, Firebase APIs
  var shouldSkipCache = (
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/sw.js') ||
    NEVER_CACHE.some(function(pattern) {
      return req.url.includes(pattern);
    })
  );

  if (shouldSkipCache) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(function() {
        // Only serve cached index.html if completely offline and nothing else works
        return caches.match(req);
      })
    );
    return;
  }

  // Static assets (fonts, icons, images): cache-first
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(networkRes) {
        if (networkRes && networkRes.status === 200) {
          var clone = networkRes.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(req, clone);
          });
        }
        return networkRes;
      });
    }).catch(function() {
      return caches.match(req);
    })
  );
});

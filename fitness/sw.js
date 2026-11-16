// Fitness log service worker.
// Scope is the directory of this file. On GitHub Pages that is
// /diamond-landscapes/fitness/ — the /fitness/ path of the Diamond Ops site.
// Register with scope "./" only. Scope "/fitness/" is rejected: this script
// does not live at the domain root.
//
// Cache names are prefixed fitness- so this worker never deletes the
// Diamond Ops cache (diamond-static-v4), and the root worker's cleanup
// must not be copied here.

const CACHE = 'fitness-static-v1';
const ICON = /\/icon-\d+\.png$/;

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k.startsWith('fitness-') && k !== CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (!ICON.test(url.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});

// Drink reminders. The page computes pace and asks us to show a notification.
// Periodic Background Sync, when the browser allows it, can also wake this
// worker and show the last saved nudge. iOS does not run periodic sync.
// Reliable alerts while the app is closed need Firebase Cloud Messaging.

function openHydrationDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open('fitness-hydration', 1);
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains('status')) req.result.createObjectStore('status');
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function readStatus() {
  return openHydrationDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('status', 'readonly');
      var req = tx.objectStore('status').get('latest');
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function writeStatus(status) {
  return openHydrationDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('status', 'readwrite');
      tx.objectStore('status').put(status, 'latest');
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function showDrinkNotice(title, body) {
  return self.registration.showNotification(title || 'Time to drink', {
    body: body || 'Drink some water',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'fitness-hydration',
    renotify: true
  });
}

function minutesNow() {
  var now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function clockToMinutes(value) {
  var match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function quietNow(status) {
  var start = clockToMinutes(status.quietStart);
  var end = clockToMinutes(status.quietEnd);
  if (start == null || end == null || start === end) return false;
  var mins = minutesNow();
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

function maybeNotifyFromStatus() {
  return readStatus().then(function (status) {
    if (!status || status.remindOn !== true) return;
    if (status.localDate !== localDate()) return;
    if (quietNow(status)) return;
    if (!(status.behind >= 8) || status.phase !== 'during') return;
    var every = Number(status.remindEveryMin) || 90;
    if (status.lastNotifiedAt) {
      var elapsed = (Date.now() - new Date(status.lastNotifiedAt).getTime()) / 60000;
      if (elapsed < every) return;
    }
    var next = Object.assign({}, status, { lastNotifiedAt: new Date().toISOString() });
    return writeStatus(next).then(function () {
      return showDrinkNotice(status.title, status.body);
    });
  }).catch(function () {});
}

function localDate() {
  var now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type !== 'fitness-hydration' || !data.status) return;
  event.waitUntil(writeStatus(data.status).then(function () {
    if (data.notify && data.title) return showDrinkNotice(data.title, data.body);
  }));
});

self.addEventListener('periodicsync', function (event) {
  if (event.tag === 'fitness-hydration') event.waitUntil(maybeNotifyFromStatus());
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
    var i;
    for (i = 0; i < clients.length; i++) {
      if (clients[i].url.indexOf('/fitness') !== -1 && 'focus' in clients[i]) return clients[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./index.html');
  }));
});

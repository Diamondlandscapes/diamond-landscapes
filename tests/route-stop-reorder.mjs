// Local regression tests for route stop reorder.
// Serves the app on localhost with ?fixture=routes. Firebase is never started.
// Google Maps is stubbed so the test does not call the live Maps API.
//
// Run from the repo root:
//   npm install --prefix tests puppeteer-core
//   node tests/route-stop-reorder.mjs

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';
const ARTIFACTS = process.env.ARTIFACTS_DIR || '/opt/cursor/artifacts';

const MAPS_STUB = `
window._dlMaps = [];
window._dlMapSeq = 0;
(function() {
  function LatLng(lat, lng) { this.lat = function(){ return lat; }; this.lng = function(){ return lng; }; }
  function LatLngBounds() { this.extend = function(){}; this.isEmpty = function(){ return false; }; }
  function paint(map) {
    if (!map || !map._el) return;
    var legend = map._el.querySelector('.mock-legend');
    if (!legend) {
      legend = document.createElement('div');
      legend.className = 'mock-legend';
      legend.style.cssText = 'position:absolute;left:12px;top:12px;right:12px;z-index:5;background:#0d1117;color:#e6edf3;padding:12px 14px;border-radius:12px;font:13px/1.45 -apple-system,sans-serif;border:1px solid #2d333b;';
      map._el.appendChild(legend);
    }
    var items = (map._markers || []).slice().sort(function(a, b){ return (a._z||0) - (b._z||0); });
    legend.innerHTML = '<div style="font-weight:800;margin-bottom:6px;">Fixture map · stop order</div>' + items.map(function(m){
      var raw = ((m._icon && m._icon.url) || '').split(',').slice(1).join(',');
      var svg = '';
      try { svg = decodeURIComponent(raw); } catch (e) {}
      var n = (svg.match(/>(\\d+)</) || [])[1] || '';
      var done = svg.indexOf('#3fb950') !== -1;
      return '<div>' + n + '. ' + m._title + (done ? ' · done' : '') + '</div>';
    }).join('');
  }
  function Map(el, opts) {
    this._el = el;
    this._center = opts.center;
    this._zoom = opts.zoom;
    this._fitCount = 0;
    this._markers = [];
    this._listeners = {};
    this._id = ++window._dlMapSeq;
    el.innerHTML = '';
    el.style.position = 'relative';
    el.style.background = '#161b22';
    var canvas = document.createElement('canvas');
    canvas.setAttribute('data-map-canvas', '1');
    el.appendChild(canvas);
    window._dlMaps.push(this);
  }
  Map.prototype.getDiv = function() { return this._el; };
  Map.prototype._emit = function(name) {
    var list = (this._listeners && this._listeners[name]) || [];
    this._listeners[name] = [];
    list.forEach(function(fn){ fn(); });
  };
  Map.prototype.getCenter = function() { return this._center; };
  Map.prototype.setCenter = function(c) { this._center = c; this._emit('bounds_changed'); };
  Map.prototype.getZoom = function() { return this._zoom; };
  Map.prototype.setZoom = function(z) { this._zoom = z; this._emit('bounds_changed'); };
  Map.prototype.fitBounds = function() {
    this._fitCount++;
    this._center = { lat: 26.5, lng: -80.1 };
    this._zoom = 14;
    this._emit('bounds_changed');
  };
  function Marker(opts) {
    this._title = opts.title;
    this._icon = opts.icon;
    this._z = opts.zIndex;
    this._map = null;
    this.setMap(opts.map || null);
  }
  Marker.prototype.setMap = function(m) {
    if (this._map && this._map._markers) this._map._markers = this._map._markers.filter(function(x){ return x !== this; }, this);
    this._map = m;
    if (m) {
      m._markers = m._markers || [];
      if (m._markers.indexOf(this) === -1) m._markers.push(this);
    }
    paint(m);
    paint(this._map);
  };
  Marker.prototype.addListener = function() {};
  function Geocoder() {}
  Geocoder.prototype.geocode = function(req, cb) {
    cb([{ geometry: { location: new LatLng(26.46, -80.07) } }], 'OK');
  };
  function InfoWindow() {}
  InfoWindow.prototype.setContent = function() {};
  InfoWindow.prototype.open = function() {};
  window.google = {
    maps: {
      Map: Map, Marker: Marker, Geocoder: Geocoder, InfoWindow: InfoWindow,
      LatLng: LatLng, LatLngBounds: LatLngBounds,
      Size: function(){}, Point: function(){},
      event: {
        addListenerOnce: function(obj, ev, fn) {
          obj._listeners = obj._listeners || {};
          obj._listeners[ev] = obj._listeners[ev] || [];
          obj._listeners[ev].push(fn);
        }
      },
      TravelMode: { DRIVING: 'DRIVING' }
    }
  };
})();
`;

function contentType(path) {
  const ext = extname(path);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json';
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') pathname = '/index.html';
        const filePath = normalize(join(ROOT, pathname));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
        const body = await readFile(filePath);
        res.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
        res.end(body);
      } catch (err) {
        res.writeHead(404); res.end(String(err && err.message || err));
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitReady(page) {
  const deadline = Date.now() + 25000;
  let stable = 0;
  while (Date.now() < deadline) {
    try {
      const ok = await page.evaluate(() => {
        const screen = document.getElementById('login-screen');
        const hidden = !screen || screen.style.display === 'none';
        return window._dlFixture === true && window._dlFixtureName === 'routes' && window._dlFixtureReady === true && hidden;
      });
      if (ok) {
        stable += 1;
        if (stable >= 3) return;
      } else stable = 0;
    } catch (err) { stable = 0; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('routes fixture did not become ready');
}

async function domOrder(page) {
  return page.evaluate(() => {
    const body = document.getElementById('rp-body');
    return Array.prototype.filter.call(body.children, (el) => el.classList && el.classList.contains('stop-card'))
      .map((el) => el.getAttribute('data-prop'));
  });
}

async function routeSnapshot(page) {
  return page.evaluate(() => {
    const route = state.routes.find((r) => r.id === 'route-mon');
    return {
      order: route.stops.map((s) => s.propId),
      crewId: route.crewId,
      crewCount: route.crewCount,
      name: route.name,
      status: route.status,
      stops: route.stops.map((s) => ({
        propId: s.propId,
        completed: !!s.completed,
        completedBy: s.completedBy || '',
        completedNotes: s.completedNotes || '',
        services: (s.completedServices || []).slice(),
        notes: s.notes || ''
      }))
    };
  });
}

function sameSet(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id)) && new Set(a).size === a.length;
}

async function openMonday(page) {
  await page.evaluate(() => {
    const pane = document.getElementById('rp-map-pane');
    if (pane) pane.style.display = 'none';
    document.getElementById('route-panel').classList.remove('map-open');
    document.getElementById('route-panel').classList.remove('open');
    window._currentRouteMapId = null;
    const route = state.routes.find((r) => r.id === 'route-mon');
    route.name = 'Monday T1';
    route.crewId = 'c-efrain';
    route.crewCount = 3;
    route.status = 'In Progress';
    route.stops = [
      { propId: 'p-palm', completed: true, completedBy: 'Efrain', completedServices: ['Mow & Edge'], completedAt: '11/9/2026', completedAtISO: '2026-11-09T15:00:00.000Z', completedNotes: 'Gate code 1234' },
      { propId: 'p-oak', completed: false, completedServices: [] },
      { propId: 'p-bay', completed: false, completedServices: [], notes: 'Side gate' },
      { propId: 'p-lake', completed: false, completedServices: [] }
    ];
    openRouteDetail('route-mon');
  });
}

async function revealStops(page, fromProp, toProp) {
  await page.evaluate((fromProp, toProp) => {
    const scroller = document.getElementById('rp-body');
    const from = document.querySelector('.stop-card[data-prop="' + fromProp + '"] .drag-handle')
      || document.querySelector('.stop-card[data-prop="' + fromProp + '"]');
    const to = document.querySelector('.stop-card[data-prop="' + toProp + '"]');
    const banner = document.getElementById('install-banner');
    const limit = banner ? banner.getBoundingClientRect().top - 12 : window.innerHeight - 12;
    const head = document.querySelector('#route-panel .panel-head');
    const minTop = head ? head.getBoundingClientRect().bottom + 8 : 8;
    // Park the grip just under the route header, clear of the install banner.
    const fromTop = from.getBoundingClientRect().top;
    scroller.scrollTop += fromTop - minTop;
    const toBottom = to.getBoundingClientRect().bottom;
    if (toBottom > limit) scroller.scrollTop += toBottom - limit;
    const again = from.getBoundingClientRect().top;
    if (again < minTop) scroller.scrollTop -= minTop - again;
  }, fromProp, toProp);
}

async function dragPoints(page, fromProp, toProp) {
  return page.evaluate((fromProp, toProp) => {
    const handle = document.querySelector('.stop-card[data-prop="' + fromProp + '"] .drag-handle');
    const card = document.querySelector('.stop-card[data-prop="' + toProp + '"]');
    const a = handle.getBoundingClientRect();
    const b = card.getBoundingClientRect();
    const y2 = Math.min(Math.max(b.top + 24, 80), window.innerHeight - 30);
    return {
      x1: Math.round(a.left + a.width / 2),
      y1: Math.round(a.top + a.height / 2),
      x2: Math.round(b.left + 36),
      y2: Math.round(y2)
    };
  }, fromProp, toProp);
}

async function dragHandle(page, fromProp, toProp) {
  await revealStops(page, fromProp, toProp);
  const cdp = await page.createCDPSession();
  let pt = await dragPoints(page, fromProp, toProp);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x1, y: pt.y1 });
  pt = await dragPoints(page, fromProp, toProp);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x1, y: pt.y1, button: 'left', buttons: 1, clickCount: 1 });
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: pt.x1 + (pt.x2 - pt.x1) * (i / steps),
      y: pt.y1 + (pt.y2 - pt.y1) * (i / steps),
      button: 'left',
      buttons: 1
    });
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x2, y: pt.y2, button: 'left', buttons: 0, clickCount: 1 });
  await cdp.detach();
}

async function touchDrag(page, fromProp, toProp) {
  await revealStops(page, fromProp, toProp);
  // Pointer events with pointerType touch are what iOS sends for a finger
  // drag. Dispatching them on the grip runs the same handler as a real touch.
  const hit = await page.evaluate((fromProp, toProp) => {
    const handle = document.querySelector('.stop-card[data-prop="' + fromProp + '"] .drag-handle');
    const target = document.querySelector('.stop-card[data-prop="' + toProp + '"]');
    const a = handle.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const x1 = a.left + a.width / 2;
    const y1 = a.top + a.height / 2;
    const under = document.elementFromPoint(x1, y1);
    const x2 = b.left + Math.min(36, b.width / 2);
    const y2 = Math.min(Math.max(b.top + 24, 70), window.innerHeight - 24);
    function fire(type, x, y, buttons) {
      handle.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, pointerId: 7, pointerType: 'touch',
        button: 0, buttons: buttons, isPrimary: true, width: 20, height: 20
      }));
    }
    fire('pointerdown', x1, y1, 1);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      fire('pointermove', x1 + (x2 - x1) * (i / steps), y1 + (y2 - y1) * (i / steps), 1);
    }
    fire('pointerup', x2, y2, 0);
    return {
      onGrip: !!(under && under.closest && under.closest('.drag-handle')),
      tag: under ? under.tagName : 'none',
      cls: under ? String(under.className || '').slice(0, 40) : '',
      text: under ? String(under.textContent || '').slice(0, 40) : '',
      x1: Math.round(x1), y1: Math.round(y1),
      top: Math.round(a.top), left: Math.round(a.left)
    };
  }, fromProp, toProp);
  assert(hit.onGrip, 'touch point was not on the grip for ' + fromProp + ' ' + JSON.stringify(hit));
}

async function mapState(page) {
  return page.evaluate(() => {
    const pane = document.getElementById('rp-map-pane');
    const panel = document.getElementById('route-panel');
    const btn = document.getElementById('rp-map-btn');
    const map = (window._dlMaps || [])[0] || null;
    const markers = map ? (map._markers || []).slice().sort((a, b) => (a._z || 0) - (b._z || 0)) : [];
    return {
      open: !!(pane && pane.style.display !== 'none'),
      mapClass: !!(panel && panel.classList.contains('map-open')),
      panelOpen: !!(panel && panel.classList.contains('open')),
      button: btn ? btn.textContent.replace(/\s+/g, ' ').trim() : '',
      maps: (window._dlMaps || []).length,
      fitCount: map ? map._fitCount : null,
      zoom: map ? map.getZoom() : null,
      center: map && map.getCenter() ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : null,
      titles: markers.map((m) => m._title),
      numbers: markers.map((m) => {
        const raw = ((m._icon && m._icon.url) || '').split(',').slice(1).join(',');
        let svg = '';
        try { svg = decodeURIComponent(raw); } catch (e) {}
        const n = (svg.match(/>(\d+)</) || [])[1];
        return n ? Number(n) : null;
      }),
      palmDone: markers.some((m) => m._title === 'Palm Court' && String((m._icon && m._icon.url) || '').indexOf('%233fb950') !== -1)
    };
  });
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const firebaseHits = [];
  const mapHits = [];
  const pageErrors = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('maps.googleapis.com/maps/api/js')) {
        req.respond({ status: 200, contentType: 'application/javascript', body: MAPS_STUB });
        return;
      }
      if (/firestore\.googleapis\.com|firebaseio\.com|firebasestorage\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com|firebase\.googleapis\.com/.test(url)) {
        firebaseHits.push(url);
        req.abort();
        return;
      }
      if (url.includes('maps.googleapis.com')) {
        mapHits.push(url);
        req.abort();
        return;
      }
      req.continue();
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('http://localhost:' + port + '/index.html?fixture=routes', { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await page.evaluate(() => {
      window._savedRouteOrders = [];
      window._gsSaveCalls = 0;
      const origSave = saveAndSync;
      window.saveAndSync = function(table, record) {
        if (table === 'routes' && record && record.stops) window._savedRouteOrders.push(record.stops.map((s) => s.propId));
        return origSave.apply(this, arguments);
      };
      const origGs = gsSave;
      window.gsSave = function() {
        window._gsSaveCalls += 1;
        return origGs.apply(this, arguments);
      };
    });

    await openMonday(page);
    let order = await domOrder(page);
    assert(order.join() === 'p-palm,p-oak,p-bay,p-lake', 'initial order ' + order.join());
    const handles = await page.$$('#rp-body .drag-handle');
    assert(handles.length === 4, 'expected 4 drag handles, got ' + handles.length);
    const upDisabled = await page.$eval('.stop-card[data-prop="p-palm"] .stop-move-up', (el) => el.disabled);
    const downDisabled = await page.$eval('.stop-card[data-prop="p-lake"] .stop-move-down', (el) => el.disabled);
    assert(upDisabled && downDisabled, 'first up and last down should be disabled');

    const palmRefOk = await page.evaluate(() => {
      window._palmStop = state.routes.find((r) => r.id === 'route-mon').stops[0];
      return window._palmStop.propId === 'p-palm' && window._palmStop.completed === true;
    });
    assert(palmRefOk, 'palm stop ref');

    // No-op and out-of-range must not save or drop a stop.
    const noop = await page.evaluate(() => {
      const before = window._savedRouteOrders.length;
      const route = state.routes.find((r) => r.id === 'route-mon');
      const same = moveRouteStopInPlace(route.stops, 1, 1);
      const bad = moveRouteStopInPlace(route.stops, -1, 0);
      const far = moveRouteStopInPlace(route.stops, 0, 99);
      reorderRouteStop('route-mon', 0, 99);
      reorderRouteStop('route-mon', 2, 2);
      return {
        same, bad, far,
        saved: window._savedRouteOrders.length - before,
        order: route.stops.map((s) => s.propId)
      };
    });
    assert(noop.same.ok === true && noop.same.changed === false, 'same index should be a no-op');
    assert(noop.bad.ok === false && noop.far.ok === false, 'out of range should fail');
    assert(noop.saved === 0, 'invalid reorder saved');
    assert(noop.order.join() === 'p-palm,p-oak,p-bay,p-lake', 'invalid reorder changed stops');

    // Button reorder, then keyboard on the grip.
    await page.click('.stop-card[data-prop="p-palm"] .stop-move-down');
    order = await domOrder(page);
    assert(order.join() === 'p-oak,p-palm,p-bay,p-lake', 'button down order ' + order.join());
    const focusLabel = await page.evaluate(() => {
      const handle = document.querySelector('.stop-card[data-prop="p-oak"] .drag-handle');
      handle.focus();
      return document.activeElement === handle;
    });
    assert(focusLabel, 'grip did not take keyboard focus');
    await page.keyboard.press('ArrowDown');
    order = await domOrder(page);
    assert(order.join() === 'p-palm,p-oak,p-bay,p-lake', 'keyboard order ' + order.join());

    // Expand a stop, type an unsaved route name, then drag. Both should survive.
    await page.evaluate(() => {
      document.querySelector('.stop-card[data-prop="p-bay"] .stop-head').click();
    });
    await page.evaluate(() => {
      const input = document.querySelector('#rp-title input');
      input.value = 'Monday T1 DRAFT';
    });
    await dragHandle(page, 'p-palm', 'p-bay');
    order = await domOrder(page);
    assert(order.join() === 'p-oak,p-bay,p-palm,p-lake', 'mouse drag order ' + order.join());
    const editorKept = await page.evaluate(() => {
      const bayOpen = document.querySelector('.stop-card[data-prop="p-bay"] .stop-body').classList.contains('open');
      const draft = document.querySelector('#rp-title input').value;
      const storedName = state.routes.find((r) => r.id === 'route-mon').name;
      const palm = state.routes.find((r) => r.id === 'route-mon').stops.find((s) => s.propId === 'p-palm');
      return { bayOpen, draft, storedName, samePalm: palm === window._palmStop };
    });
    assert(editorKept.bayOpen, 'expanded stop closed during drag');
    assert(editorKept.draft === 'Monday T1 DRAFT', 'unsaved route name lost: ' + editorKept.draft);
    assert(editorKept.storedName === 'Monday T1', 'draft name was saved early');
    assert(editorKept.samePalm, 'completed stop object was replaced');

    let snap = await routeSnapshot(page);
    assert(sameSet(snap.order, ['p-palm', 'p-oak', 'p-bay', 'p-lake']), 'duplicate or lost stop after drag ' + snap.order.join());
    assert(snap.order.join() === order.join(), 'saved order diverged from the list');
    const palm = snap.stops.find((s) => s.propId === 'p-palm');
    const bay = snap.stops.find((s) => s.propId === 'p-bay');
    assert(palm.completed && palm.completedBy === 'Efrain' && palm.completedNotes === 'Gate code 1234' && palm.services.join() === 'Mow & Edge', 'palm completion changed');
    assert(bay.completed === false && bay.notes === 'Side gate', 'bay notes changed');
    assert(snap.crewId === 'c-efrain' && snap.crewCount === 3 && snap.status === 'In Progress', 'crew or status changed');

    // Map stays open across a rebuild and two more reorders, camera included.
    await page.click('#rp-map-btn');
    await page.waitForFunction(() => (window._dlMaps || []).length === 1 && window._dlMaps[0]._markers.length === 4);
    let map = await mapState(page);
    assert(map.open && map.mapClass && map.button.indexOf('List') !== -1, 'map did not open ' + JSON.stringify(map));
    assert(map.titles.join() === 'Oak Lane,Bay Harbor,Palm Court,Lake View', 'initial marker order ' + map.titles.join());
    assert(map.numbers.join() === '1,2,3,4', 'marker numbers ' + map.numbers.join());
    assert(map.palmDone, 'completed palm pin lost its done color');

    await page.evaluate(() => {
      const map = window._dlMaps[0];
      map._fitCount = 0;
      map.setCenter({ lat: 26.2, lng: -80.2 });
      map.setZoom(16);
    });
    // The old bug hid the map inside openRouteDetail. Call it directly.
    await page.evaluate(() => openRouteDetail('route-mon'));
    map = await mapState(page);
    assert(map.open && map.mapClass, 'openRouteDetail closed the map');
    assert(map.maps === 1, 'map was recreated on refresh, count ' + map.maps);
    assert(map.fitCount === 0, 'refresh fit the bounds again');
    assert(map.zoom === 16 && map.center && map.center.lat === 26.2 && map.center.lng === -80.2, 'camera changed ' + JSON.stringify(map.center) + ' zoom ' + map.zoom);
    assert(map.titles.join() === 'Oak Lane,Bay Harbor,Palm Court,Lake View', 'refresh marker order ' + map.titles.join());
    const draftAfterRebuild = await page.$eval('#rp-title input', (el) => el.value);
    assert(draftAfterRebuild === 'Monday T1 DRAFT', 'rebuild dropped the unsaved name');

    await page.click('.stop-card[data-prop="p-lake"] .stop-move-up');
    order = await domOrder(page);
    assert(order.join() === 'p-oak,p-bay,p-lake,p-palm', 'second reorder ' + order.join());
    map = await mapState(page);
    assert(map.open && map.mapClass && map.maps === 1 && map.fitCount === 0, 'map closed or refit after button reorder ' + JSON.stringify(map));
    assert(map.zoom === 16 && map.center.lat === 26.2, 'camera lost after button reorder');
    assert(map.titles.join() === 'Oak Lane,Bay Harbor,Lake View,Palm Court', 'markers after button ' + map.titles.join());

    const beforeMapDrag = order.slice();
    await dragHandle(page, 'p-oak', 'p-lake');
    order = await domOrder(page);
    const names = { 'p-palm': 'Palm Court', 'p-oak': 'Oak Lane', 'p-bay': 'Bay Harbor', 'p-lake': 'Lake View', 'p-cove': 'Cove House' };
    assert(order.length === 4 && new Set(order).size === 4, 'drag while map open lost a stop ' + order.join());
    assert(order.join() !== beforeMapDrag.join(), 'drag while map open did not reorder ' + order.join());
    assert(order.indexOf('p-oak') > beforeMapDrag.indexOf('p-oak'), 'oak did not move down ' + order.join());
    map = await mapState(page);
    assert(map.open && map.panelOpen && map.maps === 1 && map.fitCount === 0 && map.zoom === 16, 'map closed after drag ' + JSON.stringify(map));
    assert(map.titles.join('|') === order.map((id) => names[id]).join('|'), 'markers after drag ' + map.titles.join() + ' vs ' + order.join());
    assert(map.numbers.join() === '1,2,3,4', 'marker numbers not rewritten');

    await page.evaluate(() => { var b = document.getElementById('install-banner'); if (b) b.remove(); });
    await page.screenshot({ path: ARTIFACTS + '/route-reorder-map-open.png' });

    // Closing the map still works, and a later reorder does not open it.
    await page.click('#rp-map-btn');
    map = await mapState(page);
    assert(!map.open && !map.mapClass && map.button.indexOf('Map') !== -1, 'map button did not close ' + JSON.stringify(map));
    await page.click('.stop-card[data-prop="p-bay"] .stop-move-down');
    map = await mapState(page);
    assert(!map.open && !map.mapClass, 'reorder reopened the map');

    // Opening another route is navigation: the previous map closes.
    await page.click('#rp-map-btn');
    await page.waitForFunction(() => document.getElementById('rp-map-pane').style.display !== 'none');
    await page.evaluate(() => openRouteDetail('route-tue'));
    const tuesday = await page.evaluate(() => {
      const pane = document.getElementById('rp-map-pane');
      const panel = document.getElementById('route-panel');
      const names = Array.prototype.filter.call(document.getElementById('rp-body').children, (el) => el.classList.contains('stop-card'))
        .map((el) => el.getAttribute('data-label'));
      return {
        open: pane.style.display !== 'none',
        mapClass: panel.classList.contains('map-open'),
        title: document.querySelector('#rp-title input').value,
        names
      };
    });
    assert(!tuesday.open && !tuesday.mapClass, 'switching routes left the map open');
    assert(tuesday.title === 'Tuesday T2', 'tuesday title ' + tuesday.title);
    assert(tuesday.names.join() === 'Cove House,Oak Lane', 'tuesday stops ' + tuesday.names.join());

    // Panel close still dismisses the editor.
    await page.evaluate(() => openRouteDetail('route-mon'));
    await page.click('#rp-map-btn');
    await page.click('#route-panel .close-btn');
    const closed = await page.evaluate(() => document.getElementById('route-panel').classList.contains('open'));
    assert(!closed, 'close button left the panel open');
    await page.evaluate(() => openRouteDetail('route-mon'));
    map = await mapState(page);
    assert(map.panelOpen && !map.open, 'reopening the route forced the map open');

    snap = await routeSnapshot(page);
    assert(sameSet(snap.order, ['p-palm', 'p-oak', 'p-bay', 'p-lake']), 'stops lost by the end ' + snap.order.join());
    assert(snap.crewId === 'c-efrain' && snap.crewCount === 3, 'crew changed by the end');
    const saved = await page.evaluate(() => window._savedRouteOrders.slice());
    assert(saved.length >= 4, 'expected several saved orders, got ' + saved.length);
    saved.forEach((ids, i) => {
      assert(ids.length === 4 && new Set(ids).size === 4, 'saved order ' + i + ' lost or duplicated ' + ids.join());
    });
    assert(saved[saved.length - 1].join() === snap.order.join(), 'last save does not match state');
    const gsCalls = await page.evaluate(() => window._gsSaveCalls);
    assert(gsCalls >= 4, 'reorder did not go through gsSave');
    const fbReady = await page.evaluate(() => window._fbReady === true);
    assert(!fbReady, 'Firebase became ready during the fixture');
    assert(firebaseHits.length === 0, 'production Firebase request: ' + firebaseHits.join(' | '));
    assert(mapHits.length === 0, 'live Maps request: ' + mapHits.join(' | '));

    // Crew cannot reorder, and the grip is not offered.
    await page.evaluate(() => { state.role = 'field'; openRouteDetail('route-mon'); });
    const crewUi = await page.evaluate(() => {
      const before = state.routes.find((r) => r.id === 'route-mon').stops.map((s) => s.propId).join();
      reorderRouteStop('route-mon', 0, 3);
      moveStop('route-mon', 'p-palm', 1);
      const after = state.routes.find((r) => r.id === 'route-mon').stops.map((s) => s.propId).join();
      return {
        handles: document.querySelectorAll('#rp-body .drag-handle').length,
        ups: document.querySelectorAll('#rp-body .stop-move-up').length,
        mapBtn: document.getElementById('rp-map-btn').style.display,
        before, after
      };
    });
    assert(crewUi.handles === 0 && crewUi.ups === 0, 'crew was offered reorder controls');
    assert(crewUi.mapBtn === 'none', 'crew was offered the route map');
    assert(crewUi.before === crewUi.after, 'crew reorder changed stops');

    // Touch drag on an iPhone-sized viewport.
    const phone = await browser.newPage();
    await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await phone.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
    await phone.setRequestInterception(true);
    phone.on('request', (req) => {
      const url = req.url();
      if (url.includes('maps.googleapis.com/maps/api/js')) {
        req.respond({ status: 200, contentType: 'application/javascript', body: MAPS_STUB });
        return;
      }
      if (/firestore\.googleapis\.com|firebaseio\.com|firebasestorage\.googleapis\.com|identitytoolkit|securetoken|firebaseinstallations|firebase\.googleapis/.test(url)) {
        firebaseHits.push(url);
        req.abort();
        return;
      }
      if (url.includes('maps.googleapis.com')) { mapHits.push(url); req.abort(); return; }
      req.continue();
    });
    phone.on('pageerror', (err) => pageErrors.push(String(err)));
    await phone.goto('http://localhost:' + port + '/index.html?fixture=routes', { waitUntil: 'domcontentloaded' });
    await waitReady(phone);
    await openMonday(phone);
    await touchDrag(phone, 'p-oak', 'p-bay');
    const touched = await domOrder(phone);
    assert(touched.join() === 'p-palm,p-bay,p-oak,p-lake', 'touch drag order ' + touched.join());
    const touchSnap = await routeSnapshot(phone);
    assert(sameSet(touchSnap.order, ['p-palm', 'p-oak', 'p-bay', 'p-lake']), 'touch lost a stop');
    assert(touchSnap.stops.find((s) => s.propId === 'p-palm').completedBy === 'Efrain', 'touch dropped completion');
    await phone.click('#rp-map-btn');
    await phone.waitForFunction(() => document.getElementById('rp-map-pane').style.display !== 'none');
    await touchDrag(phone, 'p-bay', 'p-oak');
    const touchMap = await phone.evaluate(() => ({
      open: document.getElementById('rp-map-pane').style.display !== 'none',
      mapClass: document.getElementById('route-panel').classList.contains('map-open'),
      order: Array.prototype.filter.call(document.getElementById('rp-body').children, (el) => el.classList.contains('stop-card')).map((el) => el.getAttribute('data-prop')).join()
    }));
    assert(touchMap.open && touchMap.mapClass, 'touch reorder closed the map');
    assert(touchMap.order === 'p-palm,p-oak,p-bay,p-lake', 'second touch order ' + touchMap.order);
    await phone.evaluate(() => {
      var b = document.getElementById('install-banner');
      if (b) b.remove();
      var head = document.querySelector('#rp-body .stop-card .stop-head');
      if (head) head.scrollIntoView({ block: 'center' });
    });
    await phone.screenshot({ path: ARTIFACTS + '/route-reorder-iphone.png' });
    await phone.click('#rp-map-btn');
    const phoneClosed = await phone.evaluate(() => document.getElementById('rp-map-pane').style.display === 'none');
    assert(phoneClosed, 'iPhone map button did not close');

    assert(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
    assert(firebaseHits.length === 0, 'firebase hits after phone: ' + firebaseHits.join(' | '));
    console.log('route reorder tests passed');
    console.log('saved orders', saved.length, 'gsSave calls', gsCalls);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});

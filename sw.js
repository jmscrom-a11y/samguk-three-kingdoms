// Service worker: installable, offline PWA.
// Strategy: code & data (html/js/css/json) are network-first so new scenarios
// and fixes show up as soon as the device is online; images (portraits, hex
// tiles, relief) are cache-first so the art is not re-downloaded every launch.
const CACHE = 'samguk-v2';
const CORE = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/eras.js', './js/battle.js', './js/hexview.js', './js/game.js', './js/terrain.js', './js/ui.js',
  './js/eras/samguk/era.js', './js/eras/samguk/data.js', './js/eras/samguk/events.js',
  './js/eras/samguk/geo.js', './js/eras/samguk/hexmaps.js',
  './img/eras/samguk/relief.png',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isImage = /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname);

  if (isImage) {
    // cache-first: art rarely changes
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // network-first for code & data: keep scenarios/UI fresh, fall back to cache offline
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

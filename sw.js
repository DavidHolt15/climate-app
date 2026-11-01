'use strict';
// Offline support for the Climate app.
//
// Network first: while the tablet is online it always gets the newest files, so publishing an update
// is all it takes. The cache is only used when the network is unavailable, so the app still opens.
// Weather and sensor requests go to other origins and are not handled here.
const CACHE = 'climate-shell-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

// Hosts such as GitHub Pages say "cache for 10 minutes", and the browser then reuses its own copy for
// that long without asking this worker, which would delay every update. Handing the page back marked
// no-cache makes the browser come back here each time.
function uncacheable(res) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'reload' }) // always go to the network, so a hosting cache can't hold back an update
      .then((res) => {
        if (!res.ok) return res;
        const fresh = uncacheable(res);
        const copy = fresh.clone(); // must be cloned now: the page starts reading `fresh` as soon as it is returned
        // every way of opening the page (?demo, ?workout, ...) is stored under one key
        caches.open(CACHE).then((cache) => cache.put(req.mode === 'navigate' ? 'index.html' : req, copy));
        return fresh;
      })
      .catch(() =>
        (req.mode === 'navigate' ? caches.match('index.html') : caches.match(req, { ignoreSearch: true }))
          .then((hit) => hit ?? Response.error())
      )
  );
});

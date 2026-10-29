// Service worker: guarda la app para abrirla sin conexión.
// Archivos propios: red primero (así llegan las actualizaciones) y, si no hay red, la copia guardada.
// Supabase, la API de Albion y los precios nunca se guardan: siempre van a la red.
const CACHE = 'regear-v1';
const SHELL = ['./', './index.html', './stock.html', './style.css', './data.js', './app.js', './stock.js', './config.js', './cloud.js', './pwa.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@';
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  // La librería de Supabase tiene versión fija: se guarda la primera vez y se usa sin red.
  if (req.method === 'GET' && req.url.startsWith(LIB)) {
    ev.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    })));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/gameinfo/')) return;
  ev.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});

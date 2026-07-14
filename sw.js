// ═══════════════════════════════════════════════════════════
// NutriMap · Service Worker (PWA do aluno)
// ═══════════════════════════════════════════════════════════
// Cache-first para o "app shell" (mesma origem, GET). Requisições ao Supabase
// (outra origem) e não-GET passam direto pela rede — nunca são cacheadas.

const CACHE = 'nutrimap-aluno-v2';
const SHELL = [
  '/app.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/js/paciente-ui.js',
  '/js/paciente-data.js',
  '/js/supabase.js',
  '/js/utils.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
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
  const url = new URL(req.url);

  // Só cuidamos de GET na própria origem. O resto (Supabase, esm.sh, POST...) vai direto.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first: SEMPRE tenta a versão mais nova; usa o cache só como
  // fallback offline. Evita servir código velho durante o desenvolvimento.
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return resp;
      })
      .catch(() => caches.match(req).then((cached) =>
        cached || (req.mode === 'navigate' ? caches.match('/app.html') : undefined)))
  );
});

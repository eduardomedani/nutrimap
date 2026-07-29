// ═══════════════════════════════════════════════════════════
// Evollo · Service Worker (PWA do aluno)
// ═══════════════════════════════════════════════════════════
// Cache-first para o "app shell" (mesma origem, GET). Requisições ao Supabase
// (outra origem) e não-GET passam direto pela rede — nunca são cacheadas.

const CACHE = 'nutrimap-aluno-v9';
// Caminhos relativos ao escopo do SW — funcionam tanto na raiz (localhost)
// quanto numa subpasta (GitHub Pages: /nutrimap/).
const SHELL = [
  'app.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'css/tokens.css',
  'css/brand.css',
  'css/execucao.css',
  'js/paciente-ui.js',
  'js/paciente-execucao.js',
  'js/execucao-core.js',
  'js/paciente-data.js',
  'js/push.js',
  'js/supabase.js',
  'js/utils.js',
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
        cached || (req.mode === 'navigate' ? caches.match('app.html') : undefined)))
  );
});

// ── Notificações push ──────────────────────────────────────
// A Edge Function envia um JSON { title, body, url, tag }. Mostramos a
// notificação; o clique foca uma aba aberta do app ou abre uma nova.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Evollo';
  const options = {
    body: data.body || 'Seu treino foi atualizado.',
    // Relativo ao escopo do SW: em subpasta (GitHub Pages, /nutrimap/) o
    // caminho absoluto resolvia para a raiz do domínio e dava 404 — a
    // notificação chegava sem ícone.
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'treino-atualizado',
    renotify: true,
    data: { url: data.url || '/app.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes('/app.html') && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

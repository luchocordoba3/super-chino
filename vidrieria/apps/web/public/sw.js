/* Lumina · Vidriería: avisos al celular y panel que abre sin señal. */
const CACHE = 'vd-v1';
const SHELL = '/panel-shell';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Archivos del armado (con hash en el nombre): primero la copia guardada.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }
  // Pantallas del panel: primero internet; sin señal, la última copia.
  if (req.mode === 'navigate' && url.pathname.startsWith('/panel')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(SHELL)) || Response.error()),
    );
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Vidriería', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.url,
      data: { url: d.url || '/panel' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/panel';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      for (const c of list) {
        if (new URL(c.url).pathname.startsWith('/panel') && 'focus' in c) {
          await c.focus();
          if ('navigate' in c) return c.navigate(url).catch(() => self.clients.openWindow(url));
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

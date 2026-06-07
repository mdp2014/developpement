const CACHE = 'messagerie-v1';
const ASSETS = ['./', './index.html', './style.css', './app.js', './features.js', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
            if (res.ok && ASSETS.some(a => url.pathname.endsWith(a.replace('./', '')) || url.pathname === '/')) {
                const clone = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return res;
        }).catch(() => cached))
    );
});

self.addEventListener('push', (e) => {
    let data = { title: 'Messagerie', body: 'Nouveau message', tag: 'msg' };
    try { data = { ...data, ...e.data.json() }; } catch {}
    e.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            tag: data.tag || 'msg',
            icon: './icon.svg',
            badge: './icon.svg',
            data: data.data || {},
            vibrate: [200, 100, 200],
            requireInteraction: data.requireInteraction || false
        })
    );
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const data = e.notification.data || {};
    const url = data.url || './index.html';
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const c of list) {
                if ('focus' in c) {
                    c.postMessage({ type: 'notification-click', data });
                    return c.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});

self.addEventListener('message', (e) => {
    if (e.data?.type === 'skipWaiting') self.skipWaiting();
});

const CACHE_NAME = 'minesweeper-assets-v1';
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './js/grid.js',
    './js/script.js',
    './js/v.js',
    './manifest.json',
    './icon.svg',
    './hash.txt',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap'
];

// Install: Cache everything and skip waiting
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

// Activate: Clean up old caches and claim clients
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Stale-While-Revalidate strategy
self.addEventListener('fetch', event => {
    // Skip non-GET requests or browser extensions
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async cache => {
            const cachedResponse = await cache.match(event.request);
            const fetchPromise = fetch(event.request).then(networkResponse => {
                if (networkResponse.ok) {
                    cache.put(event.request, networkResponse.clone());
                }
                return networkResponse;
            }).catch(() => {
                // Fallback to cache if network fails entirely
                return cachedResponse;
            });
            return cachedResponse || fetchPromise;
        })
    );
});
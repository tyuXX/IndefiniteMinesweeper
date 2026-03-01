// At the top of sw.js
const CACHE_NAME = 'minesweeper-cache-v2';
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './js/grid.js',
    './js/script.js',
    './manifest.json',
    './icon.svg'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});
// Service Worker state management
let currentVersion = null;
let isInstalling = false;
let versionPromise = null;

// Validate hash content format
function validateHash(hash) {
    return typeof hash === 'string' && hash.trim().length > 0 && hash.trim().length <= 100;
}

// Get cache name for current version
function getCacheName(version) {
    return `idms_offline_cache_${version}`;
}

// Initialize version once and cache the promise
async function initializeVersion() {
    if (versionPromise) {
        return versionPromise;
    }
    
    versionPromise = (async () => {
        try {
            const response = await fetch('./hash.txt');
            if (!response.ok) throw new Error('Network response was not ok');
            const hashText = await response.text();
            const trimmedHash = hashText.trim();
            
            if (validateHash(trimmedHash)) {
                return trimmedHash;
            } else {
                console.warn('Invalid hash format, using timestamp');
                return 'v' + Date.now();
            }
        } catch (error) {
            console.warn('Failed to fetch version, using timestamp:', error);
            return 'v' + Date.now();
        }
    })();
    
    return versionPromise;
}

// Get current version (waits for initialization)
async function getCurrentVersion() {
    if (currentVersion) {
        return currentVersion;
    }
    currentVersion = await initializeVersion();
    return currentVersion;
}

// Install: Cache everything and skip waiting
self.addEventListener('install', event => {
    isInstalling = true;
    event.waitUntil(
        initializeVersion()
            .then(version => {
                currentVersion = version;
                const CACHE_NAME = getCacheName(version);
                return caches.open(CACHE_NAME)
                    .then(cache => cache.addAll(urlsToCache));
            })
            .then(() => self.skipWaiting())
            .catch(error => {
                console.error('Service worker installation failed:', error);
                // Don't create fallback cache on install failure
                throw error;
            })
            .finally(() => {
                isInstalling = false;
            })
    );
});

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

// Activate: Clean up old caches and claim clients
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Clean up old offline caches
                    if (cacheName.startsWith('idms_offline_cache_')) {
                        // Ensure we have current version for comparison
                        return getCurrentVersion().then(version => {
                            if (cacheName !== getCacheName(version)) {
                                return caches.delete(cacheName);
                            }
                            return Promise.resolve();
                        });
                    }
                    return Promise.resolve();
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Stale-While-Revalidate strategy with version checking
self.addEventListener('fetch', event => {
    // Skip non-GET requests or browser extensions
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

    event.respondWith(
        (async () => {
            try {
                // Ensure we have a current version
                if (!currentVersion && !isInstalling) {
                    currentVersion = await getCurrentVersion();
                }

                // Handle version checking for hash.txt
                if (event.request.url.includes('hash.txt')) {
                    try {
                        const response = await fetch(event.request);
                        if (!response.ok) throw new Error('Network response was not ok');
                        
                        const newHash = await response.text();
                        if (validateHash(newHash.trim())) {
                            // Check if version changed, but don't trigger immediate update
                            // to avoid infinite loops. Let normal service worker lifecycle handle updates.
                            if (currentVersion && currentVersion !== newHash.trim()) {
                                console.log('Version detected:', newHash.trim());
                            }
                            // Return a fresh response since we consumed the body
                            return new Response(newHash, {
                                headers: { 'Content-Type': 'text/plain' }
                            });
                        } else {
                            // Invalid hash, return cached version or fallback
                            const cachedResponse = await caches.match(event.request);
                            return cachedResponse || new Response('development', {
                                headers: { 'Content-Type': 'text/plain' }
                            });
                        }
                    } catch (error) {
                        console.warn('Failed to fetch hash.txt:', error);
                        const cachedResponse = await caches.match(event.request);
                        return cachedResponse || new Response('development', {
                            headers: { 'Content-Type': 'text/plain' }
                        });
                    }
                }

                // Regular cache handling for other files
                const version = await getCurrentVersion();
                const currentCacheName = getCacheName(version);
                const cache = await caches.open(currentCacheName);
                const cachedResponse = await cache.match(event.request);
                
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse.ok) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                }).catch(error => {
                    console.warn('Network request failed, using cache:', error);
                    return cachedResponse;
                });
                
                return cachedResponse || fetchPromise;
            } catch (error) {
                console.error('Cache handling error:', error);
                // Ultimate fallback to network
                return fetch(event.request);
            }
        })()
    );
});
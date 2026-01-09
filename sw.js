
const CACHE_NAME = 'peakpoint-v2-offline-maps';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './index.tsx',
  './types.ts',
  './constants.tsx',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Map Tiles Caching Strategy (Stale-While-Revalidate or Cache First)
  // Cache OSM and Satellite tiles aggressively
  if (url.hostname.includes('openstreetmap.org') || 
      url.hostname.includes('arcgisonline.com') || 
      url.hostname.includes('rainviewer.com')) {
      
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          // Clone and cache the map tile
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
             cache.put(event.request, responseClone);
          });
          return networkResponse;
        });
      })
    );
    return;
  }

  // 2. Standard Assets Strategy
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => {
        // Fallback for images
        if (event.request.destination === 'image') {
          return caches.match('https://picsum.photos/seed/mountain/800/600');
        }
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

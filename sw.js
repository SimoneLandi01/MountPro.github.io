
const CACHE_NAME = 'peakpoint-v1';
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
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Ritorna la risorsa dalla cache se esiste, altrimenti vai in rete
      return response || fetch(event.request).catch(() => {
        // Fallback per immagini o risorse non trovate in offline
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
});

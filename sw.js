
const CACHE_NAME = 'peakpoint-v3-offline-pro';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './index.tsx',
  './types.ts',
  './constants.tsx',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strategy for Map Tiles: Cache First, then update in background
  if (url.hostname.includes('openstreetmap.org') || 
      url.hostname.includes('arcgisonline.com') || 
      url.hostname.includes('rainviewer.com')) {
    
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return networkResponse;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Strategy for Static Assets: Cache with Network Fallback
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => {
        if (event.request.destination === 'image') {
          return caches.match('https://picsum.photos/seed/mountain/800/600');
        }
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    ))
  );
  self.clients.claim();
});

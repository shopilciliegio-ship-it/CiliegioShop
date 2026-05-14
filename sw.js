// Service Worker — Il Ciliegio Shop
const VERSION = 'v63';
const CACHE = 'ciliegio-' + VERSION;

// On install: skip waiting to activate immediately
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

// On activate: delete old caches and claim clients
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// On fetch: network first, cache fallback
self.addEventListener('fetch', function(e) {
  e.respondWith(
    fetch(e.request).then(function(response) {
      // Cache a copy of the response
      var copy = response.clone();
      caches.open(CACHE).then(function(cache) {
        cache.put(e.request, copy);
      });
      return response;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});

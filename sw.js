// Service Worker — Il Ciliegio Shop
const VERSION = 'v85';
const CACHE = 'ciliegio-' + VERSION;

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

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

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Never intercept: Netlify functions, Stripe, external APIs
  if (url.includes('netlify/functions') ||
      url.includes('stripe.com') ||
      url.includes('nominatim.openstreetmap') ||
      url.includes('googleapis.com') ||
      url.includes('googletagmanager') ||
      e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network first, cache fallback for everything else
  e.respondWith(
    fetch(e.request).then(function(response) {
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

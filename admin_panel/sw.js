self.addEventListener("install", event => {
  event.waitUntil(
    caches.open("admin-cache").then(cache => {
      return cache.addAll([
        "/admin_panel/index.html"
      ]);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

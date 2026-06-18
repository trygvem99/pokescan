/* Minimal service worker: caches the app shell so PokéScan loads offline.
 * Card data and prices are always fetched live (never cached). */
const CACHE = "pokescan-v2";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only serve the local app shell from cache; everything else goes to network.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
  }
});

/**
 * Service Worker (Phase 7): cached NUR die App-Shell — Navigationen und
 * same-origin statische Assets (JS/CSS/Icons). Ausdrücklich NICHT gecacht
 * (PRD F6): /api/* und alles Cross-Origin (swisstopo-Kacheln, BRouter,
 * GeoAdmin) — solche Requests gehen unverändert ans Netz.
 */
const CACHE = 'tourenbuch-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/']))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Kacheln/Dienste: nie cachen
  if (url.pathname.startsWith('/api/')) return // API: nie cachen

  // App-Shell: network-first für Navigationen (frische index.html, Offline-Fallback
  // aus dem Cache), cache-first für gehashte statische Assets.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put('/', copy))
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && ['script', 'style', 'image', 'font'].includes(req.destination)) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(req, copy))
          }
          return res
        })
    )
  )
})

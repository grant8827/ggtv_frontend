// GGTV service worker. It makes the site installable and shows an offline screen when a page
// can't load. It deliberately caches nothing else: the channel is live, and the app's files
// must always be fresh after a deploy.
const OFFLINE_CACHE = 'ggtv-offline-v2'
const OFFLINE_URL = '/offline.html'
const OFFLINE_ICON = '/logo.png'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.addAll([OFFLINE_URL, OFFLINE_ICON])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)))
  } else if (new URL(event.request.url).pathname === OFFLINE_ICON) {
    // The offline page shows the icon, so it must load without a connection too.
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_ICON)))
  }
})

const CACHE = 'oncue-v4'

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(['/manifest.json', '/dcc-logo.png', '/api/icon-192', '/api/icon-512'])
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Skip Supabase API calls — always fetch live
  if (url.hostname.includes('supabase.co')) return

  // Network-first for API routes
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }

  // Cache-first for static assets
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(png|svg|ico|woff2?)$/)
  ) {
    e.respondWith(
      caches.match(request).then(cached => cached ?? fetch(request).then(res => {
        const clone = res.clone()
        caches.open(CACHE).then(cache => cache.put(request, clone))
        return res
      }))
    )
    return
  }

  // Network-first for everything else — cache on success
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return res
      })
      .catch(() => caches.match(request))
  )
})

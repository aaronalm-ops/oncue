const CACHE = 'oncue-v9'

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(['/manifest.webmanifest'])
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

  // Identity files — manifest + app icons — are NEVER cache-first. Chrome
  // decides whether the installed app's icon/splash needs updating by
  // re-fetching these through this worker and hashing them; serving a
  // cached copy meant a new logo could never reach the home screen (the
  // cache said nothing changed). Network-first, cache only as offline fallback.
  if (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/manifest.json' ||
    /^\/(icon-[^/]+|apple-touch-icon)\.png$/.test(url.pathname)
  ) {
    e.respondWith(
      fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return res
      }).catch(() => caches.match(request))
    )
    return
  }

  // Cache-first for static assets (hashed build files, fonts, illustrations)
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

  // P6 — navigations: network-first with a 2.5s patience window. If the
  // network is slow and we hold a recent copy, show it instantly; the fetch
  // keeps running in the background and refreshes the cache for next time.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      const cachedPromise = caches.match(request)
      const networkPromise = fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return res
      })
      const winner = await Promise.race([
        networkPromise.catch(() => 'error'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 2500)),
      ])
      if (winner !== 'timeout' && winner !== 'error') return winner
      const cached = await cachedPromise
      if (cached) {
        networkPromise.catch(() => {}) // background refresh continues
        return cached
      }
      // nothing cached — wait out the network after all
      return networkPromise.catch(() => Response.error())
    })())
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

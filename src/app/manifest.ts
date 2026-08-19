import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OnCue',
    short_name: 'OnCue',
    description: 'Worship team setlist',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    // Point straight at the PNGs. The old /api/icon-* URLs were 308 redirects,
    // and WebKit does not reliably follow redirects when fetching manifest
    // icons during "Add to Home Screen" — the install would land with a blank
    // or generic icon. /api/icon-* stays alive as a redirect for PWAs that
    // already cached the old manifest.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      // A 512 with purpose "any" is required alongside the maskable one —
      // previously the only 512 was maskable, which fails installability checks.
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

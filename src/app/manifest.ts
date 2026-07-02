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
    icons: [
      { src: '/api/icon-192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/api/icon-512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

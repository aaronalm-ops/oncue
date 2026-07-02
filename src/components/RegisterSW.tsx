'use client'

import { useEffect, useState } from 'react'

export default function RegisterSW() {
  const [installEvent, setInstallEvent] = useState<Event & { prompt?: () => void } | null>(null)
  const [showIOSHint, setShowIOSHint] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    // Already installed as PWA — don't show banner
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (dismissed) return

    // Android/Chrome — capture the install prompt
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS Safari — no beforeinstallprompt, show manual hint
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream: unknown }).MSStream
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    if (isIOS && isSafari) setShowIOSHint(true)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [dismissed])

  if (dismissed) return null

  if (installEvent) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 bg-zinc-900 border border-purple-800 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl shadow-purple-950/40">
        <div className="w-9 h-9 bg-zinc-950 rounded-xl border border-purple-900/40 flex flex-col items-center justify-center gap-0.5 shrink-0">
          <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
            <polygon points="4,3 13,8 4,13" fill="#9333EA" />
          </svg>
          <div className="flex gap-0.5">
            <div className="w-3.5 h-0.5 bg-purple-600 rounded-full" />
            <div className="w-2 h-0.5 bg-purple-900 rounded-full" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold">Install OnCue</p>
          <p className="text-zinc-400 text-xs">Add to your home screen</p>
        </div>
        <button
          onClick={() => { setDismissed(true) }}
          className="text-zinc-600 p-1"
          aria-label="Dismiss">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button
          onClick={async () => {
            if (!installEvent?.prompt) return
            await installEvent.prompt()
            setInstallEvent(null)
          }}
          className="bg-purple-600 text-white text-sm font-semibold rounded-xl px-4 py-2 shrink-0 active:scale-95 transition-transform">
          Install
        </button>
      </div>
    )
  }

  if (showIOSHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 bg-zinc-900 border border-purple-800 rounded-2xl px-4 py-3 shadow-xl shadow-purple-950/40">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-zinc-950 rounded-xl border border-purple-900/40 flex flex-col items-center justify-center gap-0.5 shrink-0 mt-0.5">
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
              <polygon points="4,3 13,8 4,13" fill="#9333EA" />
            </svg>
            <div className="flex gap-0.5">
              <div className="w-3.5 h-0.5 bg-purple-600 rounded-full" />
              <div className="w-2 h-0.5 bg-purple-900 rounded-full" />
            </div>
          </div>
          <div className="flex-1">
            <p className="text-white text-sm font-semibold">Install OnCue</p>
            <p className="text-zinc-400 text-xs mt-0.5">
              Tap the <span className="text-white">Share</span> button{' '}
              <svg className="inline w-3.5 h-3.5 mb-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l-3 3h2v9h2V5h2l-3-3zm-7 7v12h14V9h-3v2h1v8H5V11h1V9H5z"/>
              </svg>{' '}
              then <span className="text-white">&ldquo;Add to Home Screen&rdquo;</span>
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-zinc-600 p-1 shrink-0"
            aria-label="Dismiss">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return null
}

'use client'

import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> }

declare global {
  interface Window { __pwaPrompt: BeforeInstallPromptEvent | null }
}

export default function RegisterSW() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSHint, setShowIOSHint] = useState(false)
  const [showSamsungHint, setShowSamsungHint] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    // Already running as installed PWA — hide banner
    if (window.matchMedia('(display-mode: standalone)').matches) return

    // Samsung Internet mints WebAPKs that Google Play Protect blocks as
    // "unsafe" ("built for an older version of Android"), and its
    // "Install anyway" often fails silently. Known Samsung-wide issue —
    // route these users to Chrome, which installs cleanly.
    const ua = navigator.userAgent
    if (/SamsungBrowser/i.test(ua)) {
      setShowSamsungHint(true)
      return
    }

    // Pick up event captured by the inline script before React loaded
    if (window.__pwaPrompt) {
      setInstallEvent(window.__pwaPrompt)
      window.__pwaPrompt = null
    }

    // Also listen for the event firing after mount (e.g. on return visits)
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS Safari — no beforeinstallprompt, show manual hint
    const isIOS = /iphone|ipad|ipod/i.test(ua)
    const isInWebAppiOS = (navigator as Navigator & { standalone?: boolean }).standalone === true
    const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua)
    if (isIOS && isSafari && !isInWebAppiOS) setShowIOSHint(true)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function openInChrome() {
    // Android intent URL: opens this exact page in Chrome
    const { host, pathname, search } = window.location
    window.location.href =
      `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;` +
      `S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`
  }

  if (dismissed) return null

  if (showSamsungHint) {
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
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Install OnCue</p>
            <p className="text-zinc-400 text-xs mt-0.5">
              Samsung&rsquo;s browser can&rsquo;t install apps right now (a known Samsung issue). Use Chrome instead.
            </p>
          </div>
          <button onClick={() => setDismissed(true)} className="text-zinc-600 p-1 shrink-0" aria-label="Dismiss">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <button
          onClick={openInChrome}
          className="mt-2.5 w-full bg-purple-600 text-white text-sm font-semibold rounded-xl px-4 py-2 active:scale-95 transition-transform">
          Open in Chrome
        </button>
      </div>
    )
  }

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
        <button onClick={() => setDismissed(true)} className="text-zinc-600 p-1" aria-label="Dismiss">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button
          onClick={async () => {
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
              Tap the <span className="text-white">Share</span> button below, then{' '}
              <span className="text-white">&ldquo;Add to Home Screen&rdquo;</span>
            </p>
          </div>
          <button onClick={() => setDismissed(true)} className="text-zinc-600 p-1 shrink-0" aria-label="Dismiss">
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

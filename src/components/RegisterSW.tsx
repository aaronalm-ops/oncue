'use client'

import { useEffect, useState } from 'react'
import Logo from '@/components/Logo'

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> }

declare global {
  interface Window { __pwaPrompt: BeforeInstallPromptEvent | null }
}

export default function RegisterSW() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosHint, setIosHint] = useState<'safari' | 'other' | null>(null)
  const [showSamsungHint, setShowSamsungHint] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    // Already running as installed PWA — hide banner
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const ua = navigator.userAgent
    const nav = navigator as Navigator & { standalone?: boolean }

    // --- iOS first ---------------------------------------------------------
    // No iOS browser ever fires beforeinstallprompt (they are all WebKit), so
    // the manual hint is the ONLY install affordance iOS users get. It has to
    // fire for every browser on the platform, not just Safari.
    //
    // iPadOS 13+ Safari reports itself as "Macintosh" by default (desktop-class
    // browsing), so the classic /ipad/ sniff misses every iPad. maxTouchPoints
    // is the standard workaround.
    const isIOS =
      /iphone|ipad|ipod/i.test(ua) ||
      (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)

    if (isIOS) {
      // navigator.standalone covers pre-16.4 installs that predate display-mode
      if (nav.standalone === true) return
      // Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS), Opera (OPiOS) all put
      // "Add to Home Screen" behind the Share button too, but it sits next to
      // the address bar rather than in the bottom toolbar.
      const isSafari = !/crios|fxios|edgios|opios|chrome/i.test(ua)
      setIosHint(isSafari ? 'safari' : 'other')
      return
    }

    // --- Android / desktop -------------------------------------------------
    // Samsung Internet mints WebAPKs that Google Play Protect blocks as
    // "unsafe" ("built for an older version of Android"), and its
    // "Install anyway" often fails silently. Known Samsung-wide issue —
    // route these users to Chrome, which installs cleanly.
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

  const DismissButton = (
    <button onClick={() => setDismissed(true)} className="text-zinc-600 p-1 shrink-0" aria-label="Dismiss">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )

  if (showSamsungHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 bg-zinc-900 border border-purple-800 rounded-2xl px-4 py-3 shadow-xl shadow-purple-950/40">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-zinc-950 rounded-xl border border-purple-900/40 flex items-center justify-center shrink-0 mt-0.5">
            <Logo className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Install OnCue</p>
            <p className="text-zinc-400 text-xs mt-0.5">
              Samsung&rsquo;s browser can&rsquo;t install apps right now (a known Samsung issue). Use Chrome instead.
            </p>
          </div>
          {DismissButton}
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
        <div className="w-9 h-9 bg-zinc-950 rounded-xl border border-purple-900/40 flex items-center justify-center shrink-0">
          <Logo className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold">Install OnCue</p>
          <p className="text-zinc-400 text-xs">Add to your home screen</p>
        </div>
        {DismissButton}
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

  if (iosHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 bg-zinc-900 border border-purple-800 rounded-2xl px-4 py-3 shadow-xl shadow-purple-950/40">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-zinc-950 rounded-xl border border-purple-900/40 flex items-center justify-center shrink-0 mt-0.5">
            <Logo className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-white text-sm font-semibold">Install OnCue</p>
            {iosHint === 'safari' ? (
              <p className="text-zinc-400 text-xs mt-0.5">
                Tap the <span className="text-white">Share</span> button at the bottom of Safari, then{' '}
                <span className="text-white">&ldquo;Add to Home Screen&rdquo;</span>
              </p>
            ) : (
              <p className="text-zinc-400 text-xs mt-0.5">
                Tap the <span className="text-white">Share</span> button next to the address bar, then{' '}
                <span className="text-white">&ldquo;Add to Home Screen&rdquo;</span>. You&rsquo;ll need to sign in
                once more inside the installed app.
              </p>
            )}
          </div>
          {DismissButton}
        </div>
      </div>
    )
  }

  return null
}

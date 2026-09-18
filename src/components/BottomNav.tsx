'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Bottom tab bar — Home · Chords · Listen · Me.
 *
 * Four level tabs; the ACTIVE one lifts its icon into a purple disc (the
 * disc slides up and fills in — pure CSS transition, so switching tabs
 * animates). No tab is permanently raised: Listen is used a few times a
 * month, not enough to earn a highlight on every screen.
 *
 * Shows only on "browsing" pages. Performance surfaces (Stage View, Live, the
 * standalone chord sheet, the version editor) own their bottom edge already
 * — Prev/Next and the floating controls live there — so the bar stays off
 * them. Auth screens have nothing to navigate to yet.
 */

const SHOW_ON: RegExp[] = [
  /^\/services$/,
  /^\/services\/[^/]+$/,      // hub (not /my-part, /live, /edit, /chords/…)
  /^\/library(\/[^/]+)?$/,    // library + song page (not /version/…)
  /^\/stats$/,
  /^\/admin$/,
  /^\/me$/,
  /^\/identify$/,
]

interface Props {
  /** today's service hub when there is one, else the list */
  homeHref: string
  hasServiceToday: boolean
}

export const BOTTOM_NAV_HEIGHT = 64 // px, before the safe-area inset

const ICONS = {
  home: 'M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z',
  chords: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
  listen: 'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z',
  me: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
}

function Tab({ href, active, icon, label, dot = false }: {
  href: string; active: boolean; icon: string; label: string; dot?: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="flex-1 flex flex-col items-center justify-end pb-2 text-[10px] font-semibold uppercase tracking-wider"
    >
      {/* The disc: sits flat and invisible when idle; lifts + fills when active. */}
      <span
        className={`relative shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ease-out ${
          active
            ? '-translate-y-3 bg-gradient-to-br from-purple-500 via-purple-600 to-purple-800 text-white shadow-lg shadow-purple-950/70 ring-4 ring-black'
            : 'translate-y-0 bg-transparent text-zinc-500 ring-0'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={icon} />
        </svg>
        {dot && (
          <span
            className={`absolute top-2 right-2 w-2 h-2 rounded-full ring-2 transition-colors duration-300 ${active ? 'bg-white ring-purple-600' : 'bg-purple-400 ring-black'}`}
            aria-label="Service today"
          />
        )}
      </span>
      <span className={`-mt-1 transition-colors duration-300 ${active ? 'text-purple-300' : 'text-zinc-500'}`}>{label}</span>
    </Link>
  )
}

export default function BottomNav({ homeHref, hasServiceToday }: Props) {
  const pathname = usePathname() ?? ''
  if (!SHOW_ON.some(r => r.test(pathname))) return null

  const isHome = pathname.startsWith('/services')
  const isChords = pathname.startsWith('/library')
  const isListen = pathname === '/identify'
  const isMe = pathname === '/me' || pathname === '/stats' || pathname === '/admin'

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-900 bg-black/90 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-lg mx-auto flex items-stretch" style={{ height: BOTTOM_NAV_HEIGHT }}>
        <Tab href={homeHref} active={isHome} icon={ICONS.home} label="Home" dot={hasServiceToday} />
        <Tab href="/library" active={isChords} icon={ICONS.chords} label="Chords" />
        <Tab href="/identify" active={isListen} icon={ICONS.listen} label="Listen" />
        <Tab href="/me" active={isMe} icon={ICONS.me} label="Me" />
      </div>
    </nav>
  )
}

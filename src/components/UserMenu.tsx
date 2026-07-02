'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function UserMenu({ instrument }: { instrument: string | null }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function signOut() {
    setOpen(false)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center active:bg-zinc-700 transition-colors"
        aria-label="Account menu"
      >
        <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-52 overflow-hidden">
            {instrument && (
              <div className="px-4 py-2.5 border-b border-zinc-800">
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest">My instrument</p>
                <p className="text-sm font-semibold text-white mt-0.5">{instrument.charAt(0) + instrument.slice(1).toLowerCase()}</p>
              </div>
            )}
            <Link
              href="/auth/select-instrument"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-white active:bg-zinc-800 transition-colors"
            >
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              Change instrument
            </Link>
            <div className="border-t border-zinc-800" />
            <button
              onClick={signOut}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 active:bg-zinc-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

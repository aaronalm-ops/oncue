'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Avatar from '@/components/Avatar'
import type { AppRole } from '@/lib/types'

interface Props {
  instrument: string | null
  role: AppRole
  displayName?: string | null
}

export default function UserMenu({ instrument, role, displayName = null }: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  async function signOut() {
    setOpen(false)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isPrivileged = role === 'master' || role === 'admin'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="rounded-full active:scale-95 transition-transform"
        aria-label="Account menu"
      >
        <Avatar name={displayName} size={32} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-52 overflow-hidden">
            {(displayName || instrument) && (
              <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center gap-3">
                <Avatar name={displayName} size={34} />
                <div className="min-w-0">
                  {displayName && <p className="text-sm font-semibold text-white truncate">{displayName}</p>}
                  {instrument && (
                    <p className="text-[11px] text-zinc-500">
                      {instrument.charAt(0) + instrument.slice(1).toLowerCase()}
                    </p>
                  )}
                </div>
              </div>
            )}
            <Link
              href="/auth/select-instrument"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-white active:bg-zinc-800 transition-colors"
            >
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              My Profile
            </Link>
            {isPrivileged && (
              <>
                <div className="border-t border-zinc-800" />
                <Link
                  href="/admin"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-white active:bg-zinc-800 transition-colors"
                >
                  <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Admin
                </Link>
              </>
            )}
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

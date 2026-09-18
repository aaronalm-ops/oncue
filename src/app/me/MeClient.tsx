'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Avatar from '@/components/Avatar'
import { TEAM_LABELS, type AppRole, type AppTeam } from '@/lib/types'

interface Props {
  role: AppRole
  instrument: string | null
  displayName: string | null
  preferredKey: string | null
  teams: AppTeam[]
}

const ROLE_LABEL: Record<AppRole, string> = {
  master: 'Master', admin: 'Admin', worship_leader: 'Worship leader', member: 'Member',
}

function Row({ href, onClick, icon, title, sub, tone = 'default' }: {
  href?: string; onClick?: () => void; icon: React.ReactNode; title: string; sub?: string; tone?: 'default' | 'danger'
}) {
  const cls = `w-full flex items-center gap-4 bg-zinc-900 rounded-2xl px-4 py-4 active:bg-zinc-800 transition-colors border border-zinc-800/50 text-left ${
    tone === 'danger' ? 'text-red-400' : 'text-white'
  }`
  const body = (
    <>
      <span className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-sm">{title}</span>
        {sub && <span className="block text-xs text-zinc-500 truncate">{sub}</span>}
      </span>
      {href && (
        <svg className="w-4 h-4 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </>
  )
  return href ? <Link href={href} className={cls}>{body}</Link> : <button onClick={onClick} className={cls}>{body}</button>
}

export default function MeClient({ role, instrument, displayName, preferredKey, teams }: Props) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const isPrivileged = role === 'master' || role === 'admin'
  // Same gate as worship_stats(): leaders see their own numbers, admins see all.
  const canSeeStats = isPrivileged || role === 'worship_leader'
  const prettyInstrument = instrument ? instrument.charAt(0) + instrument.slice(1).toLowerCase() : null

  async function signOut() {
    setSigningOut(true)
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  const icon = (d: string) => (
    <svg className="w-5 h-5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
    </svg>
  )

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-28 space-y-6">

        {/* Identity card */}
        <div className="rounded-2xl bg-gradient-to-b from-purple-900/30 to-transparent p-5 border border-zinc-800/50 flex items-center gap-4">
          <Avatar name={displayName} size={56} />
          <div className="min-w-0">
            <p className="text-xl font-bold leading-tight truncate">{displayName || 'Unnamed member'}</p>
            <p className="text-zinc-400 text-sm mt-0.5">
              {[prettyInstrument, ROLE_LABEL[role]].filter(Boolean).join(' · ')}
            </p>
            {(teams.length > 0 || preferredKey) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {teams.map(t => (
                  <span key={t} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
                    {TEAM_LABELS[t] ?? t}
                  </span>
                ))}
                {preferredKey && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-600 text-white">
                    plays in {preferredKey}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Row
            href="/auth/select-instrument"
            icon={icon('M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z')}
            title="Edit profile"
            sub="Name, instrument, preferred key, teams"
          />
          {canSeeStats && (
            <Row
              href="/stats"
              icon={icon('M9 19v-6M15 19V9M21 19V5M3 19v-2')}
              title="Stats"
              sub={isPrivileged ? 'Every worship leader' : 'Your setlists, songs and keys'}
            />
          )}
          {isPrivileged && (
            <Row
              href="/admin"
              icon={icon('M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z')}
              title="Admin"
              sub="Members and roles"
            />
          )}
        </div>

        <div className="space-y-2">
          <Row
            onClick={signOut}
            tone="danger"
            icon={<svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>}
            title={signingOut ? 'Signing out…' : 'Sign out'}
          />
        </div>

        <p className="text-center text-[11px] text-zinc-700">OnCue · worship team setlists</p>
      </div>
    </div>
  )
}

import { createClient } from '@/lib/supabase/server'
import UploadButton from '@/components/UploadButton'
import UserMenu from '@/components/UserMenu'
import ServicesClient from './ServicesClient'
import ProfileCompletionModal from '@/components/ProfileCompletionModal'
import Link from 'next/link'
import type { AppRole, AppTeam } from '@/lib/types'

export default async function ServicesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles').select('role, instrument, display_name, teams, profile_completed_at').eq('id', user!.id).single()
  const role = (profile?.role ?? 'member') as AppRole
  const isPrivileged = role === 'master' || role === 'admin'
  const canAccessLibrary = true // v6: chords are open to every member

  // One-time prompt for members who signed up before preferred-scale + teams.
  const p = profile as { instrument?: string | null; display_name?: string | null; teams?: string[]; profile_completed_at?: string | null } | null
  const needsProfilePrompt = !!p && !!p.instrument && !p.profile_completed_at

  const { data: services } = await supabase
    .from('services')
    .select('id, service_date, day_of_week, source_filename, worship_leader_id')
    .order('service_date', { ascending: false })

  // Worship leader names for the list avatars (safe public directory view)
  const leaderIds = [...new Set(
    (services ?? []).map(s => (s as { worship_leader_id?: string | null }).worship_leader_id).filter(Boolean),
  )] as string[]
  const { data: leaderProfiles } = leaderIds.length
    ? await supabase.from('public_profiles').select('id, display_name').in('id', leaderIds)
    : { data: [] as { id: string; display_name: string | null }[] }
  const leaderName = new Map((leaderProfiles ?? []).map(p => [p.id, p.display_name]))
  const leaders: Record<string, { name: string | null }> = {}
  for (const s of services ?? []) {
    const lid = (s as { worship_leader_id?: string | null }).worship_leader_id
    if (lid) leaders[s.id] = { name: leaderName.get(lid) ?? null }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-zinc-950 rounded-xl border border-purple-900/40 flex flex-col items-center justify-center gap-0.5">
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                <polygon points="4,3 13,8 4,13" fill="#9333EA" />
              </svg>
              <div className="flex gap-0.5 items-center">
                <div className="w-3.5 h-0.5 bg-purple-600 rounded-full" />
                <div className="w-2 h-0.5 bg-purple-900 rounded-full" />
              </div>
            </div>
            <h1 className="text-xl font-bold tracking-tight">OnCue</h1>
          </div>

          <div className="flex items-center gap-2.5">
            {canAccessLibrary && (
              <Link
                href="/library"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-semibold active:bg-zinc-800 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                Chords
              </Link>
            )}
            {isPrivileged && <UploadButton />}
            <UserMenu instrument={profile?.instrument ?? null} role={role} displayName={p?.display_name ?? null} />
          </div>
        </div>

        <ServicesClient
          services={services ?? []}
          isPrivileged={isPrivileged}
          canCreateSetlist={['master', 'admin', 'worship_leader'].includes(role)}
          todayStr={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())}
          leaders={leaders}
        />
      </div>

      {needsProfilePrompt && user && (
        <ProfileCompletionModal
          userId={user.id}
          instrument={p!.instrument ?? null}
          initialName={p!.display_name ?? null}
          initialTeams={(p!.teams ?? []) as AppTeam[]}
        />
      )}
    </div>
  )
}

import { createClient, getAuthUser } from '@/lib/supabase/server'
import Logo from '@/components/Logo'
import UploadButton from '@/components/UploadButton'
import ServicesClient from './ServicesClient'
import ProfileCompletionModal from '@/components/ProfileCompletionModal'
import Link from 'next/link'
import type { AppRole, AppTeam } from '@/lib/types'

export default async function ServicesPage() {
  const supabase = await createClient()

  const user = await getAuthUser(supabase)
  // Profile and the services list don't depend on each other — one round trip
  // instead of two (perf).
  const [{ data: profile }, { data: services }] = await Promise.all([
    supabase
      .from('profiles').select('role, instrument, display_name, teams, profile_completed_at').eq('id', user!.id).single(),
    supabase
      .from('services')
      .select('id, service_date, day_of_week, source_filename, worship_leader_id')
      .order('service_date', { ascending: false })
      .limit(50), // P7: ~6 months of history is plenty for the list
  ])
  const role = (profile?.role ?? 'member') as AppRole
  const isPrivileged = role === 'master' || role === 'admin'

  // One-time prompt for members who signed up before preferred-scale + teams.
  const p = profile as { instrument?: string | null; display_name?: string | null; teams?: string[]; profile_completed_at?: string | null } | null
  const needsProfilePrompt = !!p && !!p.instrument && !p.profile_completed_at

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
      <div className="max-w-lg mx-auto px-4 pt-10 pb-32">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          {/* Wordmark = home. On a service day, / jumps straight into today. */}
          <Link href="/" className="flex items-center gap-3 active:opacity-70 transition-opacity" aria-label="Home">
            <div className="w-9 h-9 bg-zinc-950 rounded-xl border border-purple-900/40 flex items-center justify-center">
              <Logo className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">OnCue</h1>
          </Link>

          {/* Chords + account moved to the bottom bar (v22). Upload stays —
              it's the one action that belongs to this page. */}
          {isPrivileged && <UploadButton />}
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

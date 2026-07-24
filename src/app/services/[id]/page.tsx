import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { canSeeChords } from '@/lib/chords/access'
import WorshipLeaderPicker from '@/components/WorshipLeaderPicker'
import { fetchServiceChords } from '@/lib/chords/service-chords'
import LeaderBadge from '@/components/LeaderBadge'
import { buildYouTubePlaylist, extractYouTubeId } from '@/lib/youtube'
import type { AppTeam } from '@/lib/types'

const DAY_GRADIENT: Record<string, string> = {
  THURSDAY: 'from-purple-900/30 to-transparent',
  SATURDAY: 'from-violet-900/20 to-transparent',
}

const DAY_BADGE: Record<string, string> = {
  THURSDAY: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SATURDAY: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
}

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: service }, { data: { user } }] = await Promise.all([
    supabase.from('services').select('id, service_date, day_of_week, instruments, worship_leader_id').eq('id', id).single(),
    supabase.auth.getUser(),
  ])

  if (!service) notFound()

  // Worship leader for this setlist — shown by their initials avatar
  const leaderId = (service as { worship_leader_id?: string | null }).worship_leader_id ?? null
  const { data: leader } = leaderId
    ? await supabase.from('public_profiles').select('display_name, instrument, teams').eq('id', leaderId).maybeSingle()
    : { data: null }

  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }

  const role = profile?.role ?? 'member'
  const canEdit = role !== 'member'

  // Leader options for the inline picker (editors only; safe columns via view)
  const { data: leaderOptions } = canEdit
    ? await supabase.from('public_profiles').select('id, display_name, role').order('display_name', { ascending: true })
    : { data: null }
  const pickerOptions = (leaderOptions ?? []).map(p => ({
    id: p.id as string,
    name: (p.display_name as string | null) || 'Unnamed member',
    isLeader: p.role === 'worship_leader',
  }))

  const date = new Date(service.service_date + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const gradient = DAY_GRADIENT[service.day_of_week] ?? 'from-zinc-900/30 to-transparent'
  const badge = DAY_BADGE[service.day_of_week] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'

  // Which songs have chords available (via confirmed link, or title match)?
  // Gated to editors until the parser rollout opens chords to everyone.
  const chordsVisible = canSeeChords(role)
  type SongRow = { id: string; order_index: number; title: string; scale: string | null; in_chart?: boolean; reference_links?: string[] }
  let songs: SongRow[] = []
  if (chordsVisible) {
    const res = await supabase
      .from('songs')
      .select('id, order_index, title, scale, in_chart, reference_links')
      .eq('service_id', id)
      .order('order_index')
    if (res.error) {
      // v5 migration (in_chart) not applied yet — degrade gracefully
      const fallback = await supabase
        .from('songs')
        .select('id, order_index, title, scale, reference_links')
        .eq('service_id', id)
        .order('order_index')
      songs = (fallback.data ?? []) as SongRow[]
    } else {
      songs = res.data ?? []
    }
  }

  // Practice playlist — anonymous YouTube queue from the songs' reference links
  const playlist = buildYouTubePlaylist(songs.flatMap(s => s.reference_links ?? []))
  const songsWithVideo = songs.filter(s => (s.reference_links ?? []).some(l => extractYouTubeId(l))).length

  // Single source of truth — the SAME resolver the chord panes use (QA #10),
  // so this list can never advertise chords a pane won't actually show.
  const { chordsBySongId } = chordsVisible && user && songs.length
    ? await fetchServiceChords(supabase, songs, user.id)
    : { chordsBySongId: {} as Record<string, unknown> }
  const songChords = songs.map(s => ({ ...s, hasChords: !!chordsBySongId[s.id] }))
  const anyChords = songChords.some(s => s.hasChords)

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24 space-y-8">

        <div>
          <Link href="/services" className="text-zinc-500 text-sm flex items-center gap-1 mb-5 active:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All services
          </Link>

          <div className={`rounded-2xl bg-gradient-to-b ${gradient} p-5 border border-zinc-800/50`}>
            <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border mb-3 ${badge}`}>
              {service.day_of_week.charAt(0) + service.day_of_week.slice(1).toLowerCase()}
            </span>
            <h1 className="text-2xl font-bold leading-tight">{dateLabel}</h1>
            <p className="text-zinc-500 text-sm mt-2">{service.instruments.join(' · ')}</p>
            {leader && (
              <div className="mt-3">
                <LeaderBadge
                  name={(leader as { display_name?: string | null }).display_name ?? null}
                  instrument={(leader as { instrument?: string | null }).instrument ?? null}
                  teams={((leader as { teams?: string[] }).teams ?? []) as AppTeam[]}
                />
              </div>
            )}
            <WorshipLeaderPicker
              serviceId={id}
              currentId={leaderId}
              options={pickerOptions}
              canEdit={canEdit}
              hasLeader={!!leader}
            />
          </div>
        </div>

        <div className="space-y-3">
          <Link
            href={`/services/${id}/my-part`}
            className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors border border-zinc-800/50"
          >
            <div className="w-11 h-11 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">My Part</p>
              <p className="text-zinc-400 text-sm">Your instrument across the whole service</p>
            </div>
            <svg className="w-4 h-4 text-zinc-600 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {canEdit && (
            <Link
              href={`/services/${id}/edit`}
              className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors border border-zinc-800/50"
            >
              <div className="w-11 h-11 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">Edit Setlist</p>
                <p className="text-zinc-400 text-sm">Reorder, rename, or add songs</p>
              </div>
              <svg className="w-4 h-4 text-zinc-600 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>

        {anyChords && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">Song chords</p>
            <div className="space-y-1.5">
              {songChords.map(s => (
                s.hasChords ? (
                  <Link
                    key={s.id}
                    href={`/services/${id}/chords/${s.id}`}
                    className="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3 active:bg-zinc-800 transition-colors border border-zinc-800/50"
                  >
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">{s.title}</span>
                    {s.in_chart === false && (
                      <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-950 text-amber-500 border border-amber-900">not in chart</span>
                    )}
                    {s.scale && (
                      <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded bg-purple-600 text-white">{s.scale}</span>
                    )}
                    <svg className="w-4 h-4 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ) : (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl px-4 py-3 border border-zinc-900">
                    <span className="flex-1 min-w-0 text-sm text-zinc-600 truncate">{s.title}</span>
                    <span className="shrink-0 text-[10px] font-semibold text-amber-500/80">needs chords</span>
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {playlist.url && (
          <a
            href={playlist.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-4 active:bg-zinc-800 transition-colors border border-zinc-800/50"
          >
            <div className="w-10 h-10 rounded-full bg-red-600/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31 31 0 000 12a31 31 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31 31 0 0024 12a31 31 0 00-.5-5.8zM9.5 15.5v-7l6.3 3.5-6.3 3.5z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white text-sm">Practice playlist</p>
              <p className="text-xs text-zinc-500">{songsWithVideo} of {songs.length} songs · opens in YouTube</p>
            </div>
            <svg className="w-4 h-4 text-zinc-600 ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}

        <a
          href={`/api/services/${id}/download`}
          className="flex items-center gap-2 text-zinc-600 text-sm py-2 active:text-zinc-400 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          Download original chart
        </a>
      </div>
    </div>
  )
}

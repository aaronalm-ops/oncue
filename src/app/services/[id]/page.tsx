import { createClient, getAuthUser } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { canSeeChords } from '@/lib/chords/access'
import WorshipLeaderPicker from '@/components/WorshipLeaderPicker'
import ShareSetlist from '@/components/ShareSetlist'
import { fetchServiceBundle } from '@/lib/service-bundle'
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

  // getAuthUser validates the JWT locally (getClaims) — auth.getUser() was a
  // round trip to Supabase Auth on every hub load. proxy.ts already gated
  // this route, so the local check is sufficient here.
  const user = await getAuthUser(supabase)

  // v20: ONE round trip for the whole hub — service, leader, picker options,
  // the viewer's role, songs and the light chord resolution (badges only).
  // This page used to make five, one after another.
  const bundle = await fetchServiceBundle(supabase, id, user!.id, { light: true })
  if (!bundle) notFound()
  const { service, leader, profile } = bundle

  const leaderId = service.worship_leader_id ?? null
  const role = profile?.role ?? 'member'
  const canEdit = role !== 'member'
  const pickerOptions = (canEdit ? bundle.leaderOptions : []).map(p => ({
    id: p.id,
    name: p.display_name || 'Unnamed member',
    // ★ marks the worship team. Role isn't readable here — profiles SELECT is
    // own-row-or-privileged, so a worship_leader would see an empty list.
    isLeader: (p.teams ?? []).includes('worship'),
  }))

  const date = new Date(service.service_date + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const gradient = DAY_GRADIENT[service.day_of_week] ?? 'from-zinc-900/30 to-transparent'
  const badge = DAY_BADGE[service.day_of_week] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'

  // Which songs have chords available (via confirmed link, or title match)?
  // Gated to editors until the parser rollout opens chords to everyone.
  const chordsVisible = canSeeChords(role)
  const songs = chordsVisible ? bundle.songs : []

  // Practice playlist — anonymous YouTube queue from the songs' reference links
  const playlist = buildYouTubePlaylist(songs.flatMap(s => s.reference_links ?? []))
  const songsWithVideo = songs.filter(s => (s.reference_links ?? []).some(l => extractYouTubeId(l))).length

  // Single source of truth — the SAME resolver the chord panes use (QA #10),
  // so this list can never advertise chords a pane won't actually show.
  const { chordsBySongId } = bundle.chords
  const songChords = songs.map(s => ({ ...s, hasChords: !!chordsBySongId[s.id] }))
  // Show the section whenever there are songs — "needs chords" rows are the
  // one-tap upload entry, most valuable when NOTHING has chords yet.
  const anyChords = songChords.length > 0

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-32 space-y-8">

        <div>
          <Link href="/services" className="inline-flex items-center gap-2 mb-5 text-zinc-500 text-sm active:text-zinc-300 transition-colors">
            <span className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </span>
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
                  name={leader.display_name}
                  instrument={leader.instrument}
                  teams={(leader.teams ?? []) as AppTeam[]}
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
          {/* Hero — the one card everyone should tap. Rich gradient + "start
              here" eyebrow; everything below stays quiet zinc so this owns
              the page without shouting. */}
          <Link
            href={`/services/${id}/my-part`}
            className="relative overflow-hidden flex items-center gap-4 rounded-2xl px-5 py-6 active:scale-[0.99] transition-transform bg-gradient-to-br from-purple-600 via-purple-700 to-purple-950 ring-1 ring-purple-500/40 shadow-lg shadow-purple-950/50"
          >
            <div aria-hidden className="pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-purple-200/90 mb-0.5">Start here</p>
              <p className="font-bold text-white text-lg leading-tight">Stage View</p>
              <p className="text-purple-200/80 text-[13px] leading-snug">Your part + chords — the whole service in one place</p>
            </div>
            <svg className="w-5 h-5 text-white/80 ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href={`/services/${id}/live`}
            className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors border border-zinc-800/50"
          >
            <div className="w-11 h-11 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse" />
            </div>
            <div>
              <p className="font-semibold text-white">Live Service</p>
              <p className="text-zinc-400 text-sm">Follow the flow together, section by section</p>
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

        <ShareSetlist
          serviceDate={service.service_date}
          dayOfWeek={service.day_of_week}
          songs={songs.map(s => ({
            id: s.id,
            title: s.title,
            scale: s.scale,
            librarySongId: chordsBySongId[s.id]?.librarySongId ?? null,
          }))}
          playlistUrl={playlist.url}
        />

        {anyChords && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">Song chords</p>
            <div className="space-y-1.5">
              {songChords.map(s => (
                s.hasChords ? (
                  <Link
                    key={s.id}
                    // Tapping a song here used to open the standalone chord
                    // sheet, a dead end — people (including the ones who built
                    // it) reach for this row when they mean Stage View. It now
                    // opens Stage View parked on this song, chords pane first,
                    // so next/prev song and the live flow are right there.
                    // Songs the chart dropped are filtered out of Stage View
                    // entirely, so those keep the standalone sheet.
                    href={s.in_chart === false
                      ? `/services/${id}/chords/${s.id}`
                      : `/services/${id}/my-part?song=${s.id}&pane=chords`}
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
                  <Link
                    key={s.id}
                    href={`/library?attachSong=${s.id}&attachService=${id}&attachTitle=${encodeURIComponent(s.title)}`}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 border border-zinc-800/70 active:bg-zinc-900 transition-colors"
                  >
                    <span className="flex-1 min-w-0 text-sm text-zinc-400 truncate">{s.title}</span>
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-amber-500">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m5 12V8m0 0l-4 4m4-4l4 4" />
                      </svg>
                      add chords
                    </span>
                  </Link>
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

        {/* Only setlists that came from (or were merged with) a conductor's
            Excel have a file to download — setlist drafts don't yet. */}
        {service.source_filename !== 'setlist-draft' ? (
          <a
            href={`/api/services/${id}/download`}
            className="flex items-center gap-2 text-zinc-600 text-sm py-2 active:text-zinc-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Download original chart
          </a>
        ) : (
          <p className="text-zinc-700 text-xs py-2">
            No conductor chart uploaded yet — the download appears once the Excel is in.
          </p>
        )}
      </div>
    </div>
  )
}

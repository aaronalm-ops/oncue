import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import ChordSheetViewer from '@/components/ChordSheetViewer'
import { effectiveSectionKeys, reorderBodyToChart } from '@/lib/chords/format'
import { canSeeChords } from '@/lib/chords/access'
import { normTitle } from '@/lib/chords/service-chords'

/**
 * A song's chords in the context of a service:
 * - sections REARRANGED to follow the conductor's chart flow
 * - opens in the user's preferred key (else the chart's scale, else as written)
 */
export default async function ServiceSongChordsPage({ params }: { params: Promise<{ id: string; songId: string }> }) {
  const { id, songId } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/auth/login')

  // Gated to editors until the parser rollout opens chords to everyone
  const { data: viewerProfile } = await supabase.from('profiles').select('role, instrument, preferred_key').eq('id', user.id).single()
  if (!canSeeChords(viewerProfile?.role)) redirect(`/services/${id}`)

  type SectionRow = { order_index: number; label: string; key_change?: string | null }
  type SongRow = { id: string; title: string; scale: string | null; service_id: string; sections: SectionRow[] }
  let song: SongRow | null = null
  {
    const res = await supabase
      .from('songs')
      .select('id, title, scale, service_id, sections(order_index, label, key_change)')
      .eq('id', songId)
      .eq('service_id', id)
      .single()
    if (res.data) song = res.data as SongRow
    else {
      // Graceful pre-v16 fallback (key_change column not migrated yet)
      const retry = await supabase
        .from('songs')
        .select('id, title, scale, service_id, sections(order_index, label)')
        .eq('id', songId)
        .eq('service_id', id)
        .single()
      song = (retry.data as SongRow | null) ?? null
    }
  }
  if (!song) notFound()

  // Resolve the library song: confirmed link first, then normalised title match
  const norm = normTitle
  const { data: link } = await supabase
    .from('song_links')
    .select('library_song_id')
    .eq('song_id', songId)
    .maybeSingle()

  let librarySongId: string | null = link?.library_song_id ?? null
  if (!librarySongId) {
    const { data: libSongs } = await supabase.from('library_songs').select('id, title')
    librarySongId = (libSongs ?? []).find(ls => norm(ls.title) === norm(song.title))?.id ?? null
  }

  // Latest reviewed version (members can only see reviewed ones anyway)
  const { data: versions } = librarySongId
    ? await supabase
        .from('song_versions')
        .select('id, stored_key, bpm, content_chordpro, reviewed_at')
        .eq('library_song_id', librarySongId)
        .not('reviewed_at', 'is', null)
        .order('reviewed_at', { ascending: false })
        .limit(1)
    : { data: null }
  const version = versions?.[0] ?? null

  if (!librarySongId || !version) {
    // W17: don't just describe the gap — hand over the one-tap attach flow
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-semibold">No reviewed chords for “{song.title}” yet.</p>
        <p className="text-sm text-zinc-500">Add them now — they link back to this service automatically.</p>
        <Link
          href={`/library?attachSong=${songId}&attachService=${id}&attachTitle=${encodeURIComponent(song.title)}`}
          className="mt-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 transition-transform"
        >
          Add chords for this song →
        </Link>
        <Link href={`/services/${id}`} className="text-purple-400 text-sm mt-1">← Back to service</Link>
      </div>
    )
  }

  // Rearrange the sheet to the conductor's flow for THIS service.
  // Mid-song key changes are baked in relative to the base key, so the
  // viewer's whole-sheet transpose keeps the modulation interval intact.
  const orderedSections = (song.sections ?? []).sort((a, b) => a.order_index - b.order_index)
  const chartLabels = orderedSections.map(s => s.label)
  const chartKeyChanges = orderedSections.map(s => s.key_change ?? null)
  const hasKeyChanges = chartKeyChanges.some(k => k !== null)
  const reordered = reorderBodyToChart(version.content_chordpro ?? '', chartLabels, {
    keyChanges: chartKeyChanges,
    storedKey: version.stored_key,
    songKey: song.scale,
  })
  // "G → A" journey for the header chip
  const journey = hasKeyChanges
    ? effectiveSectionKeys(song.scale, chartKeyChanges)
        .filter((k): k is string => !!k)
        .filter((k, i, arr) => i === 0 || arr[i - 1] !== k)
    : []

  // Preferred key: user's saved scale for this song → chart scale → as written
  const { data: pref } = await supabase
    .from('user_scale_preferences')
    .select('preferred_key')
    .eq('user_id', user.id)
    .eq('library_song_id', librarySongId)
    .maybeSingle()

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-24">
        <div className="flex items-center gap-2 mb-4">
          <Link href={`/services/${id}`}
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 active:bg-zinc-800 transition-colors"
            aria-label="Back to service">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <Link href="/"
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 active:bg-zinc-800 transition-colors"
            aria-label="Home">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">{song.title}</h1>
            <p className="text-[11px] text-zinc-500">
              Arranged to this service&rsquo;s flow
              {version.bpm ? ` · ${version.bpm} bpm` : ''}
            </p>
          </div>
          {song.scale && (
            <span className="shrink-0 text-xs font-black px-2 py-0.5 rounded-lg bg-purple-600 text-white">
              chart: {journey.length > 0 ? journey.join(' → ') : song.scale}
            </span>
          )}
          {/* Spot a wrong chord? Fix it right here — Approve brings you back
              to this exact view (returnTo), open to every member per v6. */}
          <Link
            href={`/library/${librarySongId}/version/${version.id}?returnTo=/services/${id}/chords/${songId}`}
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 active:bg-zinc-800 transition-colors"
            aria-label="Edit these chords"
            title="Edit these chords"
          >
            <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </Link>
        </div>

        {reordered.matched === 0 && (
          <p className="mb-3 text-[11px] text-amber-500/90">
            Couldn&rsquo;t match the chart&rsquo;s section names to this sheet — showing it as written.
          </p>
        )}
        {reordered.unmatched.length > 0 && reordered.matched > 0 && (
          <p className="mb-3 text-[11px] text-zinc-600">
            No chords found for: {reordered.unmatched.join(', ')}
          </p>
        )}

        <ChordSheetViewer
          body={reordered.body}
          storedKey={version.stored_key}
          initialKey={pref?.preferred_key ?? null}
          librarySongId={librarySongId}
          userId={user.id}
          instrument={(viewerProfile as { instrument?: string | null } | null)?.instrument ?? null}
          preferredKey={(viewerProfile as { preferred_key?: string | null } | null)?.preferred_key ?? null}
          actualKey={song.scale}
        />
      </div>
    </div>
  )
}

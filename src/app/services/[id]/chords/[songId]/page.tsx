import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ChordSheetViewer from '@/components/ChordSheetViewer'
import { reorderBodyToChart } from '@/lib/chords/format'

/**
 * A song's chords in the context of a service:
 * - sections REARRANGED to follow the conductor's chart flow
 * - opens in the user's preferred key (else the chart's scale, else as written)
 */
export default async function ServiceSongChordsPage({ params }: { params: Promise<{ id: string; songId: string }> }) {
  const { id, songId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: song } = await supabase
    .from('songs')
    .select('id, title, scale, service_id, sections(order_index, label)')
    .eq('id', songId)
    .eq('service_id', id)
    .single()
  if (!song) notFound()

  // Resolve the library song: confirmed link first, then normalised title match
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
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
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-semibold">No reviewed chords for “{song.title}” yet.</p>
        <p className="text-sm text-zinc-500">Upload and approve them in the Chords Library.</p>
        <Link href={`/services/${id}`} className="text-purple-400 text-sm mt-2">← Back to service</Link>
      </div>
    )
  }

  // Rearrange the sheet to the conductor's flow for THIS service
  const chartLabels = (song.sections ?? [])
    .sort((a, b) => a.order_index - b.order_index)
    .map(s => s.label)
  const reordered = reorderBodyToChart(version.content_chordpro ?? '', chartLabels)

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
              chart: {song.scale}
            </span>
          )}
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
          initialKey={pref?.preferred_key ?? song.scale}
          librarySongId={librarySongId}
          userId={user.id}
        />
      </div>
    </div>
  )
}

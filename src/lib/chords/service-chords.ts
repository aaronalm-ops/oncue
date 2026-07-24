import type { createClient } from '@/lib/supabase/server'
import { keyIndex } from '@/lib/chords/format'

/**
 * Server-side resolver: which songs in a service have reviewed chords,
 * and what key does this user prefer for each? THE single source of truth
 * for chord resolution — Live Sync, My Part, and the service page all call
 * this so they can never advertise chords a pane won't show (QA #10).
 */

/** Normalise a song title for fuzzy library matching. Exported so every
 *  resolution path uses identical matching. */
export const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export interface SongChordsData {
  librarySongId: string
  storedKey: string | null
  body: string
  /** manual chart→chord section maps (chart label normalized → chord section label) */
  sectionMaps: Record<string, string>
  /** song memory: canonical tempo on library_songs (v14), editable from My Part */
  tempoBpm: number | null
}

export interface ServiceChords {
  chordsBySongId: Record<string, SongChordsData>
  prefsByLibraryId: Record<string, string>
}

export async function fetchServiceChords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  songs: Array<{ id: string; title: string; scale?: string | null }>,
  userId: string,
): Promise<ServiceChords> {
  const norm = normTitle
  const empty: ServiceChords = { chordsBySongId: {}, prefsByLibraryId: {} }
  if (songs.length === 0) return empty

  const songIds = songs.map(s => s.id)
  const [{ data: links }, libRes] = await Promise.all([
    supabase.from('song_links').select('song_id, library_song_id').in('song_id', songIds),
    supabase.from('library_songs').select('id, title, tempo_bpm'),
  ])
  // v14 migration (tempo_bpm) not applied yet? Degrade gracefully.
  const librarySongs: Array<{ id: string; title: string; tempo_bpm?: number | null }> =
    libRes.error
      ? (await supabase.from('library_songs').select('id, title')).data ?? []
      : libRes.data ?? []

  const linkMap = new Map((links ?? []).map(l => [l.song_id, l.library_song_id]))
  const byTitle = new Map(librarySongs.map(ls => [norm(ls.title), ls.id]))
  const tempoByLib = new Map(librarySongs.map(ls => [ls.id, ls.tempo_bpm ?? null]))

  // Resolve each service song to a library song (confirmed link wins)
  const songToLib = new Map<string, string>()
  for (const s of songs) {
    const lib = linkMap.get(s.id) ?? byTitle.get(norm(s.title))
    if (lib) songToLib.set(s.id, lib)
  }
  const libIds = [...new Set(songToLib.values())]
  if (libIds.length === 0) return empty

  // Latest reviewed version per library song (RLS hides unreviewed from members anyway)
  const { data: versions } = await supabase
    .from('song_versions')
    .select('library_song_id, stored_key, content_chordpro, reviewed_at')
    .in('library_song_id', libIds)
    .not('reviewed_at', 'is', null)
    .order('reviewed_at', { ascending: false })

  // All reviewed versions per library song, newest first (query is ordered).
  const versionsByLib = new Map<string, Array<{ stored_key: string | null; content_chordpro: string | null }>>()
  for (const v of versions ?? []) {
    const arr = versionsByLib.get(v.library_song_id) ?? []
    arr.push(v)
    versionsByLib.set(v.library_song_id, arr)
  }

  const [{ data: prefs }, { data: maps }] = await Promise.all([
    supabase
      .from('user_scale_preferences')
      .select('library_song_id, preferred_key')
      .eq('user_id', userId)
      .in('library_song_id', libIds),
    supabase
      .from('chord_section_maps')
      .select('library_song_id, chart_label_normalized, chord_section_label')
      .in('library_song_id', libIds),
  ])

  const mapsByLib = new Map<string, Record<string, string>>()
  for (const m of maps ?? []) {
    const rec = mapsByLib.get(m.library_song_id) ?? {}
    rec[m.chart_label_normalized] = m.chord_section_label
    mapsByLib.set(m.library_song_id, rec)
  }

  const chordsBySongId: Record<string, SongChordsData> = {}
  for (const [songId, libId] of songToLib) {
    const cands = versionsByLib.get(libId) ?? []
    if (cands.length === 0) continue
    // #12 arrangement match: prefer a reviewed version written in the chart's
    // key over merely the newest one, so multi-key songs pick the right sheet.
    const scale = songs.find(s => s.id === songId)?.scale ?? null
    const scaleIdx = scale ? keyIndex(scale) : null
    const chosen =
      (scaleIdx !== null
        ? cands.find(c => c.stored_key && keyIndex(c.stored_key) === scaleIdx)
        : undefined) ?? cands[0]
    if (chosen?.content_chordpro) {
      chordsBySongId[songId] = {
        librarySongId: libId,
        storedKey: chosen.stored_key,
        body: chosen.content_chordpro,
        sectionMaps: mapsByLib.get(libId) ?? {},
        tempoBpm: tempoByLib.get(libId) ?? null,
      }
    }
  }

  return {
    chordsBySongId,
    prefsByLibraryId: Object.fromEntries((prefs ?? []).map(p => [p.library_song_id, p.preferred_key])),
  }
}

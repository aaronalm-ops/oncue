import type { createClient } from '@/lib/supabase/server'

/**
 * Server-side resolver: which songs in a service have reviewed chords,
 * and what key does this user prefer for each? Shared by Live Sync and
 * My Part so the combined chart+chords panes stay consistent.
 */

export interface SongChordsData {
  librarySongId: string
  storedKey: string | null
  body: string
  /** manual chart→chord section maps (chart label normalized → chord section label) */
  sectionMaps: Record<string, string>
}

export interface ServiceChords {
  chordsBySongId: Record<string, SongChordsData>
  prefsByLibraryId: Record<string, string>
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export async function fetchServiceChords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  songs: Array<{ id: string; title: string }>,
  userId: string,
): Promise<ServiceChords> {
  const empty: ServiceChords = { chordsBySongId: {}, prefsByLibraryId: {} }
  if (songs.length === 0) return empty

  const songIds = songs.map(s => s.id)
  const [{ data: links }, { data: librarySongs }] = await Promise.all([
    supabase.from('song_links').select('song_id, library_song_id').in('song_id', songIds),
    supabase.from('library_songs').select('id, title'),
  ])

  const linkMap = new Map((links ?? []).map(l => [l.song_id, l.library_song_id]))
  const byTitle = new Map((librarySongs ?? []).map(ls => [norm(ls.title), ls.id]))

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

  const latestByLib = new Map<string, { stored_key: string | null; content_chordpro: string | null }>()
  for (const v of versions ?? []) {
    if (!latestByLib.has(v.library_song_id)) latestByLib.set(v.library_song_id, v)
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
    const v = latestByLib.get(libId)
    if (v?.content_chordpro) {
      chordsBySongId[songId] = {
        librarySongId: libId,
        storedKey: v.stored_key,
        body: v.content_chordpro,
        sectionMaps: mapsByLib.get(libId) ?? {},
      }
    }
  }

  return {
    chordsBySongId,
    prefsByLibraryId: Object.fromEntries((prefs ?? []).map(p => [p.library_song_id, p.preferred_key])),
  }
}

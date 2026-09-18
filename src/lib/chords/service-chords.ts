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

/** A song's library identity + canonical tempo, INDEPENDENT of chord sheets. */
export interface SongTempoData {
  librarySongId: string
  tempoBpm: number | null
}

export interface ServiceChords {
  chordsBySongId: Record<string, SongChordsData>
  prefsByLibraryId: Record<string, string>
  /**
   * Every song that resolves to a library song, whether or not a reviewed
   * chord sheet exists. Tempo is a property of the SONG; chord sheets are a
   * separate thing that may never arrive. Gating BPM on chordsBySongId meant a
   * brand-new song in a setlist — exactly the one you set the tempo for in
   * rehearsal — had no tempo chip and therefore no beat pulse.
   */
  tempoBySongId: Record<string, SongTempoData>
}

export async function fetchServiceChords(
  supabase: Awaited<ReturnType<typeof createClient>>,
  songs: Array<{ id: string; title: string; scale?: string | null }>,
  userId: string,
  options?: { light?: boolean }, // light: existence/keys only — no chord bodies, prefs or maps (fast badges)
): Promise<ServiceChords> {
  const light = options?.light === true
  const norm = normTitle
  const empty: ServiceChords = { chordsBySongId: {}, prefsByLibraryId: {}, tempoBySongId: {} }
  if (songs.length === 0) return empty

  const songIds = songs.map(s => s.id)
  // P5: filter the library by pre-normalised title (v17 norm_title column,
  // indexed) instead of scanning the whole table on every render.
  const normTitles = [...new Set(songs.map(s => norm(s.title)))]
  const [{ data: links }, libRes] = await Promise.all([
    supabase.from('song_links').select('song_id, library_song_id').in('song_id', songIds),
    supabase.from('library_songs').select('id, title, tempo_bpm').in('norm_title', normTitles),
  ])

  let librarySongs: Array<{ id: string; title: string; tempo_bpm?: number | null }> = []
  if (libRes.error) {
    // Pre-v17 (no norm_title) — degrade to the old full scan; pre-v14 inside that.
    const full = await supabase.from('library_songs').select('id, title, tempo_bpm')
    librarySongs = full.error
      ? (await supabase.from('library_songs').select('id, title')).data ?? []
      : full.data ?? []
  } else {
    librarySongs = libRes.data ?? []
    // Confirmed links can point at songs whose titles no longer match (renames)
    // — fetch just those stragglers. Usually zero, so usually skipped.
    const have = new Set(librarySongs.map(l => l.id))
    const missing = [...new Set((links ?? []).map(l => l.library_song_id))].filter(lid => !have.has(lid))
    if (missing.length > 0) {
      const { data: extra } = await supabase.from('library_songs').select('id, title, tempo_bpm').in('id', missing)
      librarySongs = librarySongs.concat(extra ?? [])
    }
  }

  // Which library songs matter? (same link-wins rule as the resolver)
  const linkMap = new Map((links ?? []).map(l => [l.song_id, l.library_song_id]))
  const byTitle = new Map<string, string>()
  for (const ls of librarySongs) {
    const k = norm(ls.title)
    if (!byTitle.has(k)) byTitle.set(k, ls.id)
  }
  const libIds = [...new Set(songs.map(s => linkMap.get(s.id) ?? byTitle.get(norm(s.title))).filter(Boolean))] as string[]
  if (libIds.length === 0) {
    // No sheets to look for — but resolve anyway so tempo rows come through.
    return resolveServiceChords(songs, { links: links ?? [], librarySongs, versions: [], prefs: [], maps: [] }, { light })
  }

  // Latest reviewed version per library song (RLS hides unreviewed from members
  // anyway). In light mode we skip the (potentially large) chord bodies —
  // existence + key is all the badges need.
  const { data: versions } = light
    ? await supabase
        .from('song_versions')
        .select('library_song_id, stored_key, reviewed_at')
        .in('library_song_id', libIds)
        .not('reviewed_at', 'is', null)
        .not('content_chordpro', 'is', null)
        .order('reviewed_at', { ascending: false })
    : await supabase
        .from('song_versions')
        .select('library_song_id, stored_key, content_chordpro, reviewed_at')
        .in('library_song_id', libIds)
        .not('reviewed_at', 'is', null)
        .not('content_chordpro', 'is', null)
        .order('reviewed_at', { ascending: false })

  const [{ data: prefs }, { data: maps }] = light ? [{ data: null }, { data: null }] : await Promise.all([
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

  return resolveServiceChords(songs, {
    links: links ?? [],
    librarySongs,
    versions: (versions ?? []) as VersionRow[],
    prefs: prefs ?? [],
    maps: maps ?? [],
  }, { light })
}

/** Raw rows the resolver needs — from four queries (fetchServiceChords) or
 *  from one service_bundle() RPC (src/lib/service-bundle.ts). */
export interface ChordResolutionRows {
  links: Array<{ song_id: string; library_song_id: string }>
  librarySongs: Array<{ id: string; title: string; tempo_bpm?: number | null }>
  /** reviewed versions, NEWEST FIRST (both sources order by reviewed_at desc) */
  versions: VersionRow[]
  prefs: Array<{ library_song_id: string; preferred_key: string }>
  maps: Array<{ library_song_id: string; chart_label_normalized: string; chord_section_label: string }>
}
export type VersionRow = { library_song_id: string; stored_key: string | null; content_chordpro?: string | null }

/**
 * Pure resolution — no I/O. Identical logic whichever way the rows arrived,
 * which is the whole point: the bundle path can never disagree with the
 * query path about which song has chords.
 */
export function resolveServiceChords(
  songs: Array<{ id: string; title: string; scale?: string | null }>,
  rows: ChordResolutionRows,
  options?: { light?: boolean },
): ServiceChords {
  const light = options?.light === true
  const norm = normTitle
  const empty: ServiceChords = { chordsBySongId: {}, prefsByLibraryId: {}, tempoBySongId: {} }
  const { links, librarySongs, versions, prefs, maps } = rows

  const linkMap = new Map(links.map(l => [l.song_id, l.library_song_id]))
  // First row wins on a duplicate title — the same row ingest picks (oldest).
  const byTitle = new Map<string, string>()
  for (const ls of librarySongs) {
    const k = norm(ls.title)
    if (!byTitle.has(k)) byTitle.set(k, ls.id)
  }
  const tempoByLib = new Map(librarySongs.map(ls => [ls.id, ls.tempo_bpm ?? null]))

  // Resolve each service song to a library song (confirmed link wins)
  const songToLib = new Map<string, string>()
  for (const s of songs) {
    const lib = linkMap.get(s.id) ?? byTitle.get(norm(s.title))
    if (lib) songToLib.set(s.id, lib)
  }
  // Built from songToLib BEFORE any version filtering — this is the whole
  // point: a song with a library row but no reviewed sheet still has a tempo.
  const tempoBySongId: Record<string, SongTempoData> = {}
  for (const [songId, libId] of songToLib) {
    tempoBySongId[songId] = { librarySongId: libId, tempoBpm: tempoByLib.get(libId) ?? null }
  }
  if (songToLib.size === 0) return empty

  // All reviewed versions per library song, newest first (input is ordered).
  const versionsByLib = new Map<string, VersionRow[]>()
  for (const v of versions) {
    const arr = versionsByLib.get(v.library_song_id) ?? []
    arr.push(v)
    versionsByLib.set(v.library_song_id, arr)
  }

  const mapsByLib = new Map<string, Record<string, string>>()
  for (const m of maps) {
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
    if (light ? !!chosen : !!chosen?.content_chordpro) {
      chordsBySongId[songId] = {
        librarySongId: libId,
        storedKey: chosen.stored_key,
        body: chosen.content_chordpro ?? '',
        sectionMaps: mapsByLib.get(libId) ?? {},
        tempoBpm: tempoByLib.get(libId) ?? null,
      }
    }
  }

  return {
    chordsBySongId,
    prefsByLibraryId: Object.fromEntries(prefs.map(p => [p.library_song_id, p.preferred_key])),
    tempoBySongId,
  }
}

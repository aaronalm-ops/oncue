import type { createClient } from '@/lib/supabase/server'
import { canSeeChords } from '@/lib/chords/access'
import {
  fetchServiceChords,
  resolveServiceChords,
  type ServiceChords,
  type VersionRow,
} from '@/lib/chords/service-chords'

/**
 * ONE round trip per service page (v20).
 *
 * The hub, Stage View and Live all need the same things: the service, its
 * songs → sections → instructions, the viewer's profile, their notes, the
 * chord-resolution rows, live session state. Fetching those as separate
 * queries meant 4–5 sequential hops to Postgres before the first byte left
 * the Vercel function. service_bundle() returns all of it as one jsonb.
 *
 * If the RPC isn't there yet (v20 not applied) this falls back to the
 * original multi-query path, so deploying code before SQL only costs speed,
 * never correctness.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>

export interface BundleInstruction { id: string; instrument: string; text: string; is_intro: boolean }
export interface BundleSection {
  id: string
  order_index: number
  label: string
  comments: string
  key_change: string | null
  instructions: BundleInstruction[]
}
export interface BundleSong {
  id: string
  order_index: number
  title: string
  scale: string | null
  medley_group: string | null
  reference_links: string[]
  in_chart: boolean
  sections: BundleSection[]
}
export interface NoteRow { id: string; section_id: string | null; song_id: string | null; instrument: string; note_text: string }
export interface BundleSessionState {
  current_song_index: number
  current_section_index: number
  impromptu_library_song_id: string | null
  impromptu_key: string | null
}
export interface BundleImpromptu {
  library_song_id: string
  title: string
  stored_key: string | null
  body: string | null
}
export interface BundleDirectoryProfile { id: string; display_name: string | null; teams: string[] }

export interface ServiceBundle {
  service: {
    id: string
    service_date: string
    day_of_week: string
    instruments: string[]
    worship_leader_id: string | null
    source_filename: string
  }
  profile: { role: string | null; instrument: string | null; preferred_key: string | null } | null
  leader: { display_name: string | null; instrument: string | null; teams: string[] } | null
  leaderOptions: BundleDirectoryProfile[]
  /** EVERY song incl. chart-dropped ones (in_chart=false); sections sorted, instructions defaulted */
  songs: BundleSong[]
  sessionState: BundleSessionState | null
  impromptu: BundleImpromptu | null
  /** the viewer's notes on this service — section-level AND song-level (v19) */
  notes: NoteRow[]
  /** resolved with the same resolver the query path uses (QA #10) */
  chords: ServiceChords
}

const EMPTY_CHORDS: ServiceChords = { chordsBySongId: {}, prefsByLibraryId: {}, tempoBySongId: {} }

/** Sections sorted by order, instructions never undefined — what every client expects. */
function normaliseSongs(raw: unknown[]): BundleSong[] {
  return (raw as Array<Partial<BundleSong>>).map(s => ({
    id: s.id as string,
    order_index: s.order_index ?? 0,
    title: s.title ?? '',
    scale: s.scale ?? null,
    medley_group: s.medley_group ?? null,
    reference_links: s.reference_links ?? [],
    in_chart: s.in_chart !== false,
    sections: [...(s.sections ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map(sec => ({
        id: sec.id,
        order_index: sec.order_index,
        label: sec.label,
        comments: sec.comments ?? '',
        key_change: sec.key_change ?? null,
        instructions: sec.instructions ?? [],
      })),
  }))
}

export async function fetchServiceBundle(
  supabase: Supabase,
  serviceId: string,
  userId: string,
  options?: { light?: boolean },
): Promise<ServiceBundle | null> {
  const light = options?.light === true

  const rpc = await supabase.rpc('service_bundle', { p_service_id: serviceId, p_light: light })
  if (rpc.error) {
    // Function missing (pre-v20) or unexpected — take the slow road, same result.
    return fetchServiceBundleLegacy(supabase, serviceId, userId, { light })
  }
  if (!rpc.data) return null // no such service (or not visible)

  const b = rpc.data as Record<string, unknown>
  const songs = normaliseSongs((b.songs as unknown[]) ?? [])
  const profile = (b.profile as ServiceBundle['profile']) ?? null

  const chords = canSeeChords(profile?.role)
    ? resolveServiceChords(songs, {
        links: (b.links as { song_id: string; library_song_id: string }[]) ?? [],
        librarySongs: (b.library_songs as { id: string; title: string; tempo_bpm?: number | null }[]) ?? [],
        versions: (b.versions as VersionRow[]) ?? [],
        prefs: (b.prefs as { library_song_id: string; preferred_key: string }[]) ?? [],
        maps: (b.maps as { library_song_id: string; chart_label_normalized: string; chord_section_label: string }[]) ?? [],
      }, { light })
    : EMPTY_CHORDS

  return {
    service: b.service as ServiceBundle['service'],
    profile,
    leader: (b.leader as ServiceBundle['leader']) ?? null,
    leaderOptions: (b.leader_options as BundleDirectoryProfile[]) ?? [],
    songs,
    sessionState: (b.session_state as BundleSessionState | null) ?? null,
    impromptu: (b.impromptu as BundleImpromptu | null) ?? null,
    notes: (b.notes as NoteRow[]) ?? [],
    chords,
  }
}

/** The pre-v20 path: the same queries the three pages used to run inline. */
async function fetchServiceBundleLegacy(
  supabase: Supabase,
  serviceId: string,
  userId: string,
  options: { light: boolean },
): Promise<ServiceBundle | null> {
  const SONG_SELECT = `
    id, order_index, title, scale, medley_group, reference_links, in_chart,
    sections (
      id, order_index, label, comments, key_change,
      instructions ( id, instrument, text, is_intro )
    )
  `
  const [{ data: profile }, { data: service }, songsRes, { data: sessionState }, { data: leaderOptions }] = await Promise.all([
    supabase.from('profiles').select('role, instrument, preferred_key').eq('id', userId).single(),
    supabase.from('services').select('id, service_date, day_of_week, instruments, worship_leader_id, source_filename').eq('id', serviceId).single(),
    supabase.from('songs').select(SONG_SELECT).eq('service_id', serviceId).order('order_index'),
    supabase.from('session_state').select('*').eq('service_id', serviceId).single(),
    supabase.from('public_profiles').select('id, display_name, teams').order('display_name', { ascending: true }),
  ])
  if (!service) return null

  // v5 migration (in_chart) not applied yet? Degrade gracefully.
  const rawSongs = songsRes.error
    ? (await supabase
        .from('songs')
        .select(`
          id, order_index, title, scale, medley_group, reference_links,
          sections (
            id, order_index, label, comments,
            instructions ( id, instrument, text, is_intro )
          )
        `)
        .eq('service_id', serviceId)
        .order('order_index')).data?.map(s => ({ ...s, in_chart: true })) ?? []
    : songsRes.data ?? []
  const songs = normaliseSongs(rawSongs)

  const leaderId = (service as { worship_leader_id?: string | null }).worship_leader_id ?? null
  const sectionIds = songs.flatMap(s => s.sections.map(sec => sec.id))
  const songIds = songs.map(s => s.id)
  const emptyNotes = Promise.resolve({ data: [] as NoteRow[] })
  const impromptuLibId = (sessionState as { impromptu_library_song_id?: string | null } | null)?.impromptu_library_song_id ?? null

  const [{ data: leader }, { data: sectionNotes }, { data: songNotes }, chords, impromptuParts] = await Promise.all([
    leaderId
      ? supabase.from('public_profiles').select('display_name, instrument, teams').eq('id', leaderId).maybeSingle()
      : Promise.resolve({ data: null }),
    sectionIds.length
      ? supabase.from('user_notes').select('id, section_id, song_id, instrument, note_text').eq('user_id', userId).in('section_id', sectionIds)
      : emptyNotes,
    songIds.length
      ? supabase.from('user_notes').select('id, section_id, song_id, instrument, note_text').eq('user_id', userId).in('song_id', songIds)
      : emptyNotes,
    canSeeChords(profile?.role)
      ? fetchServiceChords(supabase, songs, userId, { light: options.light })
      : Promise.resolve(EMPTY_CHORDS),
    impromptuLibId && !options.light
      ? Promise.all([
          supabase.from('library_songs').select('title').eq('id', impromptuLibId).single(),
          supabase.from('song_versions').select('stored_key, content_chordpro').eq('library_song_id', impromptuLibId)
            .not('reviewed_at', 'is', null).order('reviewed_at', { ascending: false }).limit(1),
        ])
      : Promise.resolve(null),
  ])

  let impromptu: BundleImpromptu | null = null
  if (impromptuLibId && impromptuParts) {
    const [{ data: libSong }, { data: vers }] = impromptuParts
    const v = vers?.[0]
    if (libSong) impromptu = { library_song_id: impromptuLibId, title: libSong.title, stored_key: v?.stored_key ?? null, body: v?.content_chordpro ?? null }
  }

  return {
    service: service as ServiceBundle['service'],
    profile: (profile as ServiceBundle['profile']) ?? null,
    leader: (leader as ServiceBundle['leader']) ?? null,
    leaderOptions: (leaderOptions ?? []) as BundleDirectoryProfile[],
    songs,
    sessionState: (sessionState as BundleSessionState | null) ?? null,
    impromptu,
    notes: [...((sectionNotes ?? []) as NoteRow[]), ...((songNotes ?? []) as NoteRow[])],
    chords,
  }
}

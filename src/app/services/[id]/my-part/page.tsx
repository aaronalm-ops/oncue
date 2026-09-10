import { createClient, getAuthUser } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import MyPartClient from './MyPartClient'
import { fetchServiceChords } from '@/lib/chords/service-chords'
import { canSeeChords } from '@/lib/chords/access'

export default async function MyPartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const supabase = await createClient()

  const user = await getAuthUser(supabase) // local JWT validation (P1)

  // P2: profile, service, and songs are independent — one parallel stage
  const [{ data: profile }, { data: service }, songsRes] = await Promise.all([
    supabase.from('profiles').select('instrument, role, preferred_key').eq('id', user!.id).single(),
    supabase.from('services').select('id, service_date, day_of_week, instruments').eq('id', id).single(),
    supabase
      .from('songs')
      .select(`
        id, order_index, title, scale, medley_group, reference_links, in_chart,
        sections (
          id, order_index, label, comments, key_change,
          instructions ( id, instrument, text, is_intro )
        )
      `)
      .eq('service_id', id)
      .order('order_index'),
  ])
  if (!service) notFound()

  // v5 migration (in_chart) not applied yet? Degrade gracefully.
  const songs = songsRes.error
    ? (await supabase
        .from('songs')
        .select(`
          id, order_index, title, scale, medley_group, reference_links,
          sections (
            id, order_index, label, comments,
            instructions ( id, instrument, text, is_intro )
          )
        `)
        .eq('service_id', id)
        .order('order_index')).data?.map(s => ({ ...s, in_chart: true })) ?? null
    : songsRes.data

  // The chart directs the flow — songs dropped by the chart stay out of My Part
  const sortedSongs = (songs ?? []).filter(s => s.in_chart !== false).map(song => ({
    ...song,
    sections: (song.sections ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map(section => ({
        ...section,
        instructions: section.instructions ?? [],
      })),
  }))

  // P2: personal notes and the chords resolver are independent — stage two.
  // Two note queries, not one .or(): they run inside the same Promise.all so
  // it costs no extra wall clock, and a hand-built or() filter over two UUID
  // lists is the kind of string nobody can safely edit later.
  const sectionIds = sortedSongs.flatMap(s => s.sections.map(sec => sec.id))
  const songIds = sortedSongs.map(s => s.id)
  type NoteRow = { id: string; section_id: string | null; song_id: string | null; instrument: string; note_text: string }
  const emptyNotes = Promise.resolve({ data: [] as NoteRow[] })
  const [{ data: sectionNotes }, { data: songNotes }, chords] = await Promise.all([
    sectionIds.length
      ? supabase
          .from('user_notes')
          .select('id, section_id, song_id, instrument, note_text')
          .eq('user_id', user!.id)
          .in('section_id', sectionIds)
      : emptyNotes,
    // v19: notes that belong to the whole song rather than one section — the
    // only place to put anything on a song the chart hasn't sectioned yet.
    songIds.length
      ? supabase
          .from('user_notes')
          .select('id, section_id, song_id, instrument, note_text')
          .eq('user_id', user!.id)
          .in('song_id', songIds)
      : emptyNotes,
    // NOTE: tempo currently rides along with the chords gate. With
    // CHORDS_OPEN_TO_ALL that is moot; if it is ever flipped off, members would
    // lose the beat pulse too, which would be wrong — tempo isn't chords.
    canSeeChords(profile?.role)
      ? fetchServiceChords(supabase, sortedSongs, user!.id)
      : Promise.resolve({ chordsBySongId: {}, prefsByLibraryId: {}, tempoBySongId: {} }),
  ])

  // Validate user's preferred instrument against what this service actually has
  const profileInstrument = profile?.instrument ?? null
  const validatedInstrument = profileInstrument && service.instruments.includes(profileInstrument)
    ? profileInstrument
    : (service.instruments[0] ?? null)

  const isEditor = true // v6: any member can map sections

  // Deep link from the service page's song list: ?song=<songs.id>&pane=chords.
  // Resolved here rather than client-side so the right song is in the first
  // paint — no flash of song 1. An id that isn't in this chart (a song the
  // chart dropped, so it was filtered out of sortedSongs above) falls back to
  // the first song rather than erroring.
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  const wantedSongId = one(sp.song)
  const foundIdx = wantedSongId ? sortedSongs.findIndex(s => s.id === wantedSongId) : -1
  const initialSongIdx = foundIdx >= 0 ? foundIdx : 0
  const initialPane = one(sp.pane) === 'chords' ? 'chords' : 'part'

  return (
    <MyPartClient
      serviceId={id}
      songs={sortedSongs}
      initialSongIdx={initialSongIdx}
      initialPane={initialPane}
      instruments={service.instruments}
      userInstrument={validatedInstrument}
      userId={user!.id}
      initialNotes={(sectionNotes ?? []) as NoteRow[]}
      initialSongNotes={(songNotes ?? []) as NoteRow[]}
      chordsBySongId={chords.chordsBySongId}
      tempoBySongId={chords.tempoBySongId}
      prefsByLibraryId={chords.prefsByLibraryId}
      canMapSections={isEditor}
      preferredKey={(profile as { preferred_key?: string | null } | null)?.preferred_key ?? null}
    />
  )
}

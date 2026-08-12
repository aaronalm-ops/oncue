import { createClient, getAuthUser } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import MyPartClient from './MyPartClient'
import { fetchServiceChords } from '@/lib/chords/service-chords'
import { canSeeChords } from '@/lib/chords/access'

export default async function MyPartPage({ params }: { params: Promise<{ id: string }> }) {
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

  // P2: personal notes and the chords resolver are independent — stage two
  const sectionIds = sortedSongs.flatMap(s => s.sections.map(sec => sec.id))
  const [{ data: notes }, chords] = await Promise.all([
    sectionIds.length
      ? supabase
          .from('user_notes')
          .select('id, section_id, instrument, note_text')
          .eq('user_id', user!.id)
          .in('section_id', sectionIds)
      : Promise.resolve({ data: [] as { id: string; section_id: string; instrument: string; note_text: string }[] }),
    canSeeChords(profile?.role)
      ? fetchServiceChords(supabase, sortedSongs, user!.id)
      : Promise.resolve({ chordsBySongId: {}, prefsByLibraryId: {} }),
  ])

  // Validate user's preferred instrument against what this service actually has
  const profileInstrument = profile?.instrument ?? null
  const validatedInstrument = profileInstrument && service.instruments.includes(profileInstrument)
    ? profileInstrument
    : (service.instruments[0] ?? null)

  const isEditor = true // v6: any member can map sections

  return (
    <MyPartClient
      serviceId={id}
      songs={sortedSongs}
      instruments={service.instruments}
      userInstrument={validatedInstrument}
      userId={user!.id}
      initialNotes={notes ?? []}
      chordsBySongId={chords.chordsBySongId}
      prefsByLibraryId={chords.prefsByLibraryId}
      canMapSections={isEditor}
      preferredKey={(profile as { preferred_key?: string | null } | null)?.preferred_key ?? null}
    />
  )
}

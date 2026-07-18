import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import MyPartClient from './MyPartClient'
import { fetchServiceChords } from '@/lib/chords/service-chords'
import { canSeeChords } from '@/lib/chords/access'

export default async function MyPartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('instrument, role')
    .eq('id', user!.id)
    .single()

  const { data: service } = await supabase
    .from('services')
    .select('id, service_date, day_of_week, instruments')
    .eq('id', id)
    .single()
  if (!service) notFound()

  const { data: songs } = await supabase
    .from('songs')
    .select(`
      id, order_index, title, scale, medley_group, reference_links,
      sections (
        id, order_index, label, comments,
        instructions ( id, instrument, text, is_intro )
      )
    `)
    .eq('service_id', id)
    .order('order_index')

  const sortedSongs = (songs ?? []).map(song => ({
    ...song,
    sections: (song.sections ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map(section => ({
        ...section,
        instructions: section.instructions ?? [],
      })),
  }))

  const sectionIds = sortedSongs.flatMap(s => s.sections.map(sec => sec.id))
  const { data: notes } = sectionIds.length
    ? await supabase
        .from('user_notes')
        .select('id, section_id, instrument, note_text')
        .eq('user_id', user!.id)
        .in('section_id', sectionIds)
    : { data: [] }

  // Validate user's preferred instrument against what this service actually has
  const profileInstrument = profile?.instrument ?? null
  const validatedInstrument = profileInstrument && service.instruments.includes(profileInstrument)
    ? profileInstrument
    : (service.instruments[0] ?? null)

  // Chords pane data — gated to editors until the parser rollout opens
  const chords = canSeeChords(profile?.role)
    ? await fetchServiceChords(supabase, sortedSongs, user!.id)
    : { chordsBySongId: {}, prefsByLibraryId: {} }

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
    />
  )
}

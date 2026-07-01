import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import LiveSyncClient from './LiveSyncClient'

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('instrument')
    .eq('id', user!.id)
    .single()

  // Fetch full service data
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

  // Sort sections and instructions
  const sortedSongs = (songs ?? []).map(song => ({
    ...song,
    sections: (song.sections ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map(section => ({
        ...section,
        instructions: (section.instructions ?? []),
      })),
  }))

  const { data: sessionState } = await supabase
    .from('session_state')
    .select('*')
    .eq('service_id', id)
    .single()

  return (
    <LiveSyncClient
      serviceId={id}
      songs={sortedSongs}
      instruments={service.instruments}
      userInstrument={profile?.instrument ?? null}
      initialSongIndex={sessionState?.current_song_index ?? 0}
      initialSectionIndex={sessionState?.current_section_index ?? 0}
    />
  )
}

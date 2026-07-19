import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import LiveSyncClient from './LiveSyncClient'
import { fetchServiceChords } from '@/lib/chords/service-chords'
import { canSeeChords } from '@/lib/chords/access'

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
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

  const songsRes = await supabase
    .from('songs')
    .select(`
      id, order_index, title, scale, medley_group, reference_links, in_chart,
      sections (
        id, order_index, label, comments,
        instructions ( id, instrument, text, is_intro )
      )
    `)
    .eq('service_id', id)
    .order('order_index')

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

  // The chart directs the live flow — songs dropped by the chart stay out of Live Sync
  const sortedSongs = (songs ?? []).filter(s => s.in_chart !== false).map(song => ({
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

  // Impromptu live share: if a library song is being shared right now,
  // resolve its latest reviewed version for the initial render.
  let initialImpromptu: {
    librarySongId: string
    title: string
    storedKey: string | null
    body: string
    sharedKey: string | null
  } | null = null
  const impromptuLibId = (sessionState as { impromptu_library_song_id?: string | null } | null)?.impromptu_library_song_id ?? null
  if (impromptuLibId) {
    const [{ data: libSong }, { data: impVersions }] = await Promise.all([
      supabase.from('library_songs').select('title').eq('id', impromptuLibId).single(),
      supabase
        .from('song_versions')
        .select('stored_key, content_chordpro')
        .eq('library_song_id', impromptuLibId)
        .not('reviewed_at', 'is', null)
        .order('reviewed_at', { ascending: false })
        .limit(1),
    ])
    const v = impVersions?.[0]
    if (libSong && v?.content_chordpro) {
      initialImpromptu = {
        librarySongId: impromptuLibId,
        title: libSong.title,
        storedKey: v.stored_key,
        body: v.content_chordpro,
        sharedKey: (sessionState as { impromptu_key?: string | null } | null)?.impromptu_key ?? null,
      }
    }
  }

  // Validate user's preferred instrument against what this service actually has
  const profileInstrument = profile?.instrument ?? null
  const validatedInstrument = profileInstrument && service.instruments.includes(profileInstrument)
    ? profileInstrument
    : (service.instruments[0] ?? null)

  // Chords pane data — gated to editors until the parser rollout opens
  const chords = canSeeChords(profile?.role)
    ? await fetchServiceChords(supabase, sortedSongs, user!.id)
    : { chordsBySongId: {}, prefsByLibraryId: {} }

  const isEditor = true // v6: any member can map sections

  return (
    <LiveSyncClient
      serviceId={id}
      userId={user!.id}
      songs={sortedSongs}
      instruments={service.instruments}
      userInstrument={validatedInstrument}
      initialSongIndex={sessionState?.current_song_index ?? 0}
      initialSectionIndex={sessionState?.current_section_index ?? 0}
      chordsBySongId={chords.chordsBySongId}
      prefsByLibraryId={chords.prefsByLibraryId}
      canMapSections={isEditor}
      initialImpromptu={initialImpromptu}
    />
  )
}

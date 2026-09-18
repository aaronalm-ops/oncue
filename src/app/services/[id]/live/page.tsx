import { createClient, getAuthUser } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import LiveSyncClient from './LiveSyncClient'
import { fetchServiceBundle } from '@/lib/service-bundle'

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const user = await getAuthUser(supabase) // local JWT validation (P1)

  // v20: ONE round trip — service, songs, profile, session state, impromptu, chords.
  const bundle = await fetchServiceBundle(supabase, id, user!.id)
  if (!bundle) notFound()
  const { service, profile, sessionState, chords } = bundle

  // The chart directs the live flow — songs dropped by the chart stay out of Live Sync
  const sortedSongs = bundle.songs.filter(s => s.in_chart !== false)

  // Impromptu live share: if a library song is being shared right now, its
  // latest reviewed sheet is in the bundle for the initial render.
  const imp = bundle.impromptu
  const initialImpromptu = imp && imp.body
    ? {
        librarySongId: imp.library_song_id,
        title: imp.title,
        storedKey: imp.stored_key,
        body: imp.body,
        sharedKey: sessionState?.impromptu_key ?? null,
      }
    : null

  // Validate user's preferred instrument against what this service actually has
  const profileInstrument = profile?.instrument ?? null
  const validatedInstrument = profileInstrument && service.instruments.includes(profileInstrument)
    ? profileInstrument
    : (service.instruments[0] ?? null)

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
      tempoBySongId={chords.tempoBySongId}
      prefsByLibraryId={chords.prefsByLibraryId}
      canMapSections={isEditor}
      initialImpromptu={initialImpromptu}
      preferredKey={profile?.preferred_key ?? null}
    />
  )
}

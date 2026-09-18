import { createClient, getAuthUser } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import MyPartClient from './MyPartClient'
import { fetchServiceBundle } from '@/lib/service-bundle'

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

  // v20: ONE round trip — service, songs, profile, notes, chords, tempo.
  const bundle = await fetchServiceBundle(supabase, id, user!.id)
  if (!bundle) notFound()
  const { service, profile, notes, chords } = bundle

  // The chart directs the flow — songs dropped by the chart stay out of My Part
  const sortedSongs = bundle.songs.filter(s => s.in_chart !== false)

  // Two lists, not one: section notes and (v19) song-level notes are keyed
  // differently on the client.
  const sectionNotes = notes.filter(n => n.section_id)
  const songNotes = notes.filter(n => n.song_id)

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
      initialNotes={sectionNotes}
      initialSongNotes={songNotes}
      chordsBySongId={chords.chordsBySongId}
      tempoBySongId={chords.tempoBySongId}
      prefsByLibraryId={chords.prefsByLibraryId}
      canMapSections={isEditor}
      preferredKey={profile?.preferred_key ?? null}
    />
  )
}

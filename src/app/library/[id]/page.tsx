import { redirect, notFound } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import SongDetailClient from './SongDetailClient'
import type { AppRole } from '@/lib/types'

export default async function LibrarySongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/auth/login')

  // P2: profile, song, key pref, and today's service are independent — one
  // stage. P7: version BODIES are no longer fetched here — the client lazy-
  // loads the one you open (a song with 3 versions was shipping 3 full sheets
  // on every visit).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
  const [{ data: profile }, { data: song }, { data: pref }, { data: todayService }] = await Promise.all([
    supabase.from('profiles').select('role, instrument, preferred_key').eq('id', user.id).single(),
    supabase
      .from('library_songs')
      .select('id, title, artist, created_at, song_versions(id, label, stored_key, bpm, ccli_number, reviewed_at, created_at)')
      .eq('id', id)
      .single(),
    supabase
      .from('user_scale_preferences')
      .select('preferred_key')
      .eq('user_id', user.id)
      .eq('library_song_id', id)
      .maybeSingle(),
    supabase.from('services').select('id').eq('service_date', today).maybeSingle(),
  ])
  if (!song) notFound()

  const role = (profile?.role ?? 'member') as AppRole
  // v6: every member can contribute — see unreviewed versions, edit, review
  void role
  const canManage = true

  let sharedLiveNow = false
  if (todayService) {
    const { data: st } = await supabase
      .from('session_state')
      .select('impromptu_library_song_id')
      .eq('service_id', todayService.id)
      .maybeSingle()
    sharedLiveNow = (st as { impromptu_library_song_id?: string | null } | null)?.impromptu_library_song_id === id
  }

  const versions = (song.song_versions ?? [])
    // members only ever receive reviewed versions (RLS enforces this too)
    .filter(v => canManage || v.reviewed_at !== null)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map(v => ({
      id: v.id,
      label: v.label,
      stored_key: v.stored_key,
      bpm: v.bpm,
      ccli_number: v.ccli_number,
      reviewed_at: v.reviewed_at,
      // content omitted — SongDetailClient lazy-loads it on expand (P7)
    }))

  return (
    <SongDetailClient
      song={{ id: song.id, title: song.title, artist: song.artist }}
      versions={versions}
      canManage={canManage}
      userId={user.id}
      perSongKey={pref?.preferred_key ?? null}
      globalPreferredKey={(profile as { preferred_key?: string | null } | null)?.preferred_key ?? null}
      instrument={(profile as { instrument?: string | null } | null)?.instrument ?? null}
      todayServiceId={todayService?.id ?? null}
      sharedLiveNow={sharedLiveNow}
    />
  )
}

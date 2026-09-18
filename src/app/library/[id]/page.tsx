import { redirect, notFound } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { findLiveTarget } from '@/lib/live-target'
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
  const [{ data: profile }, { data: song }, { data: pref }, liveTarget] = await Promise.all([
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
    // today's service, else the next one, else the last one (see live-target.ts)
    findLiveTarget(supabase),
  ])
  if (!song) notFound()

  const role = (profile?.role ?? 'member') as AppRole
  // v6: every member can contribute — see unreviewed versions, edit, review
  void role
  const canManage = true

  let sharedLiveNow = false
  if (liveTarget) {
    const { data: st } = await supabase
      .from('session_state')
      .select('impromptu_library_song_id')
      .eq('service_id', liveTarget.id)
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
      canDelete={role !== 'member'}
      userId={user.id}
      perSongKey={pref?.preferred_key ?? null}
      globalPreferredKey={(profile as { preferred_key?: string | null } | null)?.preferred_key ?? null}
      instrument={(profile as { instrument?: string | null } | null)?.instrument ?? null}
      liveTarget={liveTarget ? { id: liveTarget.id, label: liveTarget.label, isToday: liveTarget.isToday } : null}
      sharedLiveNow={sharedLiveNow}
    />
  )
}

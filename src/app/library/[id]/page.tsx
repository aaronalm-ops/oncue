import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SongDetailClient from './SongDetailClient'
import type { AppRole } from '@/lib/types'

export default async function LibrarySongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'member') as AppRole

  const { data: song } = await supabase
    .from('library_songs')
    .select('id, title, artist, created_at, song_versions(id, label, stored_key, bpm, ccli_number, reviewed_at, created_at, content_chordpro)')
    .eq('id', id)
    .single()
  if (!song) notFound()

  // v6: every member can contribute — see unreviewed versions, edit, review
  void role
  const canManage = true

  // The user's saved key preference for this song (drives the transpose default)
  const { data: pref } = await supabase
    .from('user_scale_preferences')
    .select('preferred_key')
    .eq('user_id', user.id)
    .eq('library_song_id', id)
    .maybeSingle()

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
      content: v.content_chordpro ?? '',
    }))

  return (
    <SongDetailClient
      song={{ id: song.id, title: song.title, artist: song.artist }}
      versions={versions}
      canManage={canManage}
      userId={user.id}
      preferredKey={pref?.preferred_key ?? null}
    />
  )
}

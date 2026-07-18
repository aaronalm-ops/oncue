import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import NewSetlistClient from './NewSetlistClient'
import type { AppRole } from '@/lib/types'

export default async function NewSetlistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'member') as AppRole
  if (!['master', 'admin', 'worship_leader'].includes(role)) redirect('/services')

  // Worship leader options: admins/master see everyone (RLS permits);
  // a worship_leader only sees themself — which is exactly right.
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .order('display_name', { ascending: true })

  const leaders = (profiles ?? []).map(p => ({
    id: p.id,
    name: p.display_name || 'Unnamed member',
    isLeader: p.role === 'worship_leader',
  }))

  // Library songs with a reviewed version can be linked at creation
  const { data: librarySongs } = await supabase
    .from('library_songs')
    .select('id, title, artist, song_versions(id, stored_key, reviewed_at)')
    .order('title', { ascending: true })

  const songs = (librarySongs ?? []).map(ls => {
    const reviewed = (ls.song_versions ?? []).find(v => v.reviewed_at !== null)
    return {
      id: ls.id,
      title: ls.title,
      artist: ls.artist,
      hasChords: !!reviewed,
      defaultKey: reviewed?.stored_key ?? null,
    }
  })

  return <NewSetlistClient leaders={leaders} librarySongs={songs} currentUserId={user.id} />
}

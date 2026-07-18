import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LibraryClient from './LibraryClient'
import type { AppRole } from '@/lib/types'

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'member') as AppRole

  const { data, error } = await supabase
    .from('library_songs')
    .select('id, title, artist, created_at, song_versions(id, label, stored_key, reviewed_at)')
    .order('title', { ascending: true })

  // Table doesn't exist yet — SQL migration hasn't been run
  if (error?.message?.includes('does not exist')) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p className="font-semibold">Chords library not set up yet.</p>
          <p className="text-sm text-zinc-500">Run <code className="text-purple-400">supabase/v2_chords_library.sql</code> in your Supabase SQL editor first.</p>
          <a href="/services" className="block mt-4 text-sm text-zinc-600 active:text-zinc-400">← Back to services</a>
        </div>
      </div>
    )
  }

  // Pending confirm-queue entries — v6: visible to every member (shared queue)
  let pendingUploads: Parameters<typeof LibraryClient>[0]['pendingUploads'] = []
  {
    const { data: uploads } = await supabase
      .from('chord_uploads')
      .select('*')
      .order('created_at', { ascending: true })
    pendingUploads = (uploads ?? []) as typeof pendingUploads
  }

  return (
    <LibraryClient
      songs={(data ?? []) as Parameters<typeof LibraryClient>[0]['songs']}
      role={role}
      pendingUploads={pendingUploads}
    />
  )
}

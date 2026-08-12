import { redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import LibraryClient from './LibraryClient'
import type { AppRole } from '@/lib/types'

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/auth/login')

  // "Add chords" intent from a service song row
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null
  const attachSong = one(sp.attachSong)
  const attachService = one(sp.attachService)
  const attachTitle = one(sp.attachTitle)
  const attachIntent = attachSong && attachService && attachTitle
    ? { songId: attachSong, serviceId: attachService, title: attachTitle }
    : null

  // P2: profile, song list, and pending uploads are independent — one stage.
  // P7: uploads select lists columns explicitly (draft_body can be huge and
  // the confirm cards never render it).
  const [{ data: profile }, { data, error }, { data: uploadRows }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase
      .from('library_songs')
      .select('id, title, artist, created_at, song_versions(id, label, stored_key, reviewed_at)')
      .order('title', { ascending: true }),
    supabase
      .from('chord_uploads')
      .select('id, original_filename, status, draft_title, draft_artist, draft_key, draft_bpm, section_count, warnings')
      .order('created_at', { ascending: true }),
  ])
  const role = (profile?.role ?? 'member') as AppRole

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
  const pendingUploads = (uploadRows ?? []) as Parameters<typeof LibraryClient>[0]['pendingUploads']

  return (
    <LibraryClient
      songs={(data ?? []) as Parameters<typeof LibraryClient>[0]['songs']}
      role={role}
      pendingUploads={pendingUploads}
      attachIntent={attachIntent}
    />
  )
}

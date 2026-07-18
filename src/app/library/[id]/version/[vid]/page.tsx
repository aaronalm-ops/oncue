import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import VersionEditorClient from './VersionEditorClient'

export default async function VersionEditorPage({ params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // v6: every member can review and correct chords

  const { data: song } = await supabase.from('library_songs').select('id, title, artist').eq('id', id).single()
  if (!song) notFound()

  const { data: version } = await supabase
    .from('song_versions')
    .select('id, label, stored_key, bpm, ccli_number, reviewed_at, content_chordpro, source_pdf_path')
    .eq('id', vid)
    .eq('library_song_id', id)
    .single()
  if (!version) notFound()

  // Signed URL so the reviewer sees the original PDF next to the editor
  let pdfUrl: string | null = null
  if (version.source_pdf_path) {
    const { data: signed } = await supabase.storage
      .from('chord-pdfs')
      .createSignedUrl(version.source_pdf_path, 60 * 60)
    pdfUrl = signed?.signedUrl ?? null
  }

  return (
    <VersionEditorClient
      songId={song.id}
      songTitle={song.title}
      version={{
        id: version.id,
        label: version.label,
        stored_key: version.stored_key,
        bpm: version.bpm,
        reviewed_at: version.reviewed_at,
        content: version.content_chordpro ?? '',
      }}
      pdfUrl={pdfUrl}
    />
  )
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('library_songs')
    .select('id, title, artist, created_at, song_versions(id, label, stored_key, reviewed_at)')
    .order('title', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ songs: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // v6: any member can add library songs; bulk DELETE below stays editor-only

  const { title, artist } = await request.json() as { title: string; artist?: string }
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('library_songs')
    .insert({ title: title.trim(), artist: artist?.trim() || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ song: data }, { status: 201 })
}

/** DELETE: bulk-remove songs (versions/sections/links cascade) + their stored PDFs */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Allowlist — a missing profile row must NOT grant access
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['master', 'admin', 'worship_leader'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { ids } = await request.json() as { ids: string[] }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every(i => typeof i === 'string')) {
    return NextResponse.json({ error: 'Provide 1–100 song ids' }, { status: 400 })
  }

  // Collect PDF paths BEFORE the cascade wipes the version rows
  const { data: versions } = await supabase
    .from('song_versions')
    .select('source_pdf_path')
    .in('library_song_id', ids)
  const pdfPaths = (versions ?? []).map(v => v.source_pdf_path).filter((p): p is string => !!p)

  const { error: delErr, count } = await supabase
    .from('library_songs')
    .delete({ count: 'exact' })
    .in('id', ids)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // Best-effort storage cleanup — orphaned PDFs cost money, but a failure
  // here must not fail the delete the user asked for
  if (pdfPaths.length > 0) {
    await supabase.storage.from('chord-pdfs').remove(pdfPaths)
  }

  return NextResponse.json({ deleted: count ?? ids.length })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Chord contributions are open to every signed-in member (v6)
async function requireEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { supabase, error: null }
}

/** POST: confirm — create/attach song + version atomically via RPC */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, error } = await requireEditor()
  if (error) return error

  const body = await request.json() as {
    title: string
    artist?: string | null
    key?: string | null
    bpm?: number | null
    library_song_id?: string | null
  }
  if (!body.title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })

  const { data, error: rpcErr } = await supabase.rpc('confirm_chord_upload', {
    p_upload_id: id,
    p_title: body.title.trim(),
    p_artist: body.artist?.trim() || null,
    p_key: body.key?.trim() || null,
    p_bpm: body.bpm ?? null,
    p_library_song_id: body.library_song_id ?? null,
  })
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })

  return NextResponse.json(data)
}

/** DELETE: discard a pending upload (removes the stored PDF too) */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, error } = await requireEditor()
  if (error) return error

  const { data: row } = await supabase.from('chord_uploads').select('pdf_path').eq('id', id).single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error: delErr } = await supabase.from('chord_uploads').delete().eq('id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  await supabase.storage.from('chord-pdfs').remove([row.pdf_path]) // best-effort

  return NextResponse.json({ success: true })
}

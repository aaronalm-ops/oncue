import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deriveSections } from '@/lib/chords/format'

const EDITOR_ROLES = ['master', 'admin', 'worship_leader']

async function requireEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !EDITOR_ROLES.includes(profile.role ?? '')) {
    return { supabase, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { supabase, error: null }
}

/**
 * PATCH: save edits without approving. Content changes invalidate the
 * previous review (reviewed_at → null) so stale sections never show live.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, error } = await requireEditor()
  if (error) return error

  const body = await request.json() as {
    content?: string
    stored_key?: string | null
    bpm?: number | null
    label?: string
  }

  const update: Record<string, unknown> = {}
  if (body.content !== undefined) {
    update.content_chordpro = body.content
    update.reviewed_at = null
  }
  if (body.stored_key !== undefined) update.stored_key = body.stored_key?.trim() || null
  if (body.bpm !== undefined) update.bpm = body.bpm
  if (body.label !== undefined && body.label.trim()) update.label = body.label.trim()

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error: upErr } = await supabase.from('song_versions').update(update).eq('id', id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

/** POST: approve — derive sections from content atomically via RPC */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, error } = await requireEditor()
  if (error) return error

  const body = await request.json() as {
    content: string
    stored_key?: string | null
    bpm?: number | null
  }
  if (typeof body.content !== 'string' || !body.content.trim()) {
    return NextResponse.json({ error: 'Cannot approve an empty chord sheet' }, { status: 400 })
  }

  const sections = deriveSections(body.content)
  if (sections.length === 0) {
    return NextResponse.json({ error: 'No sections found — add at least one "# Section" header or some content' }, { status: 400 })
  }

  const { data, error: rpcErr } = await supabase.rpc('approve_song_version', {
    p_version_id: id,
    p_content: body.content,
    p_stored_key: body.stored_key ?? null,
    p_bpm: body.bpm ?? null,
    p_sections: sections,
  })
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })

  return NextResponse.json(data)
}

/** DELETE: remove a version (sections cascade; the PDF stays in storage) */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase, error } = await requireEditor()
  if (error) return error

  const { error: delErr } = await supabase.from('song_versions').delete().eq('id', id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

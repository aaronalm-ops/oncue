import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** PATCH: rename a library song / fix its artist. Open to all members (v6). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { title?: string; artist?: string | null }
  const update: Record<string, unknown> = {}
  if (body.title !== undefined) {
    if (!body.title.trim()) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    update.title = body.title.trim()
  }
  if (body.artist !== undefined) update.artist = body.artist?.trim() || null
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await supabase.from('library_songs').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

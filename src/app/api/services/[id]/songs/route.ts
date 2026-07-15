import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface SongInput {
  id?: string
  title: string
  scale: string | null
  order_index: number
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: serviceId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Allowlist — a missing profile row must NOT grant access
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['master', 'admin', 'worship_leader'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { songs } = await request.json() as { songs: SongInput[] }

  const { data: existing } = await supabase.from('songs').select('id').eq('service_id', serviceId)
  const existingIds = new Set((existing ?? []).map(s => s.id))
  const incomingIds = new Set(songs.filter(s => s.id).map(s => s.id!))

  // Delete songs removed from the list (cascades sections + instructions)
  const toDelete = [...existingIds].filter(id => !incomingIds.has(id))
  if (toDelete.length > 0) {
    const { error } = await supabase.from('songs').delete().in('id', toDelete)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Update existing songs (title, scale, order)
  for (const song of songs.filter(s => s.id)) {
    const { error } = await supabase.from('songs').update({
      title: song.title,
      scale: song.scale,
      order_index: song.order_index,
    }).eq('id', song.id!)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Insert new songs (no sections — added manually)
  const newSongs = songs.filter(s => !s.id)
  if (newSongs.length > 0) {
    const { error } = await supabase.from('songs').insert(
      newSongs.map(s => ({
        service_id: serviceId,
        title: s.title,
        scale: s.scale,
        medley_group: null,
        reference_links: [],
        order_index: s.order_index,
      }))
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

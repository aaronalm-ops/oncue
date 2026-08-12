import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'

interface SongInput {
  id?: string
  title: string
  scale: string | null
  order_index: number
  library_song_id?: string | null // set for a newly added library song
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: serviceId } = await params
  const supabase = await createClient()

  const user = await getAuthUser(supabase)
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

  // Delete songs removed from the list (cascades sections + instructions).
  // Scope to the service so a stray id can never touch another service's rows.
  const toDelete = [...existingIds].filter(id => !incomingIds.has(id))
  if (toDelete.length > 0) {
    const { error } = await supabase.from('songs').delete().eq('service_id', serviceId).in('id', toDelete)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Update existing songs (title, scale, order) — but ONLY ones that actually
  // belong to this service; a client-supplied id from elsewhere no-ops.
  // P4: fire concurrently — N round-trips of latency collapse into one.
  const updateResults = await Promise.all(
    songs.filter(s => s.id && existingIds.has(s.id)).map(song =>
      supabase.from('songs').update({
        title: song.title,
        scale: song.scale,
        order_index: song.order_index,
      }).eq('id', song.id!).eq('service_id', serviceId)
    )
  )
  const updateErr = updateResults.find(r => r.error)?.error
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Insert new songs via add_setlist_song so they get library-linked and any
  // saved arrangement (flow + notes + link) pre-fills; then set their order to
  // match the submitted position. Also concurrent (P4) — rows are independent.
  const insertResults = await Promise.all(
    songs.filter(x => !x.id).map(async s => {
      const { data, error } = await supabase.rpc('add_setlist_song', {
        p_service_id: serviceId,
        p_title: s.title,
        p_scale: s.scale ?? '',
        p_library_song_id: s.library_song_id ?? null,
      })
      if (error) return { error }
      const newId = (data as { song_id?: string } | null)?.song_id
      if (newId) {
        await supabase.from('songs').update({ order_index: s.order_index }).eq('id', newId).eq('service_id', serviceId)
      }
      return { error: null }
    })
  )
  const insertErr = insertResults.find(r => r.error)?.error
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

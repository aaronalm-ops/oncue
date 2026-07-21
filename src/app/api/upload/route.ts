import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseChart, parseFilename } from '@/lib/parser'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['master', 'admin'].includes(profile.role ?? '')) {
    return NextResponse.json({ error: 'Only admins can upload charts' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Route Handlers aren't covered by the Server Actions body limit — cap here.
  const MAX_BYTES = 10 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB).' }, { status: 413 })
  }

  const filename = file.name
  if (!parseFilename(filename)) {
    return NextResponse.json(
      { error: `Filename must match DAY DD-MM-YYYY CHART.xlsx — received: ${filename}` },
      { status: 400 }
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  let parsed
  try {
    parsed = await parseChart(buffer, filename)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 })
  }

  if (parsed.songs.length === 0) {
    return NextResponse.json(
      { error: 'No songs found in the chart — check that Sheet1 has SONG rows.' },
      { status: 422 }
    )
  }

  // Atomic create-or-replace in a single transaction (preserves private notes on replace)
  const { data: result, error: rpcError } = await supabase.rpc('ingest_chart', {
    payload: {
      service_date: parsed.service_date,
      day_of_week: parsed.day_of_week,
      source_filename: parsed.source_filename,
      instruments: parsed.instruments,
      songs: parsed.songs,
    },
  })

  if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 500 })

  const { service_id, replaced, notes_restored } = result as {
    service_id: string
    replaced: boolean
    songs: number
    notes_restored: number
  }

  // Snapshot this leader's arrangement (flow + conductor notes + links) so it
  // pre-fills their next setlist. Best-effort — never fail the upload over it.
  const { error: memErr } = await supabase.rpc('capture_service_memory', { p_service_id: service_id })
  if (memErr) console.error('[upload] setlist memory capture failed', memErr)

  // Store the original file so "Download Excel" always works.
  // Surface a failure instead of swallowing it.
  let warning: string | undefined
  const { error: storageError } = await supabase.storage
    .from('charts')
    .upload(`${service_id}/${filename}`, buffer, {
      upsert: true,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  if (storageError) {
    warning = `Chart saved, but storing the original file failed (${storageError.message}). The download button for this service will not work.`
  }

  return NextResponse.json({
    service_id,
    songs: parsed.songs.length,
    replaced,
    notes_restored,
    ...(warning ? { warning } : {}),
  })
}

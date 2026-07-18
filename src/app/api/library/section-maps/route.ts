import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeSectionLabelFull } from '@/lib/chords/format'

// Chord contributions are open to every signed-in member (v6)
async function requireEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { supabase, error: null }
}

/** POST: save a chart→chord section mapping for a library song */
export async function POST(request: NextRequest) {
  const { supabase, error } = await requireEditor()
  if (error) return error

  const body = await request.json() as {
    library_song_id: string
    chart_label: string
    chord_section_label: string
  }
  if (!body.library_song_id || !body.chart_label?.trim() || !body.chord_section_label?.trim()) {
    return NextResponse.json({ error: 'library_song_id, chart_label and chord_section_label are required' }, { status: 400 })
  }

  const { error: upErr } = await supabase.from('chord_section_maps').upsert(
    {
      library_song_id: body.library_song_id,
      chart_label_normalized: normalizeSectionLabelFull(body.chart_label),
      chord_section_label: body.chord_section_label.trim(),
    },
    { onConflict: 'library_song_id,chart_label_normalized' },
  )
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

/** DELETE: remove a mapping */
export async function DELETE(request: NextRequest) {
  const { supabase, error } = await requireEditor()
  if (error) return error

  const body = await request.json() as { library_song_id: string; chart_label: string }
  if (!body.library_song_id || !body.chart_label?.trim()) {
    return NextResponse.json({ error: 'library_song_id and chart_label are required' }, { status: 400 })
  }

  const { error: delErr } = await supabase
    .from('chord_section_maps')
    .delete()
    .eq('library_song_id', body.library_song_id)
    .eq('chart_label_normalized', normalizeSectionLabelFull(body.chart_label))
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

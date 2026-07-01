import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseChart, parseFilename } from '@/lib/parser'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

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

  // Upsert service
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .upsert(
      {
        service_date: parsed.service_date,
        day_of_week: parsed.day_of_week,
        source_filename: parsed.source_filename,
        instruments: parsed.instruments,
      },
      { onConflict: 'service_date' }
    )
    .select()
    .single()

  if (serviceError) return NextResponse.json({ error: serviceError.message }, { status: 500 })

  // Delete existing songs for this service (cascade deletes sections + instructions)
  await supabase.from('songs').delete().eq('service_id', service.id)

  // Insert songs, sections, instructions
  for (const parsedSong of parsed.songs) {
    const { data: song, error: songError } = await supabase
      .from('songs')
      .insert({
        service_id: service.id,
        order_index: parsedSong.order_index,
        title: parsedSong.title,
        scale: parsedSong.scale,
        medley_group: parsedSong.medley_group,
        reference_links: parsedSong.reference_links,
      })
      .select()
      .single()

    if (songError) return NextResponse.json({ error: songError.message }, { status: 500 })

    for (let si = 0; si < parsedSong.sections.length; si++) {
      const parsedSection = parsedSong.sections[si]
      const { data: section, error: sectionError } = await supabase
        .from('sections')
        .insert({
          song_id: song.id,
          order_index: si,
          label: parsedSection.label,
          comments: parsedSection.comments,
        })
        .select()
        .single()

      if (sectionError) return NextResponse.json({ error: sectionError.message }, { status: 500 })

      if (parsedSection.instructions.length > 0) {
        const { error: instrError } = await supabase.from('instructions').insert(
          parsedSection.instructions.map(instr => ({
            section_id: section.id,
            instrument: instr.instrument,
            text: instr.text,
            is_intro: instr.is_intro,
          }))
        )
        if (instrError) return NextResponse.json({ error: instrError.message }, { status: 500 })
      }
    }
  }

  // Ensure session_state row exists
  await supabase
    .from('session_state')
    .upsert({ service_id: service.id, current_song_index: 0, current_section_index: 0 }, { onConflict: 'service_id' })

  // Store the original file in Supabase Storage
  const { error: storageError } = await supabase.storage
    .from('charts')
    .upload(`${service.id}/${filename}`, buffer, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  if (storageError) console.warn('Storage upload failed:', storageError.message)

  return NextResponse.json({ service_id: service.id, songs: parsed.songs.length })
}

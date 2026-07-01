import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: service } = await supabase
    .from('services')
    .select('source_filename')
    .eq('id', id)
    .single()

  if (!service) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: fileData, error } = await supabase.storage
    .from('charts')
    .download(`${id}/${service.source_filename}`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bytes = await fileData.arrayBuffer()
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${service.source_filename}"`,
    },
  })
}

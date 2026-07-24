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

  // Exact path first
  let filename = service.source_filename
  let { data: fileData } = await supabase.storage
    .from('charts')
    .download(`${id}/${filename}`)

  // Fallback: the recorded name may not match what's stored (renamed
  // re-upload), so serve whatever file exists in this service's folder.
  if (!fileData) {
    const { data: listing } = await supabase.storage.from('charts').list(id, { limit: 10 })
    const candidate = (listing ?? []).find(f => f.name.toLowerCase().endsWith('.xlsx')) ?? (listing ?? [])[0]
    if (candidate) {
      filename = candidate.name
      const res = await supabase.storage.from('charts').download(`${id}/${candidate.name}`)
      fileData = res.data
    }
  }

  if (!fileData) {
    // Honest, actionable 404: early uploads predate file storage, so the DB
    // knows the chart but the original file was never kept.
    return NextResponse.json(
      {
        error:
          'The original Excel for this service is not in storage — it was likely uploaded before file storage was set up. ' +
          'An admin can restore it by re-uploading the same chart file: the service merges in place (notes and links are kept) and the file is stored this time.',
      },
      { status: 404 }
    )
  }

  const bytes = await fileData.arrayBuffer()
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

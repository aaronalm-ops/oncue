import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'

/** W15: downloads open in a browser tab, so failures must be readable pages
 *  (in the app's look), not raw JSON. */
function htmlError(serviceId: string, title: string, detail: string, status: number) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — OnCue</title></head>
<body style="margin:0;background:#000;color:#fff;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
<div style="max-width:26rem;text-align:center">
<p style="font-weight:600;font-size:16px;margin:0 0 10px">${title}</p>
<p style="color:#a1a1aa;font-size:14px;line-height:1.5;margin:0 0 20px">${detail}</p>
<a href="/services/${serviceId}" style="color:#c084fc;font-size:14px;text-decoration:none">&larr; Back to the service</a>
</div></body></html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: service } = await supabase
    .from('services')
    .select('source_filename')
    .eq('id', id)
    .single()

  if (!service) return htmlError(id, 'Service not found', 'This service may have been deleted.', 404)

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
    return htmlError(
      id,
      'Original chart file not available',
      'This chart was uploaded before file storage was set up, so the original Excel was never kept. An admin can restore it by re-uploading the same chart file — the service merges in place (notes and links are kept) and the file is stored this time.',
      404,
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

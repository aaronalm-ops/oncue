import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractPdfLines } from '@/lib/chords/extract'
import { parseChordSheet } from '@/lib/chords/parse'

const EDITOR_ROLES = ['master', 'admin', 'worship_leader']

async function requireEditor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !EDITOR_ROLES.includes(profile.role ?? '')) {
    return { supabase, user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { supabase, user, error: null }
}

/** GET: pending confirm-queue entries (resurfaces abandoned batches) */
export async function GET() {
  const { supabase, error } = await requireEditor()
  if (error) return error

  const { data, error: qErr } = await supabase
    .from('chord_uploads')
    .select('*')
    .order('created_at', { ascending: true })
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })

  return NextResponse.json({ uploads: data ?? [] })
}

/**
 * POST: one PDF per request (the client loops for bulk, mirroring the chart
 * uploader's progress pattern). Stores the PDF first — the original is never
 * lost — then extracts, parses, and creates a queue row.
 */
export async function POST(request: NextRequest) {
  const { supabase, user, error } = await requireEditor()
  if (error) return error

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!/\.pdf$/i.test(file.name)) {
    return NextResponse.json({ error: 'Only PDF files are accepted here' }, { status: 400 })
  }
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'PDF is larger than 15 MB' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const safeName = file.name.replace(/[^\w.\- ()]/g, '_')
  const pdfPath = `uploads/${crypto.randomUUID()}/${safeName}`

  const { error: storageError } = await supabase.storage
    .from('chord-pdfs')
    .upload(pdfPath, buffer, { contentType: 'application/pdf' })
  if (storageError) {
    return NextResponse.json(
      { error: `Could not store the PDF (${storageError.message}). Is the chord-pdfs bucket created?` },
      { status: 500 }
    )
  }

  let status: 'parsed' | 'scan' | 'failed' = 'parsed'
  let draft: {
    title: string | null; artist: string | null; key: string | null
    bpm: number | null; ccli: string | null; body: string
    sectionCount: number; warnings: string[]
  } | null = null

  try {
    const extracted = await extractPdfLines(new Uint8Array(buffer))
    if (!extracted.hasTextLayer) {
      status = 'scan'
    } else {
      draft = parseChordSheet(extracted.lines, file.name)
    }
  } catch {
    status = 'failed'
  }

  const fallbackTitle = file.name
    .replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ').replace(/\bchords?\b/gi, '').trim()
    .replace(/\b\w/g, c => c.toUpperCase())

  const { data: row, error: insErr } = await supabase
    .from('chord_uploads')
    .insert({
      uploaded_by: user!.id,
      pdf_path: pdfPath,
      original_filename: file.name,
      status,
      draft_title: draft?.title ?? fallbackTitle,
      draft_artist: draft?.artist ?? null,
      draft_key: draft?.key ?? null,
      draft_bpm: draft?.bpm ?? null,
      draft_ccli: draft?.ccli ?? null,
      draft_body: draft?.body ?? '',
      section_count: draft?.sectionCount ?? 0,
      warnings: draft?.warnings ?? [],
    })
    .select()
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Suggest library matches by normalised title
  const suggestions = await suggestMatches(supabase, row.draft_title ?? '')

  return NextResponse.json({ upload: row, suggestions })
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

async function suggestMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  title: string,
) {
  const { data: songs } = await supabase.from('library_songs').select('id, title, artist')
  if (!songs || !title) return []
  const target = normalizeTitle(title)
  return songs
    .map(s => {
      const n = normalizeTitle(s.title)
      const exact = n === target
      const contains = !exact && (n.includes(target) || target.includes(n)) && Math.min(n.length, target.length) >= 5
      return { ...s, score: exact ? 2 : contains ? 1 : 0 }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

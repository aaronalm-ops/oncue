import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface SearchRow {
  id: string
  title: string
  artist: string | null
  has_chords: boolean
  snippet: string | null
}

/**
 * Library search for the setlist picker — matches title AND de-chorded lyrics
 * (so a lyric phrase surfaces the right song), and flags which songs already
 * have a saved arrangement that would pre-fill.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()

  const { data, error } = await supabase.rpc('search_library', { p_query: q })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as SearchRow[]

  // Which of these already have a saved arrangement (→ will pre-fill on add)?
  let withMemory = new Set<string>()
  if (rows.length) {
    const { data: arr } = await supabase
      .from('library_song_arrangement')
      .select('library_song_id')
      .in('library_song_id', rows.map(r => r.id))
    withMemory = new Set((arr ?? []).map(a => a.library_song_id))
  }

  return NextResponse.json({
    results: rows.map(r => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      hasChords: r.has_chords,
      hasMemory: withMemory.has(r.id),
      snippet: r.snippet,
    })),
  })
}

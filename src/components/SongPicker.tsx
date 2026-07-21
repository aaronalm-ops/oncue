'use client'

import { useEffect, useRef, useState } from 'react'

export interface PickedSong {
  library_song_id: string | null // null = brand-new "needs chords" song
  title: string
  hasChords: boolean
}

interface Result {
  id: string
  title: string
  artist: string | null
  hasChords: boolean
  hasMemory: boolean
  snippet: string | null
}

/**
 * Search the chord library by title AND lyrics, preview each match (so you
 * don't pick the wrong song), and add it — or create a new "needs chords"
 * entry when it genuinely isn't there yet. Reused by New + Edit Setlist.
 */
export default function SongPicker({
  onPick,
  placeholder = 'Search a song or a lyric line…',
  busy = false,
}: {
  onPick: (s: PickedSong) => void
  placeholder?: string
  busy?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (timer.current) clearTimeout(timer.current)
    if (!q) { setResults([]); setLoading(false); return }
    setLoading(true)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/library/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(res.ok ? (data.results ?? []) : [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  const q = query.trim()
  const exact = results.some(r => r.title.toLowerCase() === q.toLowerCase())

  function pick(s: PickedSong) {
    onPick(s)
    setQuery('')
    setResults([])
  }

  return (
    <div>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        disabled={busy}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600 disabled:opacity-50"
      />

      {q && (
        <div className="mt-1 rounded-xl border border-zinc-800 overflow-hidden">
          {loading && results.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-zinc-600">Searching…</div>
          )}

          {results.map(r => (
            <button
              key={r.id}
              onClick={() => pick({ library_song_id: r.id, title: r.title, hasChords: r.hasChords })}
              disabled={busy}
              className="w-full text-left px-3 py-2.5 bg-zinc-900 active:bg-zinc-800 border-b border-zinc-800 last:border-b-0 disabled:opacity-50"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-sm truncate">
                  {r.title}
                  {r.artist ? <span className="text-zinc-600"> · {r.artist}</span> : null}
                </span>
                {r.hasMemory && (
                  <span className="shrink-0 text-[10px] text-purple-400" title="Flow & conductor notes carry over from last time">↩ saved</span>
                )}
                <span className={`shrink-0 text-[10px] ${r.hasChords ? 'text-green-500' : 'text-amber-500'}`}>
                  {r.hasChords ? 'chords' : 'needs chords'}
                </span>
              </div>
              {r.snippet && (
                <p className="mt-0.5 text-[11px] text-zinc-600 truncate">{r.snippet}</p>
              )}
            </button>
          ))}

          {/* Create a brand-new song when it isn't already there */}
          {!exact && !loading && (
            <button
              onClick={() => pick({ library_song_id: null, title: q, hasChords: false })}
              disabled={busy}
              className="w-full text-left px-3 py-2.5 bg-zinc-950 active:bg-zinc-900 disabled:opacity-50"
            >
              <span className="text-sm text-purple-400">+ Add &ldquo;{q}&rdquo;</span>
              <span className="ml-2 text-[10px] text-amber-500">new — needs chords</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

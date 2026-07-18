'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Leader { id: string; name: string; isLeader: boolean }
interface LibrarySongOption {
  id: string
  title: string
  artist: string | null
  hasChords: boolean
  defaultKey: string | null
}

interface SetlistSong {
  title: string
  scale: string
  library_song_id: string | null
}

interface Props {
  leaders: Leader[]
  librarySongs: LibrarySongOption[]
  currentUserId: string
}

/**
 * Setlist-first flow: create the service on Monday, before the conductor's
 * chart exists. Songs picked from the library are chord-linked immediately.
 * Wednesday's chart upload MERGES onto this (matching by title), keeping
 * links and notes while taking the conductor's order and sections.
 */
export default function NewSetlistClient({ leaders, librarySongs, currentUserId }: Props) {
  const [date, setDate] = useState('')
  const [leaderId, setLeaderId] = useState(
    leaders.find(l => l.isLeader)?.id ?? leaders.find(l => l.id === currentUserId)?.id ?? ''
  )
  const [songs, setSongs] = useState<SetlistSong[]>([])
  const [query, setQuery] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const dayOfWeek = useMemo(() => {
    if (!date) return null
    const d = new Date(date + 'T00:00:00')
    const day = d.getDay() // 0 Sun … 6 Sat
    if (day === 4) return 'THURSDAY'
    if (day === 6) return 'SATURDAY'
    return null
  }, [date])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return librarySongs
      .filter(s => s.title.toLowerCase().includes(q) || (s.artist ?? '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [query, librarySongs])

  function addFromLibrary(s: LibrarySongOption) {
    setSongs(prev => [...prev, { title: s.title, scale: s.defaultKey ?? '', library_song_id: s.id }])
    setQuery('')
  }

  function addCustom() {
    const t = customTitle.trim()
    if (!t) return
    setSongs(prev => [...prev, { title: t, scale: '', library_song_id: null }])
    setCustomTitle('')
  }

  function move(idx: number, dir: -1 | 1) {
    setSongs(prev => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  async function save() {
    setError(null)
    if (!date) { setError('Pick a service date'); return }
    if (!dayOfWeek) { setError('Services are on Thursdays and Saturdays — pick one of those dates'); return }
    if (!leaderId) { setError('Pick the worship leader'); return }
    if (songs.length === 0) { setError('Add at least one song'); return }

    setSaving(true)
    const supabase = createClient()
    const { data, error: rpcErr } = await supabase.rpc('create_setlist', {
      p_service_date: date,
      p_day_of_week: dayOfWeek,
      p_worship_leader: leaderId,
      p_songs: songs.map(s => ({
        title: s.title,
        scale: s.scale.trim() || null,
        library_song_id: s.library_song_id,
      })),
    })
    setSaving(false)
    if (rpcErr) { setError(rpcErr.message); return }
    router.push(`/services/${(data as { service_id: string }).service_id}`)
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">

        <div className="flex items-center gap-3 mb-6">
          <Link href="/services"
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors shrink-0">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">New Setlist</h1>
            <p className="text-xs text-zinc-500">The conductor&rsquo;s chart merges onto this when it arrives</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Service date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-600 [color-scheme:dark]" />
              {date && (
                <p className={`mt-1 text-[11px] ${dayOfWeek ? 'text-zinc-500' : 'text-amber-400'}`}>
                  {dayOfWeek ?? 'Not a Thursday or Saturday'}
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Worship leader</label>
              <select value={leaderId} onChange={e => setLeaderId(e.target.value)}
                className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-600">
                <option value="">Choose…</option>
                {leaders.map(l => (
                  <option key={l.id} value={l.id}>{l.name}{l.isLeader ? ' ★' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Song picker */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Add songs</label>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search the library…"
              className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600"
            />
            {matches.length > 0 && (
              <div className="mt-1 rounded-xl border border-zinc-800 overflow-hidden">
                {matches.map(s => (
                  <button key={s.id} onClick={() => addFromLibrary(s)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left bg-zinc-900 active:bg-zinc-800 border-b border-zinc-800 last:border-b-0">
                    <span className="flex-1 min-w-0 text-sm truncate">{s.title}</span>
                    {s.defaultKey && <span className="shrink-0 text-[10px] font-bold text-purple-400">{s.defaultKey}</span>}
                    <span className={`shrink-0 text-[10px] ${s.hasChords ? 'text-green-500' : 'text-zinc-600'}`}>
                      {s.hasChords ? 'chords ✓' : 'no chords'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <input
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
                placeholder="…or type a song not in the library"
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-purple-600"
              />
              <button onClick={addCustom} disabled={!customTitle.trim()}
                className="px-3 py-2 rounded-xl bg-zinc-800 text-sm text-zinc-300 disabled:opacity-40">
                Add
              </button>
            </div>
          </div>

          {/* Setlist */}
          {songs.length > 0 && (
            <div className="space-y-1.5">
              {songs.map((s, i) => (
                <div key={i} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
                  <span className="text-[10px] text-zinc-600 w-4 shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-sm truncate">{s.title}</span>
                  <input
                    value={s.scale}
                    onChange={e => setSongs(prev => prev.map((x, xi) => xi === i ? { ...x, scale: e.target.value } : x))}
                    placeholder="Key" size={3}
                    className="w-12 bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-1 text-xs text-center text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600"
                  />
                  {s.library_song_id
                    ? <span className="shrink-0 text-[10px] text-green-500">linked</span>
                    : <span className="shrink-0 text-[10px] text-zinc-600">new</span>}
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="text-zinc-500 disabled:opacity-20 px-1">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === songs.length - 1} className="text-zinc-500 disabled:opacity-20 px-1">↓</button>
                  <button onClick={() => setSongs(prev => prev.filter((_, xi) => xi !== i))} className="text-zinc-600 px-1">✕</button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button onClick={save} disabled={saving}
            className="w-full py-3 rounded-xl bg-purple-600 text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform">
            {saving ? 'Creating…' : 'Create setlist'}
          </button>
          <p className="text-[11px] text-zinc-600">
            When the conductor&rsquo;s Excel is uploaded for this date, it merges onto this setlist:
            songs are matched by title, chord links and notes survive, and the chart&rsquo;s order takes over.
          </p>
        </div>
      </div>
    </div>
  )
}

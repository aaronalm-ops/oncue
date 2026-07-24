'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { deriveSections } from '@/lib/chords/format'

interface ShareSong {
  id: string
  title: string
  scale: string | null
  librarySongId: string | null // null = no chord sheet → no lyrics available
}

interface Props {
  serviceDate: string // YYYY-MM-DD
  dayOfWeek: string // THURSDAY / SATURDAY
  songs: ShareSong[]
  playlistUrl: string | null
}

/** "Thursday, 23rd April" */
function shareDateLabel(serviceDate: string, dayOfWeek: string): string {
  const d = new Date(serviceDate + 'T00:00:00')
  const day = d.getDate()
  const suffix =
    day % 100 >= 11 && day % 100 <= 13 ? 'th'
    : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'
  const month = d.toLocaleDateString('en-GB', { month: 'long' })
  const dow = dayOfWeek.charAt(0) + dayOfWeek.slice(1).toLowerCase()
  return `${dow}, ${day}${suffix} ${month}`
}

/** Chord body section → plain lyrics: strip [chords], drop flow markers and
 *  lines that were chords-only (instrumentals). */
function lyricsOf(content: string): string {
  const out: string[] = []
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim().startsWith('> ')) continue // flow marker
    const stripped = line.replace(/\[[^\]\n]{1,24}\]/g, '')
    const hadChords = stripped !== line
    if (stripped.trim() === '') {
      if (!hadChords && line.trim() === '') out.push('') // keep real blank lines
      continue // chord-only line → skip
    }
    out.push(stripped.replace(/ {2,}/g, ' ').trimEnd())
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

interface SongSections {
  sections: Array<{ label: string; lyrics: string }>
}

export default function ShareSetlist({ serviceDate, dayOfWeek, songs, playlistUrl }: Props) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [includePlaylist, setIncludePlaylist] = useState(playlistUrl !== null)
  const [includeLyrics, setIncludeLyrics] = useState(false)
  // songId → sections derived from its chord sheet (null = not loaded yet)
  const [lyricsBySong, setLyricsBySong] = useState<Record<string, SongSections> | null>(null)
  const [loadingLyrics, setLoadingLyrics] = useState(false)
  // songId → set of selected section indexes
  const [selected, setSelected] = useState<Record<string, Set<number>>>({})
  const [copied, setCopied] = useState(false)
  const [copiedSongId, setCopiedSongId] = useState<string | null>(null)

  /** Copy one song's lyrics directly — selected sections, or the whole song
   *  when nothing is selected. For manual pasting anywhere. */
  async function copySongLyrics(songId: string, title: string) {
    const info = lyricsBySong?.[songId]
    if (!info) return
    const sel = selected[songId] ?? new Set<number>()
    const useAll = sel.size === 0
    const parts: string[] = [`*${title}*`]
    info.sections.forEach((sec, idx) => {
      if (!useAll && !sel.has(idx)) return
      parts.push(`_${sec.label}:_`)
      parts.push(sec.lyrics)
      parts.push('')
    })
    try {
      await navigator.clipboard.writeText(parts.join('\n').trimEnd())
      setCopiedSongId(songId)
      setTimeout(() => setCopiedSongId(prev => (prev === songId ? null : prev)), 2000)
    } catch { /* clipboard unavailable */ }
  }

  const lyricCapable = songs.filter(s => s.librarySongId !== null)

  // Fetch chord bodies only when lyrics are first requested — keeps the page light
  useEffect(() => {
    if (!includeLyrics || lyricsBySong !== null || lyricCapable.length === 0) return
    let cancelled = false
    ;(async () => {
      setLoadingLyrics(true)
      const libIds = [...new Set(lyricCapable.map(s => s.librarySongId!))]
      const { data } = await createClient()
        .from('song_versions')
        .select('library_song_id, content_chordpro, reviewed_at')
        .in('library_song_id', libIds)
        .not('reviewed_at', 'is', null)
        .not('content_chordpro', 'is', null)
        .order('reviewed_at', { ascending: false })
      if (cancelled) return
      const bodyByLib = new Map<string, string>()
      for (const v of data ?? []) {
        if (!bodyByLib.has(v.library_song_id) && v.content_chordpro) {
          bodyByLib.set(v.library_song_id, v.content_chordpro)
        }
      }
      const result: Record<string, SongSections> = {}
      for (const s of lyricCapable) {
        const body = bodyByLib.get(s.librarySongId!)
        if (!body) continue
        const sections = deriveSections(body)
          .map(sec => ({ label: sec.label, lyrics: lyricsOf(sec.content) }))
          .filter(sec => sec.lyrics !== '')
        if (sections.length > 0) result[s.id] = { sections }
      }
      setLyricsBySong(result)
      setLoadingLyrics(false)
    })()
    return () => { cancelled = true }
  }, [includeLyrics, lyricsBySong, lyricCapable])

  function toggleSection(songId: string, idx: number) {
    setSelected(prev => {
      const cur = new Set(prev[songId] ?? [])
      if (cur.has(idx)) cur.delete(idx)
      else cur.add(idx)
      return { ...prev, [songId]: cur }
    })
  }

  function toggleAll(songId: string) {
    const total = lyricsBySong?.[songId]?.sections.length ?? 0
    setSelected(prev => {
      const cur = prev[songId] ?? new Set<number>()
      const all = cur.size === total
      return { ...prev, [songId]: all ? new Set<number>() : new Set(Array.from({ length: total }, (_, i) => i)) }
    })
  }

  const uniformKey = useMemo(() => {
    const keys = songs.map(s => (s.scale ?? '').trim()).filter(Boolean)
    if (keys.length === 0 || keys.length !== songs.length) return null
    const first = keys[0].toUpperCase()
    return keys.every(k => k.toUpperCase() === first) ? keys[0] : null
  }, [songs])

  const message = useMemo(() => {
    const lines: string[] = []
    lines.push('Dear Team,')
    lines.push(`Please find below the setlist for ${shareDateLabel(serviceDate, dayOfWeek)}`)
    lines.push('')
    songs.forEach((s, i) => {
      const note = (notes[s.id] ?? '').trim()
      let line = `${i + 1}. ${s.title}`
      if (!uniformKey && s.scale?.trim()) line += ` (Key of ${s.scale.trim()})`
      if (note) line += ` (${note})`
      lines.push(line)
    })
    if (uniformKey) {
      lines.push('')
      lines.push(`All on the Key ${uniformKey}`)
    }
    if (includePlaylist && playlistUrl) {
      lines.push('')
      lines.push(`Playlist link: ${playlistUrl}`)
    }
    if (includeLyrics && lyricsBySong) {
      const blocks: string[] = []
      for (const s of songs) {
        const info = lyricsBySong[s.id]
        const sel = selected[s.id]
        if (!info || !sel || sel.size === 0) continue
        const parts: string[] = [`*${s.title}*`]
        info.sections.forEach((sec, idx) => {
          if (!sel.has(idx)) return
          parts.push(`_${sec.label}:_`)
          parts.push(sec.lyrics)
          parts.push('')
        })
        blocks.push(parts.join('\n').trimEnd())
      }
      if (blocks.length > 0) {
        lines.push('')
        lines.push('— Lyrics —')
        lines.push('')
        lines.push(blocks.join('\n\n'))
      }
    }
    return lines.join('\n')
  }, [songs, notes, uniformKey, includePlaylist, playlistUrl, includeLyrics, lyricsBySong, selected, serviceDate, dayOfWeek])

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  if (songs.length === 0) return null
  const veryLong = message.length > 6000

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-4 active:bg-zinc-800 transition-colors border border-zinc-800/50"
      >
        <div className="w-10 h-10 rounded-full bg-green-900/40 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </div>
        <div className="min-w-0 text-left">
          <p className="font-semibold text-white text-sm">Share Setlist</p>
          <p className="text-xs text-zinc-500">Formatted for the team WhatsApp</p>
        </div>
        <svg className={`w-4 h-4 text-zinc-600 ml-auto shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Optional notes per song
          </p>
          {songs.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600 w-4 shrink-0">{i + 1}</span>
              <span className="w-32 shrink-0 text-xs text-zinc-300 truncate">{s.title}</span>
              <input
                value={notes[s.id] ?? ''}
                onChange={e => setNotes(prev => ({ ...prev, [s.id]: e.target.value }))}
                placeholder="e.g. Chorus and 2nd stanza only"
                className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-700 focus:outline-none focus:border-purple-600"
              />
            </div>
          ))}

          {playlistUrl && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-zinc-400 select-none">
                <input
                  type="checkbox"
                  checked={includePlaylist}
                  onChange={e => setIncludePlaylist(e.target.checked)}
                  className="accent-green-600 w-4 h-4"
                />
                Include the YouTube practice playlist link
              </label>
              <a
                href={playlistUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto shrink-0 text-[11px] text-green-500 underline underline-offset-2"
              >
                View playlist ↗
              </a>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-zinc-400 select-none">
            <input
              type="checkbox"
              checked={includeLyrics}
              onChange={e => setIncludeLyrics(e.target.checked)}
              className="accent-green-600 w-4 h-4"
            />
            Include song lyrics (pick the sections below)
          </label>

          {includeLyrics && (
            <div className="space-y-3 rounded-xl border border-zinc-800/70 p-3">
              {loadingLyrics && <p className="text-xs text-zinc-500">Loading lyrics…</p>}
              {!loadingLyrics && lyricsBySong && songs.map(s => {
                const info = lyricsBySong[s.id]
                if (!info) {
                  return (
                    <div key={s.id}>
                      <p className="text-xs font-semibold text-zinc-500">{s.title}</p>
                      <p className="text-[11px] text-zinc-600">No chord sheet yet — no lyrics available</p>
                    </div>
                  )
                }
                const sel = selected[s.id] ?? new Set<number>()
                return (
                  <div key={s.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-xs font-semibold text-zinc-300 flex-1 min-w-0 truncate">{s.title}</p>
                      <button onClick={() => copySongLyrics(s.id, s.title)}
                        className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-semibold border transition-colors ${
                          copiedSongId === s.id
                            ? 'border-green-700 text-green-400'
                            : 'border-zinc-700 text-zinc-400'
                        }`}
                        title="Copy lyrics — selected sections, or the whole song if none selected">
                        {copiedSongId === s.id ? 'Copied ✓' : sel.size > 0 ? `Copy (${sel.size})` : 'Copy all'}
                      </button>
                      <button onClick={() => toggleAll(s.id)}
                        className="shrink-0 text-[10px] text-zinc-500 underline underline-offset-2">
                        {sel.size === info.sections.length ? 'none' : 'all'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {info.sections.map((sec, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleSection(s.id, idx)}
                          className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                            sel.has(idx)
                              ? 'bg-green-600 text-white'
                              : 'bg-zinc-900 border border-zinc-700 text-zinc-400'
                          }`}
                        >
                          {sec.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Live preview so what you send is never a surprise */}
          <pre className="whitespace-pre-wrap max-h-64 overflow-y-auto rounded-xl bg-black border border-zinc-800 p-3 text-[11px] leading-relaxed text-zinc-300 font-sans">
            {message}
          </pre>
          <div className="flex items-center justify-between">
            <p className={`text-[10px] ${veryLong ? 'text-amber-500' : 'text-zinc-600'}`}>
              {message.length.toLocaleString()} characters
              {veryLong ? ' — very long; WhatsApp may truncate a shared link. Use Copy instead.' : ''}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={copyMessage}
              className="px-4 py-3 rounded-xl bg-zinc-800 text-zinc-200 text-sm font-semibold active:scale-95 transition-transform"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 block text-center py-3 rounded-xl bg-green-600 text-white text-sm font-semibold active:scale-95 transition-transform"
            >
              Share on WhatsApp
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

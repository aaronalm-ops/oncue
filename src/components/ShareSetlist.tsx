'use client'

import { useMemo, useState } from 'react'

interface ShareSong { id: string; title: string; scale: string | null }

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

/**
 * Share the setlist to WhatsApp in the team's message format, with optional
 * per-song notes ("Chorus and 2nd stanza only") and the practice playlist.
 * If every song is in the same key, one "All on the Key X" line replaces the
 * per-song keys.
 */
export default function ShareSetlist({ serviceDate, dayOfWeek, songs, playlistUrl }: Props) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [includePlaylist, setIncludePlaylist] = useState(playlistUrl !== null)

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
    return lines.join('\n')
  }, [songs, notes, uniformKey, includePlaylist, playlistUrl, serviceDate, dayOfWeek])

  if (songs.length === 0) return null

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
            <label className="flex items-center gap-2 text-xs text-zinc-400 select-none">
              <input
                type="checkbox"
                checked={includePlaylist}
                onChange={e => setIncludePlaylist(e.target.checked)}
                className="accent-green-600 w-4 h-4"
              />
              Include the YouTube practice playlist link
            </label>
          )}

          {/* Live preview so what you send is never a surprise */}
          <pre className="whitespace-pre-wrap rounded-xl bg-black border border-zinc-800 p-3 text-[11px] leading-relaxed text-zinc-300 font-sans">
            {message}
          </pre>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-3 rounded-xl bg-green-600 text-white text-sm font-semibold active:scale-95 transition-transform"
          >
            Share on WhatsApp
          </a>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SongPicker, { type PickedSong } from '@/components/SongPicker'

interface Leader { id: string; name: string; isLeader: boolean }

interface Song {
  id?: string
  title: string
  scale: string | null
  order_index: number
  library_song_id?: string | null // set for a newly added library song
  hasChords?: boolean
}

interface Props {
  serviceId: string
  serviceDate: string
  leaders: Leader[]
  initialLeaderId: string | null
  initialSongs: Song[]
}

function move<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next.map((s, i) => ({ ...s, order_index: i }))
}

export default function EditSetlistClient({ serviceId, serviceDate, leaders, initialLeaderId, initialSongs }: Props) {
  const [songs, setSongs] = useState<Song[]>(
    initialSongs.map((s, i) => ({ ...s, order_index: i }))
  )
  const [leaderId, setLeaderId] = useState(initialLeaderId ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function updateSong(index: number, patch: Partial<Song>) {
    setSongs(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
    setDirty(true)
  }

  function removeSong(index: number) {
    setSongs(prev => move(prev.filter((_, i) => i !== index), 0, 0).map((s, i) => ({ ...s, order_index: i })))
    setDirty(true)
  }

  function moveUp(index: number) {
    if (index === 0) return
    setSongs(prev => move(prev, index, index - 1))
    setDirty(true)
  }

  function moveDown(index: number) {
    if (index === songs.length - 1) return
    setSongs(prev => move(prev, index, index + 1))
    setDirty(true)
  }

  function addPicked(s: PickedSong) {
    setSongs(prev => [...prev, {
      title: s.title, scale: null, order_index: prev.length,
      library_song_id: s.library_song_id, hasChords: s.hasChords,
    }])
    setDirty(true)
  }

  async function save() {
    const invalid = songs.some(s => !s.title.trim())
    if (invalid) { setError('All songs need a title.'); return }

    setSaving(true)
    setError(null)

    // Worship leader goes through an RPC (worship_leaders can't UPDATE services
    // via RLS). Only call it when it actually changed.
    if (leaderId !== (initialLeaderId ?? '')) {
      const { error: wlErr } = await createClient().rpc('set_worship_leader', {
        p_service_id: serviceId,
        p_worship_leader: leaderId || null,
      })
      if (wlErr) { setSaving(false); setError(wlErr.message); return }
    }

    const res = await fetch(`/api/services/${serviceId}/songs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs }),
    })
    setSaving(false)

    if (res.ok) {
      setDirty(false)
      router.push(`/services/${serviceId}`)
          } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to save')
    }
  }

  const date = new Date(serviceDate + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-40">

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <Link
            href={`/services/${serviceId}`}
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors shrink-0"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Edit Setlist</h1>
            <p className="text-xs text-zinc-500">{dateLabel}</p>
          </div>
        </div>

        {/* Worship leader — assign or change any time (e.g. once they register) */}
        <div className="mt-6">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Worship leader</label>
          <select
            value={leaderId}
            onChange={e => { setLeaderId(e.target.value); setDirty(true) }}
            className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-600"
          >
            <option value="">Unassigned — set later</option>
            {leaders.map(l => (
              <option key={l.id} value={l.id}>{l.name}{l.isLeader ? ' ★' : ''}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-950/40 border border-red-900/40 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Song list */}
        <div className="mt-6 flex flex-col gap-2">
          {songs.map((song, i) => (
            <div key={song.id ?? `new-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-xs text-zinc-600 w-5 text-center shrink-0">{i + 1}</span>
                <input
                  type="text"
                  value={song.title}
                  onChange={e => updateSong(i, { title: e.target.value })}
                  placeholder="Song title"
                  className="flex-1 bg-transparent text-sm font-semibold text-white placeholder:text-zinc-700 focus:outline-none"
                />
                <input
                  type="text"
                  value={song.scale ?? ''}
                  onChange={e => updateSong(i, { scale: e.target.value || null })}
                  placeholder="Key"
                  className="w-14 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-center text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600 transition-colors"
                />
                {song.hasChords === false && (
                  <span className="shrink-0 text-[10px] font-semibold text-amber-500" title="No chord sheet yet">needs chords</span>
                )}
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 active:bg-zinc-800 disabled:opacity-20 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => moveDown(i)}
                  disabled={i === songs.length - 1}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 active:bg-zinc-800 disabled:opacity-20 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="w-px h-4 bg-zinc-800 mx-1" />
                <button
                  onClick={() => removeSong(i)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-600 active:text-red-400 active:bg-zinc-800 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add song — search title or lyrics; repeating songs pre-fill on save */}
        <div className="mt-3">
          <SongPicker onPick={addPicked} />
        </div>
      </div>

      {/* Fixed save bar */}
      {dirty && (
        <div className="fixed bottom-0 inset-x-0 p-4 bg-black/80 backdrop-blur-sm border-t border-zinc-900">
          <div className="max-w-lg mx-auto">
            <button
              onClick={save}
              disabled={saving}
              className="w-full py-3.5 rounded-2xl bg-purple-600 text-white font-semibold text-base active:bg-purple-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

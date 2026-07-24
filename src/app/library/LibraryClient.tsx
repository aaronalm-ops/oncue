'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AppRole } from '@/lib/types'
import ChordUploadQueue, { type PendingUpload, type AttachIntent } from '@/components/ChordUploadQueue'

interface SongVersion {
  id: string
  label: string
  stored_key: string | null
  reviewed_at: string | null
}

interface LibrarySong {
  id: string
  title: string
  artist: string | null
  created_at: string
  song_versions: SongVersion[]
}

interface Props {
  songs: LibrarySong[]
  role: AppRole
  pendingUploads: PendingUpload[]
  attachIntent?: AttachIntent | null
}

export default function LibraryClient({ songs: initial, role, pendingUploads, attachIntent = null }: Props) {
  const [songs, setSongs] = useState(initial)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newArtist, setNewArtist] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const router = useRouter()

  // v6: every member can contribute (upload, add, correct).
  // Destructive bulk delete stays with editors.
  const canManage = true
  const canBulkDelete = role !== 'member'

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  async function bulkDelete() {
    if (selected.size === 0) return
    const n = selected.size
    if (!window.confirm(`Delete ${n} song${n === 1 ? '' : 's'} and all their chord versions? This also removes their stored PDFs and any links to services. This cannot be undone.`)) return
    setBulkDeleting(true)
    const res = await fetch('/api/library/songs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    })
    setBulkDeleting(false)
    if (res.ok) {
      setSongs(prev => prev.filter(s => !selected.has(s.id)))
      exitSelectMode()
      router.refresh()
    } else {
      const data = await res.json()
      window.alert(data.error ?? 'Delete failed')
    }
  }

  const filtered = songs.filter(s =>
    query.trim() === '' ||
    s.title.toLowerCase().includes(query.toLowerCase()) ||
    (s.artist ?? '').toLowerCase().includes(query.toLowerCase())
  )

  async function addSong() {
    if (!newTitle.trim()) return
    setAdding(true)
    setAddError(null)
    const res = await fetch('/api/library/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim(), artist: newArtist.trim() || undefined }),
    })
    setAdding(false)
    if (res.ok) {
      const { song } = await res.json()
      setSongs(prev => [...prev, { ...song, song_versions: [] }].sort((a, b) => a.title.localeCompare(b.title)))
      setNewTitle('')
      setNewArtist('')
      setShowAdd(false)
      router.push(`/library/${song.id}`)
    } else {
      const data = await res.json()
      setAddError(data.error ?? 'Failed to add song')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link
              href="/services"
              className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors"
            >
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold tracking-tight">Chords Library</h1>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              {canBulkDelete && songs.length > 0 && (
                <button
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
                    selectMode ? 'bg-white text-black' : 'bg-zinc-900 border border-zinc-800 text-zinc-400'
                  }`}
                >
                  {selectMode ? 'Done' : 'Select'}
                </button>
              )}
              {!selectMode && (
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 text-white text-sm font-semibold active:bg-purple-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Song
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bulk chord upload + confirm queue */}
        {canManage && (
          <ChordUploadQueue
            initialUploads={pendingUploads}
            librarySongs={songs.map(s => ({ id: s.id, title: s.title, artist: s.artist }))}
            attachIntent={attachIntent}
          />
        )}

        {/* Search */}
        <div className="relative mb-5">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search songs…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600 transition-colors"
          />
        </div>

        {/* Song list */}
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-zinc-600 text-sm">
              {query ? 'No songs match your search.' : 'No songs in the library yet.'}
            </p>
            {canManage && !query && (
              <button onClick={() => setShowAdd(true)} className="mt-3 text-purple-400 text-sm">
                Add the first song →
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map(song => {
              const reviewedCount = song.song_versions.filter(v => v.reviewed_at).length
              const totalVersions = song.song_versions.length
              const isSelected = selected.has(song.id)
              const inner = (
                <>
                  {selectMode && (
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-purple-600 border-purple-600' : 'border-zinc-600'
                    }`}>
                      {isSelected && (
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{song.title}</p>
                    {song.artist && <p className="text-xs text-zinc-500 mt-0.5 truncate">{song.artist}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {totalVersions > 0 ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        reviewedCount === totalVersions
                          ? 'bg-green-900/40 text-green-400 border border-green-800/40'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {reviewedCount === totalVersions ? '✓ Ready' : `${reviewedCount}/${totalVersions} reviewed`}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-950 text-amber-500 border border-amber-900/50">Needs chords</span>
                    )}
                  </div>
                  {!selectMode && (
                    <svg className="w-4 h-4 text-zinc-700 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </>
              )
              const rowClass = `bg-zinc-900 border rounded-2xl px-4 py-3.5 flex items-center gap-3 transition-colors ${
                selectMode && isSelected ? 'border-purple-600' : 'border-zinc-800 active:bg-zinc-800'
              }`
              return selectMode ? (
                <button key={song.id} onClick={() => toggleSelected(song.id)} className={`${rowClass} text-left w-full`}>
                  {inner}
                </button>
              ) : (
                <Link key={song.id} href={`/library/${song.id}`} className={rowClass}>
                  {inner}
                </Link>
              )
            })}
          </div>
        )}

        {/* Bulk-delete bar */}
        {selectMode && (
          <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-black px-4 pt-3 pb-5">
            <div className="max-w-lg mx-auto flex items-center gap-3">
              <p className="text-sm text-zinc-400 flex-1">
                {selected.size === 0 ? 'Tap songs to select' : `${selected.size} selected`}
              </p>
              <button onClick={exitSelectMode} className="px-4 py-2.5 rounded-xl bg-zinc-800 text-zinc-300 text-sm">
                Cancel
              </button>
              <button
                onClick={bulkDelete}
                disabled={selected.size === 0 || bulkDeleting}
                className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-40 active:scale-95 transition-transform"
              >
                {bulkDeleting ? 'Deleting…' : `Delete${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add song sheet */}
      {showAdd && (
        <>
          <div className="fixed inset-0 bg-black/70 z-30" onClick={() => setShowAdd(false)} />
          <div className="fixed inset-x-4 bottom-8 z-40 bg-zinc-900 border border-zinc-700 rounded-2xl p-5">
            <h3 className="font-semibold mb-4">Add Song to Library</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Song title *"
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600 transition-colors"
              />
              <input
                type="text"
                value={newArtist}
                onChange={e => setNewArtist(e.target.value)}
                placeholder="Artist (optional)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600 transition-colors"
              />
              {addError && <p className="text-xs text-red-400">{addError}</p>}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setShowAdd(false); setAddError(null) }}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-sm text-white active:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addSong}
                disabled={!newTitle.trim() || adding}
                className="flex-1 py-2.5 rounded-xl bg-purple-600 text-sm text-white font-semibold active:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {adding ? 'Adding…' : 'Add & Open'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

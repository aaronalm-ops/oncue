'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ChordSheetViewer from '@/components/ChordSheetViewer'

interface Version {
  id: string
  label: string
  stored_key: string | null
  bpm: number | null
  ccli_number: string | null
  reviewed_at: string | null
  content: string
}

interface Props {
  song: { id: string; title: string; artist: string | null }
  versions: Version[]
  canManage: boolean
  userId: string
  preferredKey: string | null
}

export default function SongDetailClient({ song, versions, canManage, userId, preferredKey }: Props) {
  const [openVersion, setOpenVersion] = useState<string | null>(
    versions.find(v => v.reviewed_at)?.id ?? versions[0]?.id ?? null
  )
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editingMeta, setEditingMeta] = useState(false)
  const [metaTitle, setMetaTitle] = useState(song.title)
  const [metaArtist, setMetaArtist] = useState(song.artist ?? '')
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const router = useRouter()

  async function saveMeta() {
    if (!metaTitle.trim()) { setMetaError('Title cannot be empty'); return }
    setSavingMeta(true)
    setMetaError(null)
    const res = await fetch(`/api/library/songs/${song.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: metaTitle.trim(), artist: metaArtist.trim() || null }),
    })
    setSavingMeta(false)
    if (res.ok) {
      setEditingMeta(false)
      router.refresh()
    } else {
      const data = await res.json()
      setMetaError(data.error ?? 'Failed to save')
    }
  }

  async function deleteVersion(id: string) {
    if (!window.confirm('Delete this chord version? The original PDF stays in storage.')) return
    setDeleting(id)
    const res = await fetch(`/api/library/versions/${id}`, { method: 'DELETE' })
    setDeleting(null)
    if (res.ok) router.refresh()
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">

        <div className="flex items-center gap-2 mb-1">
          <Link href="/library"
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors shrink-0"
            aria-label="Back to library">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <Link href="/"
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors shrink-0"
            aria-label="Home">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </Link>
          {editingMeta ? (
            <div className="min-w-0 ml-1 flex-1 space-y-1.5">
              <input value={metaTitle} onChange={e => setMetaTitle(e.target.value)} autoFocus
                placeholder="Song title"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm font-bold text-white focus:outline-none focus:border-purple-600" />
              <input value={metaArtist} onChange={e => setMetaArtist(e.target.value)}
                placeholder="Artist (optional)"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600" />
              {metaError && <p className="text-[11px] text-red-400">{metaError}</p>}
              <div className="flex gap-2">
                <button onClick={saveMeta} disabled={savingMeta}
                  className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-purple-600 text-white disabled:opacity-50">
                  {savingMeta ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => { setEditingMeta(false); setMetaTitle(song.title); setMetaArtist(song.artist ?? ''); setMetaError(null) }}
                  className="text-[11px] px-3 py-1 rounded-lg bg-zinc-800 text-zinc-400">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="min-w-0 ml-1 flex-1">
              <h1 className="text-xl font-bold tracking-tight truncate">{song.title}</h1>
              {song.artist && <p className="text-xs text-zinc-500 truncate">{song.artist}</p>}
            </div>
          )}
          {canManage && !editingMeta && (
            <button onClick={() => setEditingMeta(true)}
              className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 active:bg-zinc-800 transition-colors"
              aria-label="Edit song name">
              <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-5 space-y-3">
          {versions.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-zinc-600 text-sm">No chords yet for this song.</p>
              {canManage && (
                <Link href="/library" className="mt-2 inline-block text-purple-400 text-sm">
                  Upload a PDF from the library page →
                </Link>
              )}
            </div>
          )}

          {versions.map(v => (
            <div key={v.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <button
                onClick={() => setOpenVersion(o => (o === v.id ? null : v.id))}
                className="w-full px-4 py-3 flex items-center gap-2 text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{v.label}</p>
                  <p className="text-[11px] text-zinc-500">
                    {v.stored_key ? `Key ${v.stored_key}` : 'No key'}
                    {v.bpm ? ` · ${v.bpm} bpm` : ''}
                    {v.ccli_number ? ` · CCLI ${v.ccli_number}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  v.reviewed_at
                    ? 'bg-green-900/40 text-green-400 border border-green-800/40'
                    : 'bg-amber-900/40 text-amber-400 border border-amber-800/40'
                }`}>
                  {v.reviewed_at ? '✓ Reviewed' : 'Needs review'}
                </span>
                <svg className={`w-4 h-4 text-zinc-600 shrink-0 transition-transform ${openVersion === v.id ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {openVersion === v.id && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <ChordSheetViewer
                    body={v.content}
                    storedKey={v.stored_key}
                    initialKey={preferredKey}
                    librarySongId={song.id}
                    userId={userId}
                  />
                  {canManage && (
                    <div className="mt-4 flex gap-2">
                      <Link href={`/library/${song.id}/version/${v.id}`}
                        className="flex-1 text-center py-2 rounded-xl bg-purple-600 text-white text-sm font-semibold active:scale-95 transition-transform">
                        {v.reviewed_at ? 'Edit' : 'Review & approve'}
                      </Link>
                      <button onClick={() => deleteVersion(v.id)} disabled={deleting === v.id}
                        className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm disabled:opacity-50">
                        {deleting === v.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

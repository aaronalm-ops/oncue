'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface PendingUpload {
  id: string
  original_filename: string
  status: 'parsed' | 'scan' | 'failed'
  draft_title: string | null
  draft_artist: string | null
  draft_key: string | null
  draft_bpm: number | null
  section_count: number
  warnings: string[]
}

export interface MatchSuggestion { id: string; title: string; artist: string | null }

interface CardState {
  upload: PendingUpload
  suggestions: MatchSuggestion[]
  title: string
  artist: string
  key: string
  bpm: string
  matchId: string | null // null = create new song
  busy: boolean
  error: string | null
}

interface Props {
  initialUploads: PendingUpload[]
  librarySongs: MatchSuggestion[]
}

function toCard(u: PendingUpload, suggestions: MatchSuggestion[]): CardState {
  return {
    upload: u,
    suggestions,
    title: u.draft_title ?? '',
    artist: u.draft_artist ?? '',
    key: u.draft_key ?? '',
    bpm: u.draft_bpm != null ? String(u.draft_bpm) : '',
    matchId: suggestions.length > 0 ? suggestions[0].id : null,
    busy: false,
    error: null,
  }
}

function suggestFor(title: string, songs: MatchSuggestion[]): MatchSuggestion[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const target = norm(title)
  if (!target) return []
  return songs
    .map(s => {
      const n = norm(s.title)
      const exact = n === target
      const contains = !exact && (n.includes(target) || target.includes(n)) && Math.min(n.length, target.length) >= 5
      return { s, score: exact ? 2 : contains ? 1 : 0 }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.s)
    .slice(0, 5)
}

export default function ChordUploadQueue({ initialUploads, librarySongs }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [cards, setCards] = useState<CardState[]>(
    initialUploads.map(u => toCard(u, suggestFor(u.draft_title ?? '', librarySongs)))
  )
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const router = useRouter()

  function patchCard(id: string, patch: Partial<CardState>) {
    setCards(prev => prev.map(c => (c.upload.id === id ? { ...c, ...patch } : c)))
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setUploadErrors([])
    const errs: string[] = []

    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length })
      const formData = new FormData()
      formData.append('file', files[i])
      try {
        const res = await fetch('/api/library/uploads', { method: 'POST', body: formData })
        const data = await res.json()
        if (!res.ok) {
          errs.push(`${files[i].name}: ${data.error ?? 'Upload failed'}`)
        } else {
          const u = data.upload as PendingUpload
          const sugg = (data.suggestions ?? []) as MatchSuggestion[]
          setCards(prev => [...prev, toCard(u, sugg)])
        }
      } catch {
        errs.push(`${files[i].name}: network error`)
      }
    }

    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
    if (errs.length) setUploadErrors(errs)
  }

  async function confirm(card: CardState) {
    if (!card.title.trim()) {
      patchCard(card.upload.id, { error: 'Title is required' })
      return
    }
    patchCard(card.upload.id, { busy: true, error: null })
    const res = await fetch(`/api/library/uploads/${card.upload.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: card.title.trim(),
        artist: card.artist.trim() || null,
        key: card.key.trim() || null,
        bpm: card.bpm.trim() ? parseInt(card.bpm, 10) : null,
        library_song_id: card.matchId,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      patchCard(card.upload.id, { busy: false, error: data.error ?? 'Failed' })
      return
    }
    setCards(prev => prev.filter(c => c.upload.id !== card.upload.id))
    router.refresh()
  }

  async function discard(card: CardState) {
    patchCard(card.upload.id, { busy: true, error: null })
    const res = await fetch(`/api/library/uploads/${card.upload.id}`, { method: 'DELETE' })
    if (res.ok) setCards(prev => prev.filter(c => c.upload.id !== card.upload.id))
    else {
      const data = await res.json()
      patchCard(card.upload.id, { busy: false, error: data.error ?? 'Failed to discard' })
    }
  }

  async function confirmAllClean() {
    for (const card of cards.filter(c => c.upload.status === 'parsed' && !c.busy)) {
      await confirm(card)
    }
  }

  const cleanCount = cards.filter(c => c.upload.status === 'parsed').length
  const uploading = progress !== null

  return (
    <div className="mb-6">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleFiles}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-purple-800/60 text-purple-300 text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m5 12V8m0 0l-4 4m4-4l4 4" />
          </svg>
          {uploading ? `Reading ${progress!.current} / ${progress!.total}…` : 'Upload chord PDFs'}
        </button>
        {cards.length > 1 && cleanCount > 1 && !uploading && (
          <button onClick={confirmAllClean}
            className="px-3 py-1.5 rounded-xl bg-purple-600 text-white text-sm font-semibold active:scale-95 transition-transform">
            Confirm all ({cleanCount})
          </button>
        )}
      </div>

      {uploadErrors.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {uploadErrors.map((err, i) => <p key={i} className="text-red-400 text-xs">{err}</p>)}
        </div>
      )}

      {cards.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-zinc-500 font-medium">
            {cards.length} upload{cards.length === 1 ? '' : 's'} awaiting confirmation
          </p>
          {cards.map(card => (
            <div key={card.upload.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs text-zinc-500 truncate flex-1">{card.upload.original_filename}</p>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  card.upload.status === 'parsed'
                    ? 'bg-green-900/40 text-green-400'
                    : card.upload.status === 'scan'
                      ? 'bg-amber-900/40 text-amber-400'
                      : 'bg-red-900/40 text-red-400'
                }`}>
                  {card.upload.status === 'parsed'
                    ? `Parsed — ${card.upload.section_count} section${card.upload.section_count === 1 ? '' : 's'}`
                    : card.upload.status === 'scan' ? 'Scan — needs paste' : 'Extraction failed'}
                </span>
              </div>

              {card.upload.warnings.length > 0 && (
                <p className="text-[11px] text-amber-500/90">{card.upload.warnings.join(' · ')}</p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <input value={card.title} onChange={e => patchCard(card.upload.id, { title: e.target.value })}
                  placeholder="Title *"
                  className="col-span-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600" />
                <input value={card.artist} onChange={e => patchCard(card.upload.id, { artist: e.target.value })}
                  placeholder="Artist"
                  className="col-span-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600" />
                <input value={card.key} onChange={e => patchCard(card.upload.id, { key: e.target.value })}
                  placeholder="Key (e.g. G)"
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600" />
                <input value={card.bpm} onChange={e => patchCard(card.upload.id, { bpm: e.target.value.replace(/\D/g, '') })}
                  placeholder="BPM" inputMode="numeric"
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600" />
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Adds to</label>
                <select
                  value={card.matchId ?? ''}
                  onChange={e => patchCard(card.upload.id, { matchId: e.target.value || null })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-600"
                >
                  <option value="">New song: “{card.title || 'Untitled'}”</option>
                  {(card.suggestions.length ? card.suggestions : librarySongs).map(s => (
                    <option key={s.id} value={s.id}>
                      Existing: {s.title}{s.artist ? ` — ${s.artist}` : ''}
                    </option>
                  ))}
                </select>
                {card.suggestions.length > 0 && card.matchId === card.suggestions[0].id && (
                  <p className="mt-1 text-[11px] text-purple-400">Matched an existing song — will be added as a new version</p>
                )}
              </div>

              {card.error && <p className="text-xs text-red-400">{card.error}</p>}

              <div className="flex gap-2">
                <button onClick={() => discard(card)} disabled={card.busy}
                  className="px-3 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-sm disabled:opacity-50">
                  Discard
                </button>
                <button onClick={() => confirm(card)} disabled={card.busy}
                  className="flex-1 py-2 rounded-xl bg-purple-600 text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform">
                  {card.busy ? 'Saving…' : card.upload.status === 'scan' ? 'Confirm (paste chords next)' : 'Confirm'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

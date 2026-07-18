'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ChordSheet from '@/components/ChordSheet'

interface Props {
  songId: string
  songTitle: string
  version: {
    id: string
    label: string
    stored_key: string | null
    bpm: number | null
    reviewed_at: string | null
    content: string
  }
  pdfUrl: string | null
}

type Pane = 'edit' | 'preview' | 'pdf'

export default function VersionEditorClient({ songId, songTitle, version, pdfUrl }: Props) {
  const draftKey = `oncue-chord-draft:${version.id}`
  const [content, setContent] = useState(version.content)
  const [storedKey, setStoredKey] = useState(version.stored_key ?? '')
  const [bpm, setBpm] = useState(version.bpm != null ? String(version.bpm) : '')
  const [pane, setPane] = useState<Pane>(version.content ? 'preview' : 'edit')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'approve' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const router = useRouter()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore an unsaved local draft (crash/navigation recovery)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved !== null && saved !== version.content) {
        setContent(saved)
        setDirty(true)
        setRestoredDraft(true)
      }
    } catch { /* private mode */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave draft locally (debounced)
  function onEdit(next: string) {
    setContent(next)
    setDirty(true)
    setRestoredDraft(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(draftKey, next) } catch { /* full/private */ }
    }, 800)
  }

  // Warn before leaving with unsaved changes
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault() }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  async function save() {
    setBusy('save'); setError(null); setNotice(null)
    const res = await fetch(`/api/library/versions/${version.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        stored_key: storedKey.trim() || null,
        bpm: bpm.trim() ? parseInt(bpm, 10) : null,
      }),
    })
    setBusy(null)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Save failed')
      return false
    }
    setDirty(false)
    try { localStorage.removeItem(draftKey) } catch { /* noop */ }
    setNotice(version.reviewed_at ? 'Saved. Approval reset — re-approve to publish the changes.' : 'Saved.')
    return true
  }

  async function approve() {
    setBusy('approve'); setError(null); setNotice(null)
    const res = await fetch(`/api/library/versions/${version.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        stored_key: storedKey.trim() || null,
        bpm: bpm.trim() ? parseInt(bpm, 10) : null,
      }),
    })
    setBusy(null)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Approve failed')
      return
    }
    setDirty(false)
    try { localStorage.removeItem(draftKey) } catch { /* noop */ }
    router.push(`/library/${songId}`)
    router.refresh()
  }

  const panes: { id: Pane; label: string; show: boolean }[] = [
    { id: 'edit', label: 'Edit', show: true },
    { id: 'preview', label: 'Preview', show: true },
    { id: 'pdf', label: 'PDF', show: pdfUrl !== null },
  ]

  return (
    <div className="h-screen bg-black text-white flex flex-col">

      {/* Header */}
      <div className="shrink-0 border-b border-zinc-800 px-4 py-2.5 flex items-center gap-3">
        <Link href={`/library/${songId}`}
          onClick={e => { if (dirty && !window.confirm('You have unsaved changes. Leave anyway?')) e.preventDefault() }}
          className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{songTitle}</p>
          <p className="text-[11px] text-zinc-500 truncate">{version.label}{dirty ? ' · unsaved changes' : ''}</p>
        </div>
        <input value={storedKey} onChange={e => { setStoredKey(e.target.value); setDirty(true) }}
          placeholder="Key" size={3}
          className="w-14 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-center text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600" />
        <input value={bpm} onChange={e => { setBpm(e.target.value.replace(/\D/g, '')); setDirty(true) }}
          placeholder="BPM" inputMode="numeric" size={3}
          className="w-14 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-center text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600" />
      </div>

      {restoredDraft && (
        <div className="shrink-0 bg-amber-950/60 border-b border-amber-900 px-4 py-1.5 flex items-center gap-2">
          <p className="text-[11px] text-amber-300 flex-1">Restored an unsaved local draft.</p>
          <button
            onClick={() => { setContent(version.content); setDirty(false); setRestoredDraft(false); try { localStorage.removeItem(draftKey) } catch { /* noop */ } }}
            className="text-[11px] text-amber-400 underline">
            Discard draft
          </button>
        </div>
      )}

      {/* Pane switcher (phones see one pane; desktop sees edit+preview side by side) */}
      <div className="shrink-0 px-4 py-2 flex items-center gap-1.5 lg:hidden">
        {panes.filter(p => p.show).map(p => (
          <button key={p.id} onClick={() => setPane(p.id)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold ${
              pane === p.id ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-2">
        {/* Editor */}
        <div className={`h-full min-h-0 flex-col px-4 pb-3 lg:flex lg:border-r lg:border-zinc-800 ${pane === 'edit' ? 'flex' : 'hidden'}`}>
          <p className="shrink-0 text-[10px] text-zinc-600 pb-1.5">
            <code className="text-zinc-500"># Section</code> · <code className="text-zinc-500">&gt; Chorus x2</code> flow · <code className="text-zinc-500">[G]</code>chords inline
          </p>
          <textarea
            value={content}
            onChange={e => onEdit(e.target.value)}
            spellCheck={false}
            placeholder={'# Verse 1\n[G]Praise Him you [C]heavens…\n\n(paste chords here for scanned PDFs)'}
            className="flex-1 min-h-0 w-full resize-none bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-purple-700"
          />
        </div>

        {/* Preview */}
        <div className={`h-full min-h-0 overflow-y-auto px-4 pb-3 lg:block ${pane === 'preview' ? 'block' : 'hidden'}`}>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <ChordSheet body={content} />
          </div>
        </div>

        {/* PDF (mobile-only pane; desktop users open it in a tab) */}
        {pdfUrl && (
          <div className={`h-full min-h-0 px-4 pb-3 lg:hidden ${pane === 'pdf' ? 'block' : 'hidden'}`}>
            <iframe src={pdfUrl} className="w-full h-full rounded-xl border border-zinc-800 bg-white" title="Original PDF" />
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 border-t border-zinc-800 px-4 py-3">
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        {notice && <p className="text-xs text-green-400 mb-2">{notice}</p>}
        <div className="flex items-center gap-2">
          {pdfUrl && (
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
              className="hidden lg:block px-3 py-2.5 rounded-xl bg-zinc-900 text-zinc-400 text-sm">
              Open PDF
            </a>
          )}
          <button onClick={save} disabled={busy !== null}
            className="flex-1 py-2.5 rounded-xl bg-zinc-800 text-white text-sm font-semibold disabled:opacity-50">
            {busy === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button onClick={approve} disabled={busy !== null || !content.trim()}
            className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold disabled:opacity-40 active:scale-95 transition-transform">
            {busy === 'approve' ? 'Approving…' : version.reviewed_at ? 'Re-approve' : 'Approve & publish'}
          </button>
        </div>
      </div>
    </div>
  )
}

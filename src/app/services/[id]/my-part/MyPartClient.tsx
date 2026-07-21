'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import ChordsPane from '@/components/ChordsPane'
import type { SongChordsData } from '@/lib/chords/service-chords'

interface Instruction { id: string; instrument: string; text: string; is_intro: boolean }
interface Section { id: string; order_index: number; label: string; comments: string; instructions: Instruction[] }
interface Song { id: string; order_index: number; title: string; scale: string | null; medley_group: string | null; reference_links: string[]; sections: Section[] }
interface UserNote { id: string; section_id: string; instrument: string; note_text: string }

interface Props {
  serviceId: string
  songs: Song[]
  instruments: string[]
  userInstrument: string | null
  userId: string
  initialNotes: UserNote[]
  chordsBySongId: Record<string, SongChordsData>
  prefsByLibraryId: Record<string, string>
  canMapSections: boolean
  preferredKey: string | null // global transpose preference; null = actual
}

// Extracted to top-level so it never remounts on parent re-render
function NoteEditor({ initialValue, onSave, onCancel, hc, saving }: {
  initialValue: string
  onSave: (text: string) => void
  onCancel: () => void
  hc: boolean
  saving: boolean
}) {
  const [draft, setDraft] = useState(initialValue)
  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        className={`w-full rounded-lg px-3 py-2 text-xs resize-none focus:outline-none ${
          hc ? 'bg-white border border-zinc-400 text-black' : 'bg-zinc-800 text-white border border-zinc-700'
        }`}
        rows={3}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Your note…"
        autoFocus
      />
      <div className="flex gap-2">
        <button onClick={() => onSave(draft)} disabled={saving}
          className="text-[10px] font-semibold px-3 py-1 rounded-lg bg-white text-black disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel}
          className={`text-[10px] font-semibold px-3 py-1 rounded-lg ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-zinc-300'}`}>Cancel</button>
      </div>
    </div>
  )
}

function SectionCard({ section, viewInstrument, hc, fg, dim, cardBg, note, isEditing, noteExpanded,
  saving, onToggleNote, onStartEdit, onSaveNote, onCancelEdit }: {
  section: Section
  viewInstrument: string
  hc: boolean; fg: string; dim: string; cardBg: string
  note: string | undefined
  isEditing: boolean
  noteExpanded: boolean
  saving: boolean
  onToggleNote: () => void
  onStartEdit: () => void
  onSaveNote: (text: string) => void
  onCancelEdit: () => void
}) {
  const instr = section.instructions.find(i => i.instrument === viewInstrument)

  return (
    <div className={`rounded-xl px-4 py-3 ${cardBg} ${instr?.is_intro ? 'border-2 border-orange-500' : ''}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-sm font-bold uppercase tracking-wide ${fg}`}>{section.label}</span>
        {instr?.is_intro && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-500 text-white">INTRO</span>
        )}
      </div>

      <p className={`text-sm leading-snug ${fg}`}>{instr?.text || <span className={dim}>—</span>}</p>

      {section.comments && (
        <div className="mt-2">
          <button onClick={onToggleNote}
            className={`flex items-center gap-1 text-[10px] font-medium ${dim}`}>
            <svg className={`w-3 h-3 transition-transform ${noteExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Conductor notes
          </button>
          {noteExpanded && (
            <p className={`mt-1.5 text-xs leading-relaxed ${hc ? 'text-zinc-600' : 'text-zinc-400'}`}>{section.comments}</p>
          )}
        </div>
      )}

      {isEditing ? (
        <NoteEditor
          initialValue={note ?? ''}
          onSave={onSaveNote}
          onCancel={onCancelEdit}
          hc={hc}
          saving={saving}
        />
      ) : (
        <button
          onClick={onStartEdit}
          className={`mt-2 text-[10px] flex items-center gap-1 ${note ? (hc ? 'text-zinc-700' : 'text-zinc-300') : dim}`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          {note || 'Add note'}
        </button>
      )}
    </div>
  )
}

function SongBlock({ song, viewInstrument, hc, fg, dim, cardBg, notes, editingNote, openNotes,
  saving, onToggleNote, onStartEdit, onSaveNote, onCancelEdit, compact }: {
  song: Song
  viewInstrument: string
  hc: boolean; fg: string; dim: string; cardBg: string
  notes: Record<string, string>
  editingNote: string | null
  openNotes: Record<string, boolean>
  saving: boolean
  onToggleNote: (sectionId: string) => void
  onStartEdit: (key: string) => void
  onSaveNote: (sectionId: string, text: string) => void
  onCancelEdit: () => void
  compact?: boolean
}) {
  return (
    <div className={`space-y-2 ${compact ? 'pt-6' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`font-bold text-sm ${fg}`}>{song.title}</span>
        {song.scale && (
          <span className={`text-xs font-black px-2.5 py-0.5 rounded-lg ${hc ? 'bg-black text-white' : 'bg-purple-600 text-white'}`}>
            {song.scale}
          </span>
        )}
        {song.medley_group && <span className={`text-[10px] ${dim}`}>MEDLEY</span>}
        {song.reference_links[0] && (
          <a href={song.reference_links[0]} target="_blank" rel="noopener noreferrer"
            className={`ml-auto ${dim}`} aria-label="Reference track">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.38a8.16 8.16 0 004.77 1.52V7.45a4.85 4.85 0 01-1-.76z"/>
            </svg>
          </a>
        )}
      </div>
      {song.sections.map(section => {
        const key = `${section.id}:${viewInstrument}`
        return (
          <SectionCard
            key={section.id}
            section={section}
            viewInstrument={viewInstrument}
            hc={hc} fg={fg} dim={dim} cardBg={cardBg}
            note={notes[key]}
            isEditing={editingNote === key}
            noteExpanded={openNotes[section.id] ?? false}
            saving={saving}
            onToggleNote={() => onToggleNote(section.id)}
            onStartEdit={() => onStartEdit(key)}
            onSaveNote={(text) => onSaveNote(section.id, text)}
            onCancelEdit={onCancelEdit}
          />
        )
      })}
    </div>
  )
}

export default function MyPartClient({ serviceId, songs, instruments, userInstrument, userId, initialNotes, chordsBySongId, prefsByLibraryId, canMapSections, preferredKey }: Props) {
  const [viewInstrument, setViewInstrument] = useState(userInstrument ?? instruments[0] ?? '')
  const [layout, setLayout] = useState<'song' | 'scroll'>('song')
  const [activeSongIdx, setActiveSongIdx] = useState(0)
  const [highContrast, setHighContrast] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting')
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(initialNotes.map(n => [`${n.section_id}:${n.instrument}`, n.note_text]))
  )
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({})

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const isLiveRef = useRef(false)
  const activeSongIdxRef = useRef(0)
  const [paneIdx, setPaneIdx] = useState(0) // 0 = part, 1 = chords (phone swipe)
  const swipeRef = useRef<HTMLDivElement | null>(null)

  const hasAnyChords = songs.some(s => chordsBySongId[s.id])

  function onSwipeScroll() {
    const el = swipeRef.current
    if (!el || el.clientWidth === 0) return
    setPaneIdx(Math.round(el.scrollLeft / el.clientWidth))
  }

  function scrollToPane(idx: number) {
    const el = swipeRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' })
  }

  // Rolling swipe: at either edge, swiping "past the end" wraps to the other
  // pane — so either direction always switches, no dead ends.
  const touchStartRef = useRef<{ x: number; y: number; left: number } | null>(null)
  function onPaneTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY, left: swipeRef.current?.scrollLeft ?? 0 }
  }
  function onPaneTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current
    touchStartRef.current = null
    const el = swipeRef.current
    if (!start || !el) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    const max = el.scrollWidth - el.clientWidth
    if (max <= 0) return
    if (dx > 0 && start.left <= 4) el.scrollTo({ left: max, behavior: 'smooth' })
    else if (dx < 0 && start.left >= max - 4) el.scrollTo({ left: 0, behavior: 'smooth' })
  }

  // Keep refs in sync
  useEffect(() => { isLiveRef.current = isLive }, [isLive])
  useEffect(() => { activeSongIdxRef.current = activeSongIdx }, [activeSongIdx])

  function getClient() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  // Persist stage-contrast preference across sessions
  useEffect(() => {
    setHighContrast(localStorage.getItem('oncue-stage') === '1')
  }, [])
  function toggleContrast() {
    setHighContrast(h => {
      localStorage.setItem('oncue-stage', h ? '0' : '1')
      return !h
    })
  }

  // Navigate to a song index and broadcast if live
  const goToSong = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(songs.length - 1, idx))
    setActiveSongIdx(clamped)
    if (isLiveRef.current) {
      // Supabase builders are lazy thenables — without .then()/await the write
      // is never sent, so "Go Live" silently broadcast nothing. Fire-and-forget.
      getClient().from('session_state').upsert({
        service_id: serviceId,
        current_song_index: clamped,
        current_section_index: 0,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }, { onConflict: 'service_id' }).then(
        ({ error }) => { if (error) console.error('[my-part] go-live broadcast failed', error) },
        (e) => console.error('[my-part] go-live broadcast failed', e),
      )
    }
  }, [serviceId, songs.length, userId])

  // Realtime subscription when live
  useEffect(() => {
    if (!isLive) {
      channelRef.current?.unsubscribe()
      channelRef.current = null
      return
    }

    let retryTimeout: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    setLiveStatus('connecting')

    // session_state can point past the current chart after a shrink — clamp on
    // receipt so songs[activeSongIdx] can never be undefined.
    const applyIndex = (idx: number | undefined) => {
      if (typeof idx !== 'number') return
      setActiveSongIdx(Math.max(0, Math.min(songs.length - 1, idx)))
    }

    // One retry timer only, and — unlike the old code, which had no status
    // callback at all — CLOSED/error now drive the LIVE badge and reconnect.
    function scheduleReconnect() {
      if (cancelled || retryTimeout) return
      retryTimeout = setTimeout(() => {
        retryTimeout = undefined
        if (cancelled) return
        if (channelRef.current) getClient().removeChannel(channelRef.current)
        subscribe()
      }, 3000)
    }

    function subscribe() {
      if (cancelled) return
      let active = true
      const channel = getClient()
        .channel(`go-live:${serviceId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'session_state', filter: `service_id=eq.${serviceId}` },
          (payload) => {
            const state = payload.new as { current_song_index?: number; updated_by?: string }
            // Don't apply our own broadcasts
            if (state.updated_by === userId) return
            applyIndex(state.current_song_index)
          }
        )
        .subscribe((status) => {
          if (cancelled || !active) return
          if (status === 'SUBSCRIBED') {
            if (retryTimeout) { clearTimeout(retryTimeout); retryTimeout = undefined }
            setLiveStatus('live')
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setLiveStatus(status === 'CLOSED' ? 'offline' : 'reconnecting')
            active = false
            scheduleReconnect()
          }
        })
      channelRef.current = channel
    }

    subscribe()

    return () => {
      cancelled = true
      if (retryTimeout) clearTimeout(retryTimeout)
      channelRef.current?.unsubscribe()
      channelRef.current = null
    }
  }, [isLive, serviceId, userId, songs.length])

  // Pedal / keyboard navigation (always registered, only acts when live)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!isLiveRef.current) return
      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        goToSong(activeSongIdxRef.current + 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        goToSong(activeSongIdxRef.current - 1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goToSong])

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  function handleInstrumentChange(instr: string) {
    setViewInstrument(instr)
    // Lazy builder — must call .then() or the instrument preference never saves.
    getClient().from('profiles').update({ instrument: instr }).eq('id', userId).then(
      ({ error }) => { if (error) console.error('[my-part] instrument save failed', error) },
      (e) => console.error('[my-part] instrument save failed', e),
    )
  }

  async function saveNote(sectionId: string, text: string) {
    const key = `${sectionId}:${viewInstrument}`
    const trimmed = text.trim()
    setSavingNote(true)
    if (trimmed) {
      await getClient().from('user_notes').upsert({
        user_id: userId, section_id: sectionId, instrument: viewInstrument, note_text: trimmed,
      }, { onConflict: 'user_id,section_id,instrument' })
      setNotes(prev => ({ ...prev, [key]: trimmed }))
    } else {
      await getClient().from('user_notes').delete()
        .eq('user_id', userId).eq('section_id', sectionId).eq('instrument', viewInstrument)
      setNotes(prev => { const n = { ...prev }; delete n[key]; return n })
    }
    setSavingNote(false)
    setEditingNote(null)
  }

  const hc = highContrast
  const bg = hc ? 'bg-white' : 'bg-black'
  const fg = hc ? 'text-black' : 'text-white'
  const dim = hc ? 'text-zinc-500' : 'text-zinc-500'
  const cardBg = hc ? 'bg-zinc-100 border border-zinc-200' : 'bg-zinc-900'
  const borderB = hc ? 'border-zinc-300' : 'border-zinc-800'

  if (songs.length === 0) {
    return (
      <div className={`min-h-screen ${bg} flex flex-col items-center justify-center gap-4 px-6 text-center`}>
        <p className={`font-semibold ${fg}`}>No songs found in this service.</p>
        <p className={dim + ' text-sm'}>The chart may have been parsed incorrectly. Delete it and re-upload.</p>
        <a href="/services" className="text-purple-400 text-sm mt-2">← Back to services</a>
      </div>
    )
  }

  // Realtime clamps on receipt; this guard makes an out-of-range index
  // impossible to crash on (songs is guaranteed non-empty above).
  const activeSong = songs[Math.min(activeSongIdx, songs.length - 1)] ?? songs[0]

  const sharedProps = {
    viewInstrument,
    hc, fg, dim, cardBg,
    notes, editingNote, openNotes,
    saving: savingNote,
    onToggleNote: (sectionId: string) => setOpenNotes(prev => ({ ...prev, [sectionId]: !prev[sectionId] })),
    onStartEdit: (key: string) => setEditingNote(key),
    onSaveNote: saveNote,
    onCancelEdit: () => setEditingNote(null),
  }

  return (
    <div className={`h-screen overflow-hidden ${bg} ${fg} flex flex-col`}>
      {/* Running order strip */}
      <div className={`border-b ${borderB} shrink-0 px-3 py-2`}>
        <div className="flex flex-wrap gap-1.5 items-center">
          <Link href="/services"
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </Link>
          {songs.map((song, si) => {
            const isPast = si < activeSongIdx
            const isActive = si === activeSongIdx
            const shortTitle = song.title.length > 12 ? song.title.slice(0, 12) + '…' : song.title
            return (
              <button key={song.id}
                onClick={() => {
                  goToSong(si)
                  if (layout === 'scroll') document.getElementById(`song-${si}`)?.scrollIntoView({ behavior: 'smooth' })
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all active:scale-95 ${
                  isActive
                    ? (hc ? 'bg-black text-white' : 'bg-white text-black')
                    : isPast
                      ? (hc ? 'bg-zinc-200 text-zinc-400' : 'bg-zinc-950 text-zinc-600')
                      : (hc ? 'bg-zinc-200 text-zinc-500' : 'bg-zinc-800 text-zinc-400')
                }`}>
                {shortTitle}
                {song.scale && (
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                    isActive ? 'bg-purple-600 text-white' :
                    isPast ? (hc ? 'text-zinc-400' : 'text-zinc-700') : 'text-purple-400'
                  }`}>{song.scale}</span>
                )}
              </button>
            )
          })}
          {/* Live indicator in strip — reflects real subscription health */}
          {isLive && (
            <span className={`ml-auto shrink-0 flex items-center gap-1 text-[10px] font-bold ${
              liveStatus === 'live' ? 'text-green-400'
                : liveStatus === 'offline' ? 'text-red-400' : 'text-amber-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                liveStatus === 'live' ? 'bg-green-400 animate-pulse'
                  : liveStatus === 'offline' ? 'bg-red-500' : 'bg-amber-400 animate-pulse'
              }`} />
              {liveStatus === 'live' ? 'LIVE' : liveStatus === 'offline' ? 'OFFLINE' : 'SYNC'}
            </span>
          )}
        </div>
      </div>

      {/* Floating fullscreen button */}
      <button
        onClick={toggleFullscreen}
        className={`fixed right-3 z-20 w-8 h-8 rounded-full border flex items-center justify-center active:scale-95 transition-colors ${
          hc ? 'bg-zinc-100 border-zinc-300 text-zinc-600' : 'bg-zinc-900/90 border-zinc-700 text-zinc-400 hover:text-white'
        }`}
        style={{ bottom: '140px' }}
        aria-label="Toggle fullscreen"
      >
        {isFullscreen ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0l5 0m-5 0l0 5M15 9l5-5m0 0l-5 0m5 0l0 5M9 15l-5 5m0 0l5 0m-5 0l0-5M15 15l5 5m0 0l-5 0m5 0l0-5" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        )}
      </button>

      {/* Content — swipe between Part and Chords on phones; side-by-side on large screens */}
      <div
        ref={swipeRef}
        onScroll={hasAnyChords ? onSwipeScroll : undefined}
        onTouchStart={hasAnyChords ? onPaneTouchStart : undefined}
        onTouchEnd={hasAnyChords ? onPaneTouchEnd : undefined}
        className={`flex-1 min-h-0 ${hasAnyChords
          ? 'flex overflow-x-auto snap-x snap-mandatory no-scrollbar lg:grid lg:grid-cols-2 lg:overflow-x-hidden'
          : 'flex flex-col'}`}
      >
      <div className={hasAnyChords ? 'min-w-full lg:min-w-0 snap-center overflow-y-auto h-full' : 'flex-1 min-h-0 overflow-y-auto'}>
      <div className="px-4 pt-3 pb-36 max-w-2xl mx-auto w-full">
        {layout === 'song' ? (
          <SongBlock song={activeSong} {...sharedProps} />
        ) : (
          <div className="space-y-6">
            {songs.map((song, si) => (
              <div key={song.id} id={`song-${si}`}>
                <SongBlock song={song} {...sharedProps} compact />
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* Chords pane */}
      {hasAnyChords && (
        <div className="min-w-full lg:min-w-0 snap-center overflow-y-auto h-full lg:border-l lg:border-zinc-800">
          <div className="px-4 pt-3 pb-36 max-w-2xl mx-auto w-full">
            <ChordsPane
              key={activeSong.id}
              songTitle={activeSong.title}
              chartLabels={activeSong.sections.map(s => s.label)}
              chords={chordsBySongId[activeSong.id] ?? null}
              songScale={activeSong.scale}
              initialKey={
                chordsBySongId[activeSong.id]
                  ? prefsByLibraryId[chordsBySongId[activeSong.id].librarySongId] ?? null
                  : null
              }
              userId={userId}
              currentSectionIdx={null}
              highContrast={hc}
              canMapSections={canMapSections}
              instrument={viewInstrument}
              preferredKey={preferredKey}
            />
          </div>
        </div>
      )}
      </div>

      {/* Part / Chords pane switcher (phones) */}
      {hasAnyChords && (
        <div className="lg:hidden fixed left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full border p-0.5 bg-zinc-900/95 border-zinc-700"
          style={{ bottom: '118px' }}>
          <button onClick={() => scrollToPane(0)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${
              paneIdx === 0 ? 'bg-white text-black' : 'text-zinc-400'
            }`}>
            Part
          </button>
          <button onClick={() => scrollToPane(1)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${
              paneIdx === 1 ? 'bg-white text-black' : 'text-zinc-400'
            }`}>
            Chords
          </button>
        </div>
      )}

      {/* Fixed bottom bar */}
      <div className={`fixed bottom-0 left-0 right-0 border-t ${borderB} ${bg} px-4 pt-2.5 pb-4`}>
        {/* Instruments + Stage + Go Live */}
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
          {instruments.map(instr => (
            <button key={instr} onClick={() => handleInstrumentChange(instr)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide transition-all active:scale-95 ${
                instr === viewInstrument
                  ? (hc ? 'bg-black text-white' : 'bg-white text-black')
                  : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
              }`}>
              {instr}
            </button>
          ))}
          <button onClick={toggleContrast}
            className={`ml-auto shrink-0 rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide active:scale-95 ${hc ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-400'}`}>
            {hc ? 'Stage off' : 'Stage'}
          </button>
          <button
            onClick={() => setIsLive(l => !l)}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide active:scale-95 transition-colors ${
              isLive
                ? 'bg-green-600 text-white'
                : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
            }`}>
            {isLive ? '● Live' : 'Go Live'}
          </button>
        </div>

        {/* Prev / layout toggle / Next */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToSong(activeSongIdx - 1)}
            disabled={activeSongIdx === 0}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-30 active:scale-95 transition-all ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}>
            ← Prev
          </button>
          <button
            onClick={() => setLayout(l => l === 'song' ? 'scroll' : 'song')}
            className={`rounded-xl px-3 py-2.5 text-[10px] font-bold uppercase tracking-wide active:scale-95 transition-all ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}
            title={layout === 'song' ? 'Switch to scroll view' : 'Switch to song view'}>
            {layout === 'song' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            )}
          </button>
          <button
            onClick={() => goToSong(activeSongIdx + 1)}
            disabled={activeSongIdx === songs.length - 1}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-30 active:scale-95 transition-all ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}>
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}

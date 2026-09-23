'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import ChordsPane from '@/components/ChordsPane'
import ChordSheetViewer from '@/components/ChordSheetViewer'
import PulsePrompt from '@/components/PulsePrompt'
import { usePulsePref } from '@/lib/use-pulse'
import type { SongChordsData, SongTempoData } from '@/lib/chords/service-chords'
import { isPedalNext, isPedalPrev } from '@/lib/pedal'

interface Instruction { id: string; instrument: string; text: string; is_intro: boolean }
interface Section { id: string; order_index: number; label: string; comments: string; key_change?: string | null; instructions: Instruction[] }
interface Song { id: string; order_index: number; title: string; scale: string | null; medley_group: string | null; reference_links: string[]; sections: Section[] }
/** A user_notes row. Exactly one of section_id / song_id is set (v19). */
interface NoteRow { id: string; section_id: string | null; song_id: string | null; instrument: string; note_text: string }

/** Notes live in one flat map. Section notes key on the section id; whole-song
 *  notes get a `song:` prefix so the two can never collide. */
const songNoteKey = (songId: string, instrument: string) => `song:${songId}:${instrument}`

interface Props {
  serviceId: string
  songs: Song[]
  instruments: string[]
  userInstrument: string | null
  userId: string
  initialNotes: NoteRow[]
  /** v19: whole-song notes, for songs the chart hasn't sectioned yet. */
  initialSongNotes: NoteRow[]
  chordsBySongId: Record<string, SongChordsData>
  /** Library identity + tempo for every song, chord sheet or not. */
  tempoBySongId: Record<string, SongTempoData>
  prefsByLibraryId: Record<string, string>
  canMapSections: boolean
  preferredKey: string | null // global transpose preference; null = actual
  /** Song to open on, resolved server-side from ?song=<id>. Defaults to 0. */
  initialSongIdx?: number
  /** Which pane to land on when deep-linked from the service page's chord list. */
  initialPane?: 'part' | 'chords'
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
    <div className="relative mt-2 space-y-1.5">
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
  saving, onToggleNote, onStartEdit, onSaveNote, onCancelEdit, pulseBpm = null }: {
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
  pulseBpm?: number | null // when set, the card flashes at this bpm
}) {
  const instr = section.instructions.find(i => i.instrument === viewInstrument)

  return (
    <div className={`relative overflow-hidden rounded-xl px-4 py-3 ${cardBg} ${instr?.is_intro ? 'border-2 border-orange-500' : ''}`}>
      {pulseBpm !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-amber-500/60"
          style={{ animation: `oncue-beat ${60 / pulseBpm}s linear infinite` }}
        />
      )}
      <div className="relative flex items-center gap-2 mb-1.5">
        <span className={`text-sm font-bold uppercase tracking-wide ${fg}`}>{section.label}</span>
        {instr?.is_intro && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-500 text-white">INTRO</span>
        )}
        {section.key_change && (
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-black">
            KEY → {section.key_change}
          </span>
        )}
      </div>

      <p className={`relative text-sm leading-snug ${fg}`}>{instr?.text || <span className={dim}>—</span>}</p>

      {section.comments && (
        <div className="relative mt-2">
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
          className={`relative mt-2 text-[10px] flex items-center gap-1 ${note ? (hc ? 'text-zinc-700' : 'text-zinc-300') : dim}`}
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

function TempoChip({ tempo, canEdit, onSave, hc, dim }: {
  tempo: number | null
  canEdit: boolean
  onSave: (bpm: number | null) => void
  hc: boolean
  dim: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const taps = useRef<number[]>([])

  function commit() {
    const n = parseInt(draft, 10)
    onSave(Number.isFinite(n) && n >= 30 && n <= 300 ? n : null)
    setEditing(false)
  }

  /** Real tap tempo: tap the beat, we measure it. pointerdown (not click) so
   *  it registers instantly and never focuses/opens the keyboard. Gap > 2s
   *  starts a fresh measurement; last 8 intervals are averaged. */
  function tapBeat(e: React.PointerEvent) {
    e.preventDefault()
    const now = performance.now()
    if (taps.current.length > 0 && now - taps.current[taps.current.length - 1] > 2000) {
      taps.current = []
    }
    taps.current.push(now)
    if (taps.current.length > 9) taps.current.shift()
    if (taps.current.length >= 2) {
      const t = taps.current
      const avg = (t[t.length - 1] - t[0]) / (t.length - 1)
      const bpm = Math.min(300, Math.max(30, Math.round(60000 / avg)))
      setDraft(String(bpm))
    }
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1 shrink-0">
        <button
          onPointerDown={tapBeat}
          className="rounded-lg px-2.5 py-0.5 text-xs font-bold bg-amber-600 text-white select-none touch-none active:scale-90 active:bg-amber-500 transition-transform"
        >
          ♩ Tap
        </button>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          inputMode="numeric"
          placeholder="tap beat"
          className={`w-16 rounded-lg px-1.5 py-0.5 text-xs text-center focus:outline-none border ${
            hc ? 'bg-white border-zinc-400 text-black' : 'bg-zinc-800 border-purple-600 text-white'
          }`}
        />
        <button onClick={commit} aria-label="Save tempo"
          className="rounded-lg px-1.5 py-0.5 text-xs font-bold bg-purple-600 text-white">✓</button>
        <button onClick={() => setEditing(false)} aria-label="Cancel"
          className={`rounded-lg px-1.5 py-0.5 text-xs ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-500'}`}>✕</button>
      </span>
    )
  }

  if (tempo === null && !canEdit) return null

  return (
    <button
      onClick={() => { if (canEdit) { setDraft(tempo != null ? String(tempo) : ''); taps.current = []; setEditing(true) } }}
      className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-lg border transition-colors ${
        tempo != null
          ? (hc ? 'bg-zinc-200 border-zinc-300 text-zinc-700' : 'bg-zinc-800 border-zinc-700 text-zinc-300')
          : `border-dashed ${hc ? 'border-zinc-400 text-zinc-500' : 'border-zinc-700 ' + dim}`
      }`}
      title={canEdit ? 'Tap the beat or type a number — saved to this song for everyone' : undefined}
    >
      {tempo != null ? `${tempo} bpm` : '+ bpm'}
    </button>
  )
}

/**
 * A note that belongs to the whole song rather than one section (v19).
 *
 * Two shapes, because screen space in stage view is the scarcest thing here
 * and this card is permanent:
 *   - sections present, no note yet -> one thin dashed row (~26px)
 *   - no sections at all, or a note saved -> a full card, same visual language
 *     as SectionCard so there's nothing new to learn
 *
 * ALWAYS available, not only when sections are missing. If it appeared only for
 * unsectioned songs, a note would silently stop rendering the moment a chart
 * arrived — right after the rehearsal you wrote it in.
 */
function SongNoteCard({ note, isEditing, saving, hc, fg, dim, cardBg, forceCard,
  onStartEdit, onSaveNote, onCancelEdit, pulseBpm = null }: {
  note: string | undefined
  isEditing: boolean
  saving: boolean
  hc: boolean; fg: string; dim: string; cardBg: string
  /** true when the song has no sections — then this is the only card there is */
  forceCard: boolean
  onStartEdit: () => void
  onSaveNote: (text: string) => void
  onCancelEdit: () => void
  pulseBpm?: number | null
}) {
  if (!(forceCard || note || isEditing)) {
    return (
      <button
        onClick={onStartEdit}
        className={`w-full flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-[10px] ${
          hc ? 'border-zinc-300 text-zinc-500' : 'border-zinc-800 text-zinc-600'
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Note for the whole song
      </button>
    )
  }

  return (
    <div className={`relative overflow-hidden rounded-xl px-4 py-3 ${cardBg}`}>
      {pulseBpm !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-amber-500/60"
          style={{ animation: `oncue-beat ${60 / pulseBpm}s linear infinite` }}
        />
      )}
      <p className={`relative text-sm font-bold uppercase tracking-wide mb-1.5 ${hc ? 'text-zinc-600' : 'text-purple-400'}`}>
        Whole song
      </p>
      {isEditing ? (
        <NoteEditor initialValue={note ?? ''} onSave={onSaveNote} onCancel={onCancelEdit} hc={hc} saving={saving} />
      ) : note ? (
        <button onClick={onStartEdit} className={`relative block w-full text-left text-sm leading-snug ${fg}`}>
          {note}
        </button>
      ) : (
        <button onClick={onStartEdit} className={`relative flex items-center gap-1 text-[11px] ${dim}`}>
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Add a note — tempo, feel, who leads
        </button>
      )}
    </div>
  )
}

function SongBlock({ song, viewInstrument, hc, fg, dim, cardBg, notes, editingNote, openNotes,
  saving, onToggleNote, onStartEdit, onSaveNote, onCancelEdit, onSaveSongNote, tempo, canEditTempo, onSaveTempo,
  pulseOn = false, onTogglePulse }: {
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
  onSaveSongNote: (songId: string, text: string) => void
  tempo: number | null
  canEditTempo: boolean
  onSaveTempo: (bpm: number | null) => void
  pulseOn?: boolean
  onTogglePulse?: () => void
}) {
  const bare = song.sections.length === 0
  const pulseBpm = pulseOn && tempo !== null ? tempo : null
  // Exactly one set of surfaces pulses: the section cards normally, or the
  // whole-song card when the chart hasn't sectioned this song. Without this,
  // decoupling BPM from chord sheets would hand you a tempo you can set and
  // never see — on a bare song there'd be no card on screen to flash.
  const sectionPulse = bare ? null : pulseBpm
  const songCardPulse = bare ? pulseBpm : null
  const songKey = songNoteKey(song.id, viewInstrument)
  // Key journey when the song modulates: "G → A" (consecutive dupes collapsed)
  const keyJourney = song.sections
    .map(s => s.key_change)
    .filter((k): k is string => !!k)
    .filter((k, i, arr) => i === 0 || arr[i - 1] !== k)
  return (
    <div className="space-y-2">
      {/* min-w-0 + truncate: this row never wraps, and it now always carries a
          tempo chip. Without the truncate a long title pushed MEDLEY and the
          reference-track link off a 360px screen — and off the ~half-width
          Part pane on tablets and unfolded foldables, where it's worse. */}
      <div className="flex items-center gap-2">
        <span className={`font-bold text-sm min-w-0 truncate ${fg}`}>{song.title}</span>
        {song.scale && (
          <span className={`text-xs font-black px-2.5 py-0.5 rounded-lg ${hc ? 'bg-black text-white' : 'bg-purple-600 text-white'}`}>
            {song.scale}{keyJourney.length > 0 ? ` → ${keyJourney.join(' → ')}` : ''}
          </span>
        )}
        <TempoChip tempo={tempo} canEdit={canEditTempo} onSave={onSaveTempo} hc={hc} dim={dim} />
        {tempo !== null && onTogglePulse && (
          <button
            onClick={onTogglePulse}
            className={`shrink-0 flex items-center rounded-lg px-2 py-1 transition-colors ${
              pulseOn ? 'bg-amber-600' : (hc ? 'bg-zinc-200' : 'bg-zinc-800')
            }`}
            aria-label="Pulse cards at the song's tempo"
            title="Pulse cards at the song's tempo"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${pulseOn ? 'bg-white' : 'bg-amber-500'}`}
              style={pulseOn ? { animation: `oncue-beat ${60 / tempo}s linear infinite` } : undefined} />
          </button>
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
      <SongNoteCard
        note={notes[songKey]}
        isEditing={editingNote === songKey}
        saving={saving}
        hc={hc} fg={fg} dim={dim} cardBg={cardBg}
        forceCard={bare}
        onStartEdit={() => onStartEdit(songKey)}
        onSaveNote={(text) => onSaveSongNote(song.id, text)}
        onCancelEdit={onCancelEdit}
        pulseBpm={songCardPulse}
      />

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
            pulseBpm={sectionPulse}
          />
        )
      })}
    </div>
  )
}

export default function MyPartClient({ serviceId, songs, instruments, userInstrument, userId, initialNotes, initialSongNotes, chordsBySongId, tempoBySongId, prefsByLibraryId, canMapSections, preferredKey, initialSongIdx = 0, initialPane = 'part' }: Props) {
  // Clamp defensively: songs can shrink between the server render and here.
  const startIdx = Math.max(0, Math.min(songs.length - 1, initialSongIdx))
  const [viewInstrument, setViewInstrument] = useState(userInstrument ?? instruments[0] ?? '')
  const [activeSongIdx, setActiveSongIdx] = useState(startIdx)
  const [instrumentSheet, setInstrumentSheet] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting')
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries([
      ...initialNotes.map(n => [`${n.section_id}:${n.instrument}`, n.note_text] as const),
      ...initialSongNotes
        .filter(n => n.song_id)
        .map(n => [songNoteKey(n.song_id!, n.instrument), n.note_text] as const),
    ])
  )
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({})

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null)
  const isLiveRef = useRef(false)
  const activeSongIdxRef = useRef(startIdx)
  const [paneIdx, setPaneIdx] = useState(initialPane === 'chords' ? 1 : 0) // 0 = part, 1 = chords (phone swipe)
  const swipeRef = useRef<HTMLDivElement | null>(null)

  const hasAnyChords = songs.some(s => chordsBySongId[s.id])

  // Beat pulse — shared, on-by-default preference (same choice powers Live)
  const { pulseOn, pulsePrompt, togglePulse, answerPulsePrompt } = usePulsePref()

  // W2: impromptu live share, mirrored from the Live view — if someone pushes
  // a spontaneous song while this device is in live mode, it appears here too.
  const [impromptu, setImpromptu] = useState<{
    librarySongId: string; title: string; storedKey: string | null; body: string; sharedKey: string | null
  } | null>(null)
  const impromptuRef = useRef<string | null>(null)
  const [endingImpromptu, setEndingImpromptu] = useState(false)

  async function applyImpromptu(libId: string | null, sharedKey: string | null) {
    if (libId === impromptuRef.current) return
    impromptuRef.current = libId
    if (!libId) {
      setImpromptu(null)
      return
    }
    const supabase = getClient()
    const [{ data: libSong }, { data: vers }] = await Promise.all([
      supabase.from('library_songs').select('title').eq('id', libId).single(),
      supabase
        .from('song_versions')
        .select('stored_key, content_chordpro')
        .eq('library_song_id', libId)
        .not('reviewed_at', 'is', null)
        .order('reviewed_at', { ascending: false })
        .limit(1),
    ])
    const v = vers?.[0]
    if (libSong && v?.content_chordpro && impromptuRef.current === libId) {
      setImpromptu({ librarySongId: libId, title: libSong.title, storedKey: v.stored_key, body: v.content_chordpro, sharedKey })
    }
  }

  async function endImpromptu() {
    setEndingImpromptu(true)
    try {
      const { error } = await getClient().rpc('set_impromptu', {
        p_service_id: serviceId,
        p_library_song_id: null,
        p_key: null,
      })
      if (error) console.error('[my-part] end impromptu failed', error)
    } finally {
      setEndingImpromptu(false)
    }
    impromptuRef.current = null
    setImpromptu(null)
  }

  // Song tempo memory (v14): lives on the library song, shown/edited here
  const [tempos, setTempos] = useState<Record<string, number | null>>(() => {
    const t: Record<string, number | null> = {}
    // Seeded from tempoBySongId so a song with a library row but no reviewed
    // chord sheet still shows its saved tempo (v19).
    for (const s of songs) {
      const d = tempoBySongId[s.id]
      if (d) t[d.librarySongId] = d.tempoBpm
    }
    return t
  })

  function saveTempo(librarySongId: string, bpm: number | null) {
    setTempos(prev => ({ ...prev, [librarySongId]: bpm })) // optimistic
    getClient()
      .from('library_songs')
      .update({ tempo_bpm: bpm })
      .eq('id', librarySongId)
      .then(({ error }) => { if (error) console.error('tempo save failed', error.message) })
  }

  function tempoPropsFor(song: Song) {
    // v19: keyed off tempoBySongId, NOT chordsBySongId. Tempo is a property of
    // the song; a chord sheet is a separate thing that may never arrive. The
    // old version gated the whole chip on having a reviewed sheet, so the one
    // song you most want to set a tempo for in rehearsal — a brand-new one —
    // showed no chip at all, and therefore no pulse.
    const t = tempoBySongId[song.id]
    return {
      tempo: t ? tempos[t.librarySongId] ?? null : null,
      canEditTempo: !!t,
      onSaveTempo: (bpm: number | null) => { if (t) saveTempo(t.librarySongId, bpm) },
    }
  }

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

  // Deep-linked straight to the chords pane (?pane=chords). paneIdx is DERIVED
  // from scroll position by onSwipeScroll, so seeding the state isn't enough —
  // the scroller has to be moved. Instant, not smooth: the user tapped a chord
  // row and should just be there. rAF-retries until the pane has a measured
  // width (0 on the first paint after hydration). No-op at sm+ where both
  // panes are already side by side and the container doesn't scroll.
  useEffect(() => {
    if (initialPane !== 'chords' || !hasAnyChords) return
    let raf = 0
    const jump = () => {
      const el = swipeRef.current
      if (!el) return
      if (el.clientWidth === 0) { raf = requestAnimationFrame(jump); return }
      el.scrollTo({ left: el.clientWidth, behavior: 'auto' })
    }
    jump()
    return () => cancelAnimationFrame(raf)
  }, [initialPane, hasAnyChords])

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
      // Leaving live mode also leaves the shared impromptu view
      impromptuRef.current = null
      setImpromptu(null)
      return
    }

    let retryTimeout: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    setLiveStatus('connecting')

    // W2: catch an impromptu that was ALREADY live before we joined
    getClient()
      .from('session_state')
      .select('impromptu_library_song_id, impromptu_key')
      .eq('service_id', serviceId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        const st = data as { impromptu_library_song_id?: string | null; impromptu_key?: string | null }
        applyImpromptu(st.impromptu_library_song_id ?? null, st.impromptu_key ?? null)
      })

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
            const state = payload.new as {
              current_song_index?: number
              updated_by?: string
              impromptu_library_song_id?: string | null
              impromptu_key?: string | null
            }
            // W2: impromptu changes apply for everyone (own echo = no-op)
            if ('impromptu_library_song_id' in state) {
              applyImpromptu(state.impromptu_library_song_id ?? null, state.impromptu_key ?? null)
            }
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

  // Pedal / keyboard navigation. A Bluetooth page-turner pedal is just a
  // keyboard: the common ones send Right/Left, PageDown/PageUp, Down/Up or
  // Space. Works whether or not this phone is driving Live — the pedal moves
  // whatever this screen is showing (used to be live-mode only, which read
  // as "the pedal doesn't work").
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't fire when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (isPedalNext(e)) {
        e.preventDefault()
        goToSong(activeSongIdxRef.current + 1)
      } else if (isPedalPrev(e)) {
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

  /** Whole-song note (v19). Mirrors saveNote, keyed on song_id. The onConflict
   *  target names a PLAIN unique constraint on purpose — supabase-js emits
   *  ON CONFLICT with no WHERE clause, and Postgres cannot infer a partial
   *  index from that, so v19 avoided partial indexes entirely. */
  async function saveSongNote(songId: string, text: string) {
    const key = songNoteKey(songId, viewInstrument)
    const trimmed = text.trim()
    setSavingNote(true)
    if (trimmed) {
      await getClient().from('user_notes').upsert({
        user_id: userId, song_id: songId, instrument: viewInstrument, note_text: trimmed,
      }, { onConflict: 'user_id,song_id,instrument' })
      setNotes(prev => ({ ...prev, [key]: trimmed }))
    } else {
      await getClient().from('user_notes').delete()
        .eq('user_id', userId).eq('song_id', songId).eq('instrument', viewInstrument)
      setNotes(prev => { const n = { ...prev }; delete n[key]; return n })
    }
    setSavingNote(false)
    setEditingNote(null)
  }

  // Everything that floats above the fixed footer is positioned off its height.
  // Footer ≈ 113px: pt-2.5(10) + Stage/Live row(~22) + mb-2(8) + Prev/Next(56)
  // + pb-4(16). Prev/Next growing from py-2.5 to py-4 moved this by ~16px, so
  // both offsets below moved with it. ChordsPane's key button sits at 186px and
  // still clears this (and Live's ~110px footer) comfortably.
  const FLOAT_ROW = '156px'      // instrument pill (left) + fullscreen (right)
  const PANE_SWITCH_ROW = '134px' // Part/Chords tabs, centred

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
        <p className={dim + ' text-sm'}>The chart may have been parsed incorrectly — an admin can delete and re-upload it.</p>
        <Link href={`/services/${serviceId}`} className="text-purple-400 text-sm mt-2">← Back to the service</Link>
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
    onSaveSongNote: saveSongNote,
    onCancelEdit: () => setEditingNote(null),
  }

  return (
    <div className={`h-screen overflow-hidden ${bg} ${fg} flex flex-col`}>
      {/* Running order strip */}
      <div className={`border-b ${borderB} shrink-0 px-3 py-2`}>
        <div className="flex flex-wrap gap-1.5 items-center">
          <Link href={`/services/${serviceId}`} aria-label="Back to service"
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          {songs.map((song, si) => {
            const isPast = si < activeSongIdx
            const isActive = si === activeSongIdx
            const shortTitle = song.title.length > 12 ? song.title.slice(0, 12) + '…' : song.title
            return (
              <button key={song.id}
                onClick={() => goToSong(si)}
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

      {/* Floating instrument pill. Replaces the row of instrument chips that
          used to sit in the footer: almost nobody changes instrument twice in a
          service, so it was spending prime thumb-zone space on a once-ever
          action. Left edge — the right edge already carries fullscreen, and the
          chords pane puts its key button there too. Doubles as a readout, which
          matters because the instrument decides which instructions and notes
          you see. */}
      {instruments.length > 0 && (
        <button
          onClick={() => setInstrumentSheet(true)}
          className={`fixed left-3 z-20 h-8 max-w-[45%] px-2.5 rounded-full border flex items-center gap-1.5 active:scale-95 transition-colors ${
            hc ? 'bg-zinc-100 border-zinc-300 text-zinc-700' : 'bg-zinc-900/90 border-zinc-700 text-zinc-300'
          }`}
          style={{ bottom: FLOAT_ROW }}
          aria-label="Change instrument"
        >
          <svg className="w-3.5 h-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[10px] font-bold uppercase tracking-wide truncate">
            {viewInstrument || 'Instrument'}
          </span>
        </button>
      )}

      {/* Floating fullscreen button */}
      <button
        onClick={toggleFullscreen}
        className={`fixed right-3 z-20 w-8 h-8 rounded-full border flex items-center justify-center active:scale-95 transition-colors ${
          hc ? 'bg-zinc-100 border-zinc-300 text-zinc-600' : 'bg-zinc-900/90 border-zinc-700 text-zinc-400 hover:text-white'
        }`}
        style={{ bottom: FLOAT_ROW }}
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
          ? 'flex overflow-x-auto snap-x snap-mandatory no-scrollbar sm:grid sm:grid-cols-2 sm:overflow-x-hidden'
          : 'flex flex-col'}`}
      >
      {/* sm (640px) not lg: unfolded foldables report ~670–840px CSS width and
          MUST get both panes live side by side — that's the whole point. */}
      <div className={hasAnyChords ? 'min-w-full sm:min-w-0 snap-center overflow-y-auto h-full' : 'flex-1 min-h-0 overflow-y-auto'}>
      <div className="px-4 pt-3 pb-[248px] max-w-2xl mx-auto w-full">
        {pulsePrompt && tempoPropsFor(activeSong).tempo !== null && (
          <PulsePrompt hc={hc} onAnswer={answerPulsePrompt} className="mb-3" />
        )}
        <SongBlock song={activeSong} {...sharedProps} {...tempoPropsFor(activeSong)}
          pulseOn={pulseOn} onTogglePulse={togglePulse} />
      </div>
      </div>

      {/* Chords pane */}
      {hasAnyChords && (
        <div className="min-w-full sm:min-w-0 snap-center overflow-y-auto h-full sm:border-l sm:border-zinc-800">
          <div className="px-4 pt-3 pb-[248px] max-w-2xl mx-auto w-full">
            <ChordsPane
              key={activeSong.id}
              songTitle={activeSong.title}
              chartLabels={activeSong.sections.map(s => s.label)}
              chartKeyChanges={activeSong.sections.map(s => s.key_change ?? null)}
              attachHref={`/library?attachSong=${activeSong.id}&attachService=${serviceId}&attachTitle=${encodeURIComponent(activeSong.title)}`}
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
        <div className="sm:hidden fixed left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full border p-0.5 bg-zinc-900/95 border-zinc-700"
          style={{ bottom: PANE_SWITCH_ROW }}>
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

      {/* W2: impromptu live share — mirrors the Live view while in live mode */}
      {isLive && impromptu && (
        <div className={`fixed inset-0 z-30 overflow-y-auto ${hc ? 'bg-white' : 'bg-black'} px-4 pt-6 pb-40`}>
          <div className="max-w-2xl mx-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-1">
              ● Impromptu — shared live
            </p>
            <p className={`text-lg font-bold leading-tight mb-4 ${fg}`}>{impromptu.title}</p>
            <ChordSheetViewer
              key={impromptu.librarySongId}
              body={impromptu.body}
              storedKey={impromptu.storedKey}
              initialKey={prefsByLibraryId[impromptu.librarySongId] ?? impromptu.sharedKey}
              librarySongId={impromptu.librarySongId}
              userId={userId}
              highContrast={hc}
              instrument={viewInstrument}
              preferredKey={preferredKey}
            />
            <button
              onClick={endImpromptu}
              disabled={endingImpromptu}
              className="mt-6 w-full rounded-xl bg-amber-600 py-3 text-sm font-semibold text-white disabled:opacity-50 active:scale-95 transition-transform"
            >
              {endingImpromptu ? 'Ending…' : 'End impromptu for everyone'}
            </button>
          </div>
        </div>
      )}

      {/* Instrument sheet. Same scrim + rounded-t-2xl bottom sheet as the key
          picker in ChordsPane, so there's one sheet idiom in the app. */}
      {instrumentSheet && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setInstrumentSheet(false)} />
          <div className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t p-4 pb-8 ${
            hc ? 'bg-white border-zinc-300' : 'bg-zinc-900 border-zinc-700'
          }`}>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-3 ${dim}`}>Your instrument</p>
            <div className="flex flex-wrap gap-2">
              {instruments.map(instr => (
                <button
                  key={instr}
                  onClick={() => { handleInstrumentChange(instr); setInstrumentSheet(false) }}
                  className={`rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wide active:scale-95 transition-all ${
                    instr === viewInstrument
                      ? (hc ? 'bg-black text-white' : 'bg-white text-black')
                      : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
                  }`}
                >
                  {instr}
                </button>
              ))}
            </div>
            <button
              onClick={() => setInstrumentSheet(false)}
              className={`mt-4 w-full rounded-xl py-3 text-sm font-semibold ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}
            >
              Done
            </button>
          </div>
        </>
      )}

      {/* Fixed bottom bar */}
      <div className={`fixed bottom-0 left-0 right-0 border-t ${borderB} ${bg} px-4 pt-2.5 pb-4`}>
        {/* Stage + Go Live only — instruments now live in the floating pill */}
        <div className="flex items-center gap-1.5 mb-2">
          <button onClick={toggleContrast}
            className={`shrink-0 rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide active:scale-95 ${hc ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-400'}`}>
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

        {/* Prev / Next — py-4 + text-base, ~56px of target each. These get hit
            mid-song, one-handed, in the dark; they were py-2.5 text-sm with a
            layout toggle wedged between them eating the middle of the bar.
            Next is the primary here exactly as it is in Live, so the muscle
            memory transfers between the two stage surfaces. */}
        <div className="flex gap-3">
          <button
            onClick={() => goToSong(activeSongIdx - 1)}
            disabled={activeSongIdx === 0}
            className={`flex-1 rounded-xl py-4 text-base font-semibold disabled:opacity-30 active:scale-95 transition-all ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}>
            ← Prev
          </button>
          <button
            onClick={() => goToSong(activeSongIdx + 1)}
            disabled={activeSongIdx === songs.length - 1}
            className={`flex-1 rounded-xl py-4 text-base font-bold disabled:opacity-30 active:scale-95 transition-all ${hc ? 'bg-black text-white' : 'bg-white text-black'}`}>
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}

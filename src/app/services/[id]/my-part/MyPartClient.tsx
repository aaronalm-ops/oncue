'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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
}

// Extracted to top-level so it never remounts on parent re-render
function NoteEditor({ initialValue, onSave, onCancel, hc }: {
  initialValue: string
  onSave: (text: string) => void
  onCancel: () => void
  hc: boolean
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
        <button onClick={() => onSave(draft)}
          className="text-[10px] font-semibold px-3 py-1 rounded-lg bg-white text-black">Save</button>
        <button onClick={onCancel}
          className={`text-[10px] font-semibold px-3 py-1 rounded-lg ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-zinc-300'}`}>Cancel</button>
      </div>
    </div>
  )
}

function SectionCard({ section, viewInstrument, hc, fg, dim, cardBg, note, isEditing, noteExpanded,
  onToggleNote, onStartEdit, onSaveNote, onCancelEdit }: {
  section: Section
  viewInstrument: string
  hc: boolean; fg: string; dim: string; cardBg: string
  note: string | undefined
  isEditing: boolean
  noteExpanded: boolean
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
  onToggleNote, onStartEdit, onSaveNote, onCancelEdit, compact }: {
  song: Song
  viewInstrument: string
  hc: boolean; fg: string; dim: string; cardBg: string
  notes: Record<string, string>
  editingNote: string | null
  openNotes: Record<string, boolean>
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

export default function MyPartClient({ serviceId, songs, instruments, userInstrument, userId, initialNotes }: Props) {
  const [viewInstrument, setViewInstrument] = useState(userInstrument ?? instruments[0] ?? '')
  const [layout, setLayout] = useState<'song' | 'scroll'>('song')
  const [activeSongIdx, setActiveSongIdx] = useState(0)
  const [highContrast, setHighContrast] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(initialNotes.map(n => [`${n.section_id}:${n.instrument}`, n.note_text]))
  )
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({})

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  function getClient() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  async function saveNote(sectionId: string, text: string) {
    const key = `${sectionId}:${viewInstrument}`
    const trimmed = text.trim()
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
    setEditingNote(null)
  }

  const hc = highContrast
  const bg = hc ? 'bg-white' : 'bg-black'
  const fg = hc ? 'text-black' : 'text-white'
  const dim = hc ? 'text-zinc-500' : 'text-zinc-500'
  const cardBg = hc ? 'bg-zinc-100 border border-zinc-200' : 'bg-zinc-900'
  const borderB = hc ? 'border-zinc-300' : 'border-zinc-800'

  const activeSong = songs[activeSongIdx]

  const sharedProps = {
    viewInstrument,
    hc, fg, dim, cardBg,
    notes, editingNote, openNotes,
    onToggleNote: (sectionId: string) => setOpenNotes(prev => ({ ...prev, [sectionId]: !prev[sectionId] })),
    onStartEdit: (key: string) => setEditingNote(key),
    onSaveNote: saveNote,
    onCancelEdit: () => setEditingNote(null),
  }

  return (
    <div className={`min-h-screen ${bg} ${fg} flex flex-col`}>
      {/* Running order strip */}
      <div className={`border-b ${borderB} shrink-0`}>
        <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto no-scrollbar">
          <Link href="/services"
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </Link>
          {songs.map((song, si) => {
            const isPast = si < activeSongIdx
            const isActive = si === activeSongIdx
            const shortTitle = song.title.length > 13 ? song.title.slice(0, 13) + '…' : song.title
            return (
              <button key={song.id}
                onClick={() => {
                  setActiveSongIdx(si)
                  if (layout === 'scroll') document.getElementById(`song-${si}`)?.scrollIntoView({ behavior: 'smooth' })
                }}
                className={`shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
                  isActive
                    ? (hc ? 'bg-black text-white' : 'bg-white text-black')
                    : isPast
                      ? (hc ? 'bg-zinc-200 text-zinc-400 line-through' : 'bg-zinc-950 text-zinc-600')
                      : (hc ? 'bg-zinc-200 text-zinc-500' : 'bg-zinc-800 text-zinc-400')
                }`}>
                {shortTitle}
                {song.scale && (
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                    isActive
                      ? 'bg-purple-600 text-white'
                      : isPast
                        ? (hc ? 'text-zinc-400' : 'text-zinc-700')
                        : 'text-purple-400'
                  }`}>{song.scale}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 pt-3 pb-32 max-w-2xl mx-auto w-full overflow-y-auto">
        {layout === 'song' ? (
          <div className="space-y-2">
            <SongBlock song={activeSong} {...sharedProps} />
            <div className="flex gap-3 pt-2">
              <button onClick={() => setActiveSongIdx(i => Math.max(0, i - 1))} disabled={activeSongIdx === 0}
                className={`flex-1 rounded-xl py-3 font-semibold text-sm disabled:opacity-30 active:scale-95 transition-transform ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}>
                ← Prev
              </button>
              <button onClick={() => setActiveSongIdx(i => Math.min(songs.length - 1, i + 1))} disabled={activeSongIdx === songs.length - 1}
                className={`flex-1 rounded-xl py-3 font-semibold text-sm disabled:opacity-30 active:scale-95 transition-transform ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}>
                Next →
              </button>
            </div>
          </div>
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

      {/* Bottom bar */}
      <div className={`fixed bottom-0 left-0 right-0 border-t ${borderB} ${bg} px-4 pt-2.5 pb-4`}>
        <div className="flex items-center gap-1.5 mb-2.5 overflow-x-auto">
          {instruments.map(instr => (
            <button key={instr} onClick={() => setViewInstrument(instr)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide transition-all active:scale-95 ${
                instr === viewInstrument
                  ? (hc ? 'bg-black text-white' : 'bg-white text-black')
                  : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
              }`}>
              {instr}
            </button>
          ))}
          <div className="ml-auto flex gap-1.5 shrink-0">
            <button onClick={toggleFullscreen}
              className={`rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide active:scale-95 ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}>
              {isFullscreen ? 'Exit FS' : 'Full'}
            </button>
            <button onClick={() => setHighContrast(h => !h)}
              className={`rounded-lg px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide active:scale-95 ${hc ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-400'}`}>
              {hc ? 'Stage off' : 'Stage'}
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => setLayout('song')}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-95 ${layout === 'song' ? (hc ? 'bg-black text-white' : 'bg-white text-black') : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')}`}>
            Song by song
          </button>
          <button onClick={() => setLayout('scroll')}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-95 ${layout === 'scroll' ? (hc ? 'bg-black text-white' : 'bg-white text-black') : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')}`}>
            All on one page
          </button>
        </div>
      </div>
    </div>
  )
}

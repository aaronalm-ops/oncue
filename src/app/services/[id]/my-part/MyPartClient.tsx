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

export default function MyPartClient({ serviceId, songs, instruments, userInstrument, userId, initialNotes }: Props) {
  const [viewInstrument, setViewInstrument] = useState(userInstrument ?? instruments[0] ?? '')
  const [layout, setLayout] = useState<'song' | 'scroll'>('song')
  const [activeSongIdx, setActiveSongIdx] = useState(0)
  const [highContrast, setHighContrast] = useState(false)
  const [notes, setNotes] = useState<Record<string, string>>(
    Object.fromEntries(initialNotes.map(n => [`${n.section_id}:${n.instrument}`, n.note_text]))
  )
  const [editingNote, setEditingNote] = useState<string | null>(null) // key
  const [noteDraft, setNoteDraft] = useState('')
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  function getClient() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  const bg = highContrast ? 'bg-white' : 'bg-black'
  const fg = highContrast ? 'text-black' : 'text-white'
  const dim = highContrast ? 'text-zinc-500' : 'text-zinc-500'
  const cardBg = highContrast ? 'bg-zinc-100 border border-zinc-200' : 'bg-zinc-900'
  const borderColor = highContrast ? 'border-zinc-300' : 'border-zinc-800'

  async function saveNote(sectionId: string) {
    const key = `${sectionId}:${viewInstrument}`
    const text = noteDraft.trim()
    if (text) {
      await getClient().from('user_notes').upsert({
        user_id: userId,
        section_id: sectionId,
        instrument: viewInstrument,
        note_text: text,
      }, { onConflict: 'user_id,section_id,instrument' })
      setNotes(prev => ({ ...prev, [key]: text }))
    } else {
      await getClient().from('user_notes').delete()
        .eq('user_id', userId).eq('section_id', sectionId).eq('instrument', viewInstrument)
      setNotes(prev => { const n = { ...prev }; delete n[key]; return n })
    }
    setEditingNote(null)
  }

  function SectionCard({ section, song }: { section: Section; song: Song }) {
    const instr = section.instructions.find(i => i.instrument === viewInstrument)
    if (!instr && !section.instructions.some(i => i.instrument === viewInstrument)) return null
    const key = `${section.id}:${viewInstrument}`
    const note = notes[key]
    const isEditing = editingNote === key

    return (
      <div className={`rounded-2xl px-5 py-4 ${cardBg} ${instr?.is_intro ? 'border-2 border-orange-500' : ''}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-sm font-bold uppercase tracking-wide ${fg}`}>{section.label}</span>
          {instr?.is_intro && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-500 text-white">INTRO</span>
          )}
        </div>
        <p className={`text-base leading-snug ${fg}`}>{instr?.text || <span className={dim}>—</span>}</p>
        {section.comments && (
          <p className={`text-xs mt-2 ${dim} leading-snug`}>{section.comments}</p>
        )}

        {/* Personal note */}
        {isEditing ? (
          <div className="mt-3 space-y-2">
            <textarea
              className={`w-full rounded-xl px-3 py-2 text-sm resize-none focus:outline-none ${
                highContrast ? 'bg-white border border-zinc-400 text-black' : 'bg-zinc-800 text-white border border-zinc-700'
              }`}
              rows={3}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder="Your note…"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => saveNote(section.id)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white text-black"
              >Save</button>
              <button
                onClick={() => setEditingNote(null)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${highContrast ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-zinc-300'}`}
              >Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setEditingNote(key); setNoteDraft(note ?? '') }}
            className={`mt-2 text-xs ${note ? (highContrast ? 'text-zinc-700' : 'text-zinc-300') : dim} flex items-center gap-1`}
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

  function SongBlock({ song, compact }: { song: Song; compact?: boolean }) {
    return (
      <div className="space-y-3">
        <div className={`flex items-center gap-3 ${compact ? 'pt-6' : ''}`}>
          <span className={`font-bold text-base ${fg}`}>{song.title}</span>
          {song.scale && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${highContrast ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-300'}`}>
              {song.scale}
            </span>
          )}
          {song.medley_group && <span className="text-xs text-zinc-500">MEDLEY</span>}
          {song.reference_links[0] && (
            <a href={song.reference_links[0]} target="_blank" rel="noopener noreferrer"
              className="ml-auto text-zinc-500" aria-label="Reference track">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.38a8.16 8.16 0 004.77 1.52V7.45a4.85 4.85 0 01-1-.76z"/>
              </svg>
            </a>
          )}
        </div>
        {song.sections.map(section => (
          <SectionCard key={section.id} section={section} song={song} />
        ))}
      </div>
    )
  }

  const activeSong = songs[activeSongIdx]

  return (
    <div className={`min-h-screen ${bg} ${fg} flex flex-col`}>
      {/* Running order strip */}
      <div className={`border-b ${borderColor} overflow-x-auto`}>
        <div className="flex gap-2 px-4 py-3 min-w-max">
          {songs.map((song, si) => (
            <button
              key={song.id}
              onClick={() => { setActiveSongIdx(si); if (layout === 'scroll') document.getElementById(`song-${si}`)?.scrollIntoView({ behavior: 'smooth' }) }}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                layout === 'song' && si === activeSongIdx
                  ? (highContrast ? 'bg-black text-white' : 'bg-white text-black')
                  : (highContrast ? 'bg-zinc-200 text-zinc-700' : 'bg-zinc-800 text-zinc-400')
              }`}
            >
              {song.title.length > 18 ? song.title.slice(0, 18) + '…' : song.title}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 px-4 pt-4 pb-32 max-w-2xl mx-auto w-full">
        {layout === 'song' ? (
          <div className="space-y-3">
            <SongBlock song={activeSong} />
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setActiveSongIdx(i => Math.max(0, i - 1))}
                disabled={activeSongIdx === 0}
                className={`flex-1 rounded-xl py-3 font-semibold text-sm disabled:opacity-30 ${highContrast ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}
              >← Prev song</button>
              <button
                onClick={() => setActiveSongIdx(i => Math.min(songs.length - 1, i + 1))}
                disabled={activeSongIdx === songs.length - 1}
                className={`flex-1 rounded-xl py-3 font-semibold text-sm disabled:opacity-30 ${highContrast ? 'bg-black text-white' : 'bg-zinc-800 text-white'}`}
              >Next song →</button>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {songs.map((song, si) => (
              <div key={song.id} id={`song-${si}`}>
                <SongBlock song={song} compact />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className={`fixed bottom-0 left-0 right-0 border-t ${borderColor} ${bg} px-4 py-3`}>
        <div className="flex items-center gap-2 mb-3 overflow-x-auto">
          {instruments.map(instr => (
            <button
              key={instr}
              onClick={() => setViewInstrument(instr)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                instr === viewInstrument
                  ? (highContrast ? 'bg-black text-white' : 'bg-white text-black')
                  : (highContrast ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
              }`}
            >
              {instr}
            </button>
          ))}
          <button
            onClick={() => setHighContrast(h => !h)}
            className={`shrink-0 ml-auto rounded-lg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${highContrast ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-400'}`}
          >
            {highContrast ? 'Stage off' : 'Stage'}
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setLayout('song')}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${layout === 'song' ? (highContrast ? 'bg-black text-white' : 'bg-white text-black') : (highContrast ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')}`}
          >Song by song</button>
          <button
            onClick={() => setLayout('scroll')}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${layout === 'scroll' ? (highContrast ? 'bg-black text-white' : 'bg-white text-black') : (highContrast ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')}`}
          >All on one page</button>
        </div>

        <div className="mt-2">
          <Link href={`/services/${serviceId}`} className={`text-xs ${dim}`}>← Back</Link>
        </div>
      </div>
    </div>
  )
}

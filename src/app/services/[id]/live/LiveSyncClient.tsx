'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface Instruction { id: string; instrument: string; text: string; is_intro: boolean }
interface Section { id: string; order_index: number; label: string; comments: string; instructions: Instruction[] }
interface Song { id: string; order_index: number; title: string; scale: string | null; medley_group: string | null; reference_links: string[]; sections: Section[] }

interface Props {
  serviceId: string
  songs: Song[]
  instruments: string[]
  userInstrument: string | null
  initialSongIndex: number
  initialSectionIndex: number
}

export default function LiveSyncClient({ serviceId, songs, instruments, userInstrument, initialSongIndex, initialSectionIndex }: Props) {
  const [songIdx, setSongIdx] = useState(initialSongIndex)
  const [sectionIdx, setSectionIdx] = useState(initialSectionIndex)
  const [highContrast, setHighContrast] = useState(false)
  const [viewInstrument, setViewInstrument] = useState(userInstrument)
  const [notesOpen, setNotesOpen] = useState(false)
  const [pressing, setPressing] = useState<'prev' | 'next' | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  function getClient() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }

  type FlatItem = { songIdx: number; sectionIdx: number }
  const flatList: FlatItem[] = []
  songs.forEach((song, si) => {
    song.sections.forEach((_, seci) => flatList.push({ songIdx: si, sectionIdx: seci }))
  })
  const currentFlatIdx = flatList.findIndex(f => f.songIdx === songIdx && f.sectionIdx === sectionIdx)
  const nextFlat = currentFlatIdx < flatList.length - 1 ? flatList[currentFlatIdx + 1] : null

  const currentSong = songs[Math.min(songIdx, songs.length - 1)]
  const currentSection = currentSong?.sections[Math.min(sectionIdx, (currentSong?.sections.length ?? 1) - 1)]

  function pushState(newSongIdx: number, newSectionIdx: number) {
    getClient().from('session_state').upsert({
      service_id: serviceId,
      current_song_index: newSongIdx,
      current_section_index: newSectionIdx,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'service_id' })
  }

  function goNext() {
    if (!nextFlat) return
    setSongIdx(nextFlat.songIdx)
    setSectionIdx(nextFlat.sectionIdx)
    setNotesOpen(false)
    pushState(nextFlat.songIdx, nextFlat.sectionIdx)
  }

  function goPrev() {
    if (currentFlatIdx <= 0) return
    const prev = flatList[currentFlatIdx - 1]
    setSongIdx(prev.songIdx)
    setSectionIdx(prev.sectionIdx)
    setNotesOpen(false)
    pushState(prev.songIdx, prev.sectionIdx)
  }

  function jumpToSong(si: number) {
    setSongIdx(si)
    setSectionIdx(0)
    setNotesOpen(false)
    pushState(si, 0)
  }

  useEffect(() => {
    const channel = getClient()
      .channel(`session:${serviceId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'session_state',
        filter: `service_id=eq.${serviceId}`,
      }, payload => {
        const { current_song_index, current_section_index } = payload.new as { current_song_index: number; current_section_index: number }
        setSongIdx(current_song_index)
        setSectionIdx(current_section_index)
        setNotesOpen(false)
      })
      .subscribe()
    return () => { getClient().removeChannel(channel) }
  }, [serviceId])

  const myInstruction = currentSection?.instructions.find(i => i.instrument === viewInstrument)
  const isMyIntro = myInstruction?.is_intro ?? false
  const nextSectionLabel = nextFlat ? songs[nextFlat.songIdx].sections[nextFlat.sectionIdx]?.label : null
  const nextSongTitle = nextFlat && nextFlat.songIdx !== songIdx ? songs[nextFlat.songIdx]?.title : null

  const hc = highContrast
  const bg = hc ? 'bg-white' : 'bg-black'
  const fg = hc ? 'text-black' : 'text-white'
  const dim = hc ? 'text-zinc-500' : 'text-zinc-500'
  const cardBg = hc ? 'bg-zinc-100 border border-zinc-200' : 'bg-zinc-900'
  const dimCard = hc ? 'bg-zinc-200' : 'bg-zinc-950'
  const borderB = hc ? 'border-zinc-300' : 'border-zinc-800'

  return (
    <div className={`min-h-screen ${bg} ${fg} flex flex-col select-none`}>

      {/* Running order strip */}
      <div className={`border-b ${borderB} px-4 py-2.5 shrink-0`}>
        <div className="flex items-center gap-1.5">
          <Link href="/services"
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </Link>
          <div className="flex gap-1 flex-1 overflow-x-auto no-scrollbar">
            {songs.map((song, si) => {
              const isPast = si < songIdx
              const isActive = si === songIdx
              return (
                <button key={song.id} onClick={() => jumpToSong(si)}
                  className={`shrink-0 w-7 h-7 rounded-lg text-xs font-bold transition-all active:scale-90 ${
                    isActive
                      ? (hc ? 'bg-black text-white' : 'bg-white text-black')
                      : isPast
                        ? (hc ? 'bg-zinc-300 text-zinc-500' : 'bg-zinc-900 text-zinc-600')
                        : (hc ? 'bg-zinc-200 text-zinc-500' : 'bg-zinc-800 text-zinc-500')
                  }`}>
                  {si + 1}
                </button>
              )
            })}
          </div>
          <span className={`text-xs shrink-0 ${dim}`}>{currentFlatIdx + 1}/{flatList.length}</span>
        </div>
        <p className={`text-xs font-semibold mt-1.5 truncate ${fg}`}>
          {currentSong?.title}
          {currentSong?.scale && <span className={`ml-1.5 font-normal ${dim}`}>{currentSong.scale}</span>}
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col px-4 pt-3 pb-32 max-w-2xl mx-auto w-full gap-3 overflow-y-auto">

        {/* Song title + scale + YouTube */}
        <div className="flex items-center gap-2">
          <span className={`font-bold text-base leading-tight ${fg}`}>{currentSong?.title}</span>
          {currentSong?.scale && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${hc ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-300'}`}>
              {currentSong.scale}
            </span>
          )}
          {currentSong?.medley_group && <span className={`text-xs shrink-0 ${dim}`}>MEDLEY</span>}
          {currentSong?.reference_links[0] && (
            <a href={currentSong.reference_links[0]} target="_blank" rel="noopener noreferrer"
              className={`ml-auto shrink-0 ${dim}`} aria-label="Reference track">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.38a8.16 8.16 0 004.77 1.52V7.45a4.85 4.85 0 01-1-.76z"/>
              </svg>
            </a>
          )}
        </div>

        {/* Section label */}
        <div className="flex items-center gap-2">
          <h3 className={`text-2xl font-black uppercase tracking-wide ${fg}`}>{currentSection?.label}</h3>
          {isMyIntro && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-500 text-white animate-pulse shrink-0">YOUR INTRO</span>
          )}
        </div>

        {/* My instrument — prominent */}
        {myInstruction && (
          <div className={`rounded-2xl px-4 py-3.5 ${isMyIntro
            ? (hc ? 'border-2 border-orange-500 bg-orange-50' : 'border-2 border-orange-500 bg-zinc-900')
            : cardBg
          }`}>
            <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1.5 ${dim}`}>{viewInstrument}</p>
            <p className={`text-base font-semibold leading-snug ${fg}`}>{myInstruction.text || '—'}</p>
          </div>
        )}

        {/* Other instruments — compact rows */}
        <div className="space-y-1.5">
          {currentSection?.instructions
            .filter(i => i.instrument !== viewInstrument)
            .map(instr => (
              <div key={instr.instrument} className={`rounded-xl px-3 py-2.5 flex gap-3 items-start ${dimCard}`}>
                <span className={`text-[9px] font-bold uppercase tracking-widest shrink-0 mt-0.5 w-16 ${dim}`}>{instr.instrument}</span>
                <span className={`text-xs leading-snug ${hc ? 'text-zinc-500' : 'text-zinc-400'}`}>{instr.text || '—'}</span>
              </div>
            ))}
        </div>

        {/* Conductor notes — collapsible */}
        {currentSection?.comments && (
          <div>
            <button
              onClick={() => setNotesOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs font-medium ${dim}`}
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${notesOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Conductor notes
            </button>
            {notesOpen && (
              <div className={`mt-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${hc ? 'bg-yellow-50 border border-yellow-300 text-zinc-700' : 'bg-zinc-900 border border-zinc-700 text-zinc-300'}`}>
                {currentSection.comments}
              </div>
            )}
          </div>
        )}

        {/* Next preview */}
        {(nextSectionLabel || nextSongTitle) && (
          <p className={`text-xs ${dim}`}>
            Next: {nextSongTitle ? `${nextSongTitle} — ` : ''}{nextSectionLabel}
          </p>
        )}
      </div>

      {/* Bottom controls */}
      <div className={`fixed bottom-0 left-0 right-0 border-t ${borderB} ${bg} px-4 pt-2.5 pb-4`}>
        {/* Instrument + stage selector */}
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

        {/* Prev / Next */}
        <div className="flex gap-3">
          <button
            onPointerDown={() => setPressing('prev')}
            onPointerUp={() => { setPressing(null); goPrev() }}
            onPointerLeave={() => setPressing(null)}
            disabled={currentFlatIdx <= 0}
            className={`flex-1 rounded-xl py-3.5 font-semibold text-base disabled:opacity-30 transition-transform ${
              pressing === 'prev' ? 'scale-95' : 'scale-100'
            } ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}
          >
            Prev
          </button>
          <button
            onPointerDown={() => setPressing('next')}
            onPointerUp={() => { setPressing(null); goNext() }}
            onPointerLeave={() => setPressing(null)}
            disabled={!nextFlat}
            className={`flex-1 rounded-xl py-3.5 font-bold text-base disabled:opacity-30 transition-transform ${
              pressing === 'next' ? 'scale-95' : 'scale-100'
            } ${hc ? 'bg-black text-white' : 'bg-white text-black'}`}
          >
            Next
          </button>
        </div>

      </div>
    </div>
  )
}

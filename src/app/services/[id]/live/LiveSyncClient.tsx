'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
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
  // Lazy-init client (avoids SSR initialization without env vars)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  function getClient() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }
  // Keep last-known state for offline cache
  const lastKnownRef = useRef({ songIdx, sectionIdx })

  const currentSong = songs[Math.min(songIdx, songs.length - 1)]
  const currentSection = currentSong?.sections[Math.min(sectionIdx, (currentSong?.sections.length ?? 1) - 1)]

  const totalSections = songs.reduce((acc, s) => acc + s.sections.length, 0)
  // Flat list for prev/next traversal
  type FlatItem = { songIdx: number; sectionIdx: number }
  const flatList: FlatItem[] = []
  songs.forEach((song, si) => {
    song.sections.forEach((_, seci) => {
      flatList.push({ songIdx: si, sectionIdx: seci })
    })
  })
  const currentFlatIdx = flatList.findIndex(f => f.songIdx === songIdx && f.sectionIdx === sectionIdx)
  const nextFlat = currentFlatIdx < flatList.length - 1 ? flatList[currentFlatIdx + 1] : null

  async function pushState(newSongIdx: number, newSectionIdx: number) {
    lastKnownRef.current = { songIdx: newSongIdx, sectionIdx: newSectionIdx }
    await getClient().from('session_state').upsert({
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
    pushState(nextFlat.songIdx, nextFlat.sectionIdx)
  }

  function goPrev() {
    if (currentFlatIdx <= 0) return
    const prev = flatList[currentFlatIdx - 1]
    setSongIdx(prev.songIdx)
    setSectionIdx(prev.sectionIdx)
    pushState(prev.songIdx, prev.sectionIdx)
  }

  function jumpToSong(si: number) {
    setSongIdx(si)
    setSectionIdx(0)
    pushState(si, 0)
  }

  // Subscribe to realtime
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
        lastKnownRef.current = { songIdx: current_song_index, sectionIdx: current_section_index }
      })
      .subscribe()

    return () => { getClient().removeChannel(channel) }
  }, [serviceId])

  const myInstruction = currentSection?.instructions.find(i => i.instrument === viewInstrument)
  const isMyIntro = myInstruction?.is_intro ?? false

  const nextSectionLabel = nextFlat
    ? songs[nextFlat.songIdx].sections[nextFlat.sectionIdx]?.label
    : null
  const nextSongTitle = nextFlat && nextFlat.songIdx !== songIdx
    ? songs[nextFlat.songIdx]?.title
    : null

  const bg = highContrast ? 'bg-white' : 'bg-black'
  const fg = highContrast ? 'text-black' : 'text-white'
  const dim = highContrast ? 'text-zinc-600' : 'text-zinc-500'
  const cardBg = highContrast ? 'bg-zinc-100 border border-zinc-300' : 'bg-zinc-900'
  const dimCard = highContrast ? 'bg-zinc-200' : 'bg-zinc-950'

  return (
    <div className={`min-h-screen ${bg} ${fg} flex flex-col select-none`}>
      {/* Running order strip */}
      <div className={`border-b ${highContrast ? 'border-zinc-300' : 'border-zinc-800'} overflow-x-auto`}>
        <div className="flex gap-2 px-4 py-3 min-w-max">
          {songs.map((song, si) => (
            <button
              key={song.id}
              onClick={() => jumpToSong(si)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                si === songIdx
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
      <div className="flex-1 flex flex-col px-4 pt-4 pb-32 max-w-2xl mx-auto w-full gap-4">
        {/* Song + scale header */}
        <div className="flex items-baseline gap-3">
          <h2 className={`text-lg font-bold leading-tight ${fg}`}>{currentSong?.title}</h2>
          {currentSong?.scale && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${highContrast ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-300'}`}>
              {currentSong.scale}
            </span>
          )}
          {currentSong?.medley_group && (
            <span className="text-xs text-zinc-500">MEDLEY</span>
          )}
          {currentSong?.reference_links[0] && (
            <a href={currentSong.reference_links[0]} target="_blank" rel="noopener noreferrer"
              className="ml-auto text-zinc-500 shrink-0" aria-label="Reference track">
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
            <span className={`text-xs font-bold px-2 py-0.5 rounded-md animate-pulse ${
              highContrast ? 'bg-orange-500 text-white' : 'bg-orange-500 text-white'
            }`}>YOUR INTRO</span>
          )}
        </div>

        {/* My part — prominent */}
        {myInstruction && (
          <div className={`rounded-2xl px-5 py-4 ${isMyIntro
            ? (highContrast ? 'border-2 border-orange-500 bg-orange-50' : 'border-2 border-orange-500 bg-zinc-900')
            : cardBg
          }`}>
            <p className={`text-[11px] font-semibold uppercase tracking-widest mb-2 ${dim}`}>
              {viewInstrument}
            </p>
            <p className={`text-lg font-medium leading-snug ${fg}`}>
              {myInstruction.text || '—'}
            </p>
          </div>
        )}

        {/* Other instruments — dimmed */}
        <div className="space-y-2">
          {currentSection?.instructions
            .filter(i => i.instrument !== viewInstrument)
            .map(instr => (
              <div key={instr.instrument} className={`rounded-xl px-4 py-3 ${dimCard}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${dim}`}>{instr.instrument}</p>
                <p className={`text-sm leading-snug ${highContrast ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  {instr.text || '—'}
                </p>
              </div>
            ))}
        </div>

        {/* Comments */}
        {currentSection?.comments && (
          <div className={`rounded-xl px-4 py-3 ${highContrast ? 'bg-yellow-50 border border-yellow-300' : 'bg-zinc-900 border border-zinc-700'}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-widest mb-1 ${dim}`}>Notes</p>
            <p className={`text-sm leading-snug ${highContrast ? 'text-zinc-700' : 'text-zinc-300'}`}>{currentSection.comments}</p>
          </div>
        )}

        {/* Next part preview */}
        {(nextSectionLabel || nextSongTitle) && (
          <p className={`text-xs ${dim} mt-1`}>
            Next: {nextSongTitle ? `${nextSongTitle} — ` : ''}{nextSectionLabel}
          </p>
        )}
      </div>

      {/* Bottom controls */}
      <div className={`fixed bottom-0 left-0 right-0 border-t ${highContrast ? 'border-zinc-300 bg-white' : 'border-zinc-800 bg-black'} px-4 py-3`}>
        {/* Instrument selector */}
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
            className={`shrink-0 ml-auto rounded-lg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              highContrast ? 'bg-black text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {highContrast ? 'Stage off' : 'Stage'}
          </button>
        </div>

        {/* Prev / Next */}
        <div className="flex gap-3">
          <button
            onClick={goPrev}
            disabled={currentFlatIdx <= 0}
            className={`flex-1 rounded-xl py-3.5 font-semibold text-base transition-colors disabled:opacity-30 ${
              highContrast ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'
            }`}
          >
            Prev
          </button>
          <button
            onClick={goNext}
            disabled={!nextFlat}
            className={`flex-1 rounded-xl py-3.5 font-bold text-base transition-colors disabled:opacity-30 ${
              highContrast ? 'bg-black text-white' : 'bg-white text-black'
            }`}
          >
            Next
          </button>
        </div>

        <div className="flex justify-between items-center mt-2">
          <Link href={`/services/${serviceId}`} className={`text-xs ${dim}`}>← Back</Link>
          <span className={`text-xs ${dim}`}>
            {currentFlatIdx + 1} / {flatList.length}
          </span>
        </div>
      </div>
    </div>
  )
}

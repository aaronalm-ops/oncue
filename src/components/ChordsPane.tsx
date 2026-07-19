'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ChordSheet from '@/components/ChordSheet'
import { ALL_KEYS, deriveSections, keyIndex, mapChartSectionsToChords, normalizeSectionLabelFull, transposeBody } from '@/lib/chords/format'
import type { SongChordsData } from '@/lib/chords/service-chords'

interface Props {
  songTitle: string
  chartLabels: string[]
  chords: SongChordsData | null
  songScale: string | null // the chart's key for this song
  initialKey: string | null // user's saved preference
  userId: string
  currentSectionIdx: number | null // live position; null = no follow (My Part)
  highContrast: boolean
  canMapSections?: boolean // editors: allow mapping unmatched chart sections
}

/**
 * The chords half of the combined chart+chords view.
 * Sections appear in the CHART's order (index-aligned with the chart), the
 * live section is highlighted and kept in view, and the key strip transposes
 * with the user's per-song preference saved — same behaviour everywhere.
 */
export default function ChordsPane({ songTitle, chartLabels, chords, songScale, initialKey, userId, currentSectionIdx, highContrast, canMapSections = false }: Props) {
  const hc = highContrast
  const storedKey = chords?.storedKey ?? null
  const canTranspose = storedKey !== null && keyIndex(storedKey) !== null
  const [overrides, setOverrides] = useState<Record<string, string>>(chords?.sectionMaps ?? {})

  async function saveMapping(chartLabel: string, chordLabel: string) {
    if (!chords) return
    const key = normalizeSectionLabelFull(chartLabel)
    setOverrides(prev => ({ ...prev, [key]: chordLabel })) // optimistic — applies immediately
    await fetch('/api/library/section-maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        library_song_id: chords.librarySongId,
        chart_label: chartLabel,
        chord_section_label: chordLabel,
      }),
    })
  }

  const [targetKey, setTargetKey] = useState<string>(() => {
    const candidates = [initialKey, songScale, storedKey]
    for (const c of candidates) if (c && keyIndex(c) !== null) return c
    return storedKey ?? ''
  })

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentRef = useRef<HTMLDivElement | null>(null)

  function selectKey(k: string) {
    setTargetKey(k)
    if (!chords) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (!supabaseRef.current) supabaseRef.current = createClient()
      supabaseRef.current
        .from('user_scale_preferences')
        .upsert(
          { user_id: userId, library_song_id: chords.librarySongId, preferred_key: k },
          { onConflict: 'user_id,library_song_id' },
        )
        .then(() => {})
    }, 500)
  }

  const mapped = useMemo(
    () => (chords ? mapChartSectionsToChords(chords.body, chartLabels, overrides) : null),
    [chords, chartLabels, overrides],
  )

  const chordSectionLabels = useMemo(
    () => (chords ? [...new Set(deriveSections(chords.body).map(s => s.label))] : []),
    [chords],
  )

  const transpose = useMemo(() => {
    const active = canTranspose && targetKey && targetKey !== storedKey
    return (content: string) => (active ? transposeBody(content, storedKey!, targetKey) : content)
  }, [canTranspose, targetKey, storedKey])

  // Follow the live position — scroll ONLY the vertical pane. scrollIntoView
  // pans every scrollable ancestor, including the horizontal snap container,
  // which hijacks the chart⟷chords swipe. Compute scrollTop manually instead.
  useEffect(() => {
    if (currentSectionIdx === null) return
    const el = currentRef.current
    if (!el) return
    const scroller = el.closest('.overflow-y-auto') as HTMLElement | null
    if (!scroller) return
    const elRect = el.getBoundingClientRect()
    const scRect = scroller.getBoundingClientRect()
    const delta = (elRect.top - scRect.top) - (scroller.clientHeight - el.clientHeight) / 2
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'smooth' })
  }, [currentSectionIdx])

  if (!chords) {
    return (
      <div className="py-16 text-center">
        <p className={`text-sm ${hc ? 'text-zinc-500' : 'text-zinc-600'}`}>
          No chords linked for &ldquo;{songTitle}&rdquo; yet.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Key strip */}
      {canTranspose && (
        <div className="mb-3 -mx-1 px-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
          <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-widest mr-1 ${hc ? 'text-zinc-600' : 'text-zinc-500'}`}>
            Key
          </span>
          {ALL_KEYS.map(k => (
            <button
              key={k}
              onClick={() => selectKey(k)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition-all active:scale-95 ${
                k === targetKey
                  ? 'bg-purple-600 text-white'
                  : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {/* Sections in chart order — index-aligned with the conductor's chart */}
      <div className="space-y-2">
        {mapped!.sections.map((sec, i) => {
          const isCurrent = currentSectionIdx === i
          return (
            <div
              key={i}
              ref={isCurrent ? currentRef : undefined}
              className={`rounded-xl px-3 py-2.5 border ${
                isCurrent
                  ? 'border-purple-500 ' + (hc ? 'bg-purple-50' : 'bg-zinc-900')
                  : (hc ? 'border-zinc-200 bg-zinc-100' : 'border-zinc-800/60 bg-zinc-950')
              }`}
            >
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                isCurrent ? 'text-purple-400' : (hc ? 'text-zinc-600' : 'text-zinc-500')
              }`}>
                {sec.label}
              </p>
              {sec.content ? (
                <ChordSheet body={transpose(sec.content)} highContrast={hc} compact />
              ) : canMapSections && chordSectionLabels.length > 0 ? (
                <select
                  defaultValue=""
                  onChange={e => { if (e.target.value) saveMapping(sec.label, e.target.value) }}
                  className={`text-xs rounded-lg px-2 py-1.5 border focus:outline-none ${
                    hc ? 'bg-white border-zinc-300 text-zinc-700' : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                  }`}
                >
                  <option value="">map to a sheet section…</option>
                  {chordSectionLabels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              ) : (
                <p className={`text-xs ${hc ? 'text-zinc-400' : 'text-zinc-700'}`}>—</p>
              )}
            </div>
          )
        })}

        {mapped!.leftovers.length > 0 && (
          <div className={`pt-2 ${hc ? 'opacity-70' : 'opacity-60'}`}>
            <p className={`text-[10px] uppercase tracking-widest mb-1.5 ${hc ? 'text-zinc-500' : 'text-zinc-600'}`}>
              Not in this week&rsquo;s chart
            </p>
            {mapped!.leftovers.map(s => (
              <div key={s.order_index} className="mb-2">
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${hc ? 'text-zinc-500' : 'text-zinc-600'}`}>{s.label}</p>
                <ChordSheet body={transpose(s.content)} highContrast={hc} compact />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

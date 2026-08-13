'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import ChordSheet from '@/components/ChordSheet'
import { ALL_KEYS, deriveSections, effectiveSectionKeys, keyAtOffset, keyIndex, mapChartSectionsToChords, normalizeSectionLabelFull, semitonesBetween, transposeBody, transposeHint } from '@/lib/chords/format'
import type { SongChordsData } from '@/lib/chords/service-chords'

interface Props {
  songTitle: string
  chartLabels: string[]
  chords: SongChordsData | null
  songScale: string | null // the chart's key for this song
  initialKey: string | null // user's saved PER-SONG preference (overrides global)
  userId: string
  currentSectionIdx: number | null // live position; null = no follow (My Part)
  highContrast: boolean
  canMapSections?: boolean // editors: allow mapping unmatched chart sections
  instrument?: string | null // for the capo / keyboard-transpose hint
  preferredKey?: string | null // global default key; null = actual, no transpose
  chartKeyChanges?: (string | null)[] // index-aligned with chartLabels: mid-song modulations
  attachHref?: string | null // W9: "add chords" deep link for the empty state
}

/**
 * The chords half of the combined chart+chords view.
 * Sections appear in the CHART's order (index-aligned with the chart), the
 * live section is highlighted and kept in view, and the key strip transposes
 * with the user's per-song preference saved — same behaviour everywhere.
 */
export default function ChordsPane({ songTitle, chartLabels, chords, songScale, initialKey, userId, currentSectionIdx, highContrast, canMapSections = false, instrument = null, preferredKey = null, chartKeyChanges, attachHref = null }: Props) {
  const hc = highContrast
  const storedKey = chords?.storedKey ?? null
  const canTranspose = storedKey !== null && keyIndex(storedKey) !== null
  const [overrides, setOverrides] = useState<Record<string, string>>(chords?.sectionMaps ?? {})

  const [mapError, setMapError] = useState<string | null>(null)
  async function saveMapping(chartLabel: string, chordLabel: string) {
    if (!chords) return
    const key = normalizeSectionLabelFull(chartLabel)
    const previous = overrides[key] // W18: keep for revert
    setMapError(null)
    setOverrides(prev => ({ ...prev, [key]: chordLabel })) // optimistic — applies immediately
    const res = await fetch('/api/library/section-maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        library_song_id: chords.librarySongId,
        chart_label: chartLabel,
        chord_section_label: chordLabel,
      }),
    }).catch(() => null)
    if (!res || !res.ok) {
      // W18: optimistic UI must roll back when the save didn't stick
      setOverrides(prev => {
        const next = { ...prev }
        if (previous === undefined) delete next[key]
        else next[key] = previous
        return next
      })
      setMapError(`Couldn't save the "${chartLabel}" mapping — try again`)
    }
  }

  const [targetKey, setTargetKey] = useState<string>(() => {
    // per-song override → global preferred key → chart scale → sheet's own key
    const candidates = [initialKey, preferredKey, songScale, storedKey]
    for (const c of candidates) if (c && keyIndex(c) !== null) return c
    return storedKey ?? ''
  })

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentRef = useRef<HTMLDivElement | null>(null)

  // Chord text size — per-device, shared across My Part / Live / full sheets.
  // Primary control is PINCH on the sheet itself; the floating-button sheet
  // carries a slider as the non-touch fallback.
  const [textScale, setTextScale] = useState(1)
  const textScaleRef = useRef(1)
  useEffect(() => { textScaleRef.current = textScale }, [textScale])
  const [sheetOpen, setSheetOpen] = useState(false)
  useEffect(() => {
    const s = parseFloat(localStorage.getItem('oncue-chord-size') ?? '')
    if (Number.isFinite(s) && s >= 0.8 && s <= 1.5) setTextScale(s)
  }, [])
  function changeScale(v: number) {
    setTextScale(v)
    localStorage.setItem('oncue-chord-size', String(v))
  }

  // Pinch-to-resize on the chord sheet (two fingers) — natural on phones,
  // never fights one-finger scrolling or the pane swipe.
  const paneRef = useRef<HTMLDivElement | null>(null)
  const pinchRef = useRef<{ d0: number; s0: number } | null>(null)
  useEffect(() => {
    const el = paneRef.current
    if (!el) return
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinchRef.current = { d0: dist(e.touches), s0: textScaleRef.current }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault() // keep the browser/page from zooming or swiping
        const next = Math.min(1.5, Math.max(0.8, pinchRef.current.s0 * (dist(e.touches) / pinchRef.current.d0)))
        setTextScale(Math.round(next * 100) / 100)
      }
    }
    const onEnd = () => {
      if (pinchRef.current) {
        localStorage.setItem('oncue-chord-size', String(textScaleRef.current))
        pinchRef.current = null
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  // W10: is a personal key pinned, or are we following the chart? "Auto"
  // DELETES the pref row (the old reset SAVED the sheet key as a pref —
  // sticky forever). Auto = this song always opens in the chart's key again.
  const [prefPinned, setPrefPinned] = useState(initialKey !== null)

  function selectKey(k: string) {
    setTargetKey(k)
    setPrefPinned(true)
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

  function selectAutoKey() {
    const fallback = songScale && keyIndex(songScale) !== null ? songScale : (storedKey ?? '')
    setTargetKey(fallback)
    setPrefPinned(false)
    if (!chords) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (!supabaseRef.current) supabaseRef.current = createClient()
    supabaseRef.current
      .from('user_scale_preferences')
      .delete()
      .eq('user_id', userId)
      .eq('library_song_id', chords.librarySongId)
      .then(() => {})
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

  // Mid-song modulations: each chart section's SOUNDING key (marker persists
  // forward), from which we derive a per-section semitone delta on top of the
  // user's own transpose — the modulation interval is preserved in any key.
  const kcBase = songScale ?? storedKey
  const effKeys = useMemo(
    () => (chartKeyChanges && kcBase && keyIndex(kcBase) !== null
      ? effectiveSectionKeys(kcBase, chartKeyChanges)
      : null),
    [chartKeyChanges, kcBase],
  )
  function modDeltaAt(i: number): number {
    if (!effKeys) return 0
    return semitonesBetween(kcBase, effKeys[i] ?? kcBase) ?? 0
  }

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
      <div className="py-16 text-center space-y-4">
        <p className={`text-sm ${hc ? 'text-zinc-500' : 'text-zinc-600'}`}>
          No chords linked for &ldquo;{songTitle}&rdquo; yet.
        </p>
        {/* W9: same one-tap add-chords path as the service page rows */}
        {attachHref && (
          <Link href={attachHref}
            className="inline-block rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 transition-transform">
            Add chords for this song →
          </Link>
        )}
      </div>
    )
  }

  // The band sounds in the chart key; chords are shown in `shownKey`. The hint
  // tells this instrument how to bridge the two (capo / keyboard transpose).
  const actualKey = songScale ?? storedKey
  const shownKey = canTranspose && targetKey ? targetKey : storedKey
  const hint = transposeHint(actualKey, shownKey, instrument)

  return (
    <div ref={paneRef}>
      {/* Capo / keyboard-transpose hint */}
      {hint && hint.value !== 0 && (
        <div className="mb-2.5 flex items-center gap-2">
          <span className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold bg-purple-600 text-white">
            {hint.label}
          </span>
          <span className={`text-[10px] leading-tight ${hc ? 'text-zinc-500' : 'text-zinc-500'}`}>
            {hint.mode === 'capo'
              ? `capo up — chords shown in ${shownKey}`
              : `play in ${shownKey}, sounds in ${actualKey}`}
          </span>
        </div>
      )}
      {/* Key + size moved into the floating button below — the sheet content
          starts immediately, and two-finger pinch resizes the text. */}

      {mapError && <p className="mb-2 text-[11px] text-red-400">{mapError}</p>}

      {/* Sections in chart order — index-aligned with the conductor's chart */}
      <div className="space-y-2">
        {mapped!.sections.map((sec, i) => {
          const isCurrent = currentSectionIdx === i
          const modDelta = modDeltaAt(i)
          const modMarkerHere = chartKeyChanges?.[i] ?? null // change happens AT this section
          const modSigned = modDelta > 6 ? modDelta - 12 : modDelta
          // What this section sounds/reads as, in the user's current view key
          const modShownKey = modDelta !== 0 && canTranspose
            ? keyAtOffset(shownKey ?? storedKey!, modDelta)
            : modMarkerHere
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
              <div className="flex items-center gap-1.5 mb-1">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${
                  isCurrent ? 'text-purple-400' : (hc ? 'text-zinc-600' : 'text-zinc-500')
                }`}>
                  {sec.label}
                </p>
                {modMarkerHere && (
                  <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-black">
                    {modSigned < 0 ? '↓' : '↑'} KEY {modShownKey}
                  </span>
                )}
              </div>
              {sec.content ? (
                <ChordSheet
                  body={modDelta !== 0 && canTranspose
                    ? transposeBody(sec.content, storedKey!, keyAtOffset(shownKey ?? storedKey!, modDelta))
                    : transpose(sec.content)}
                  highContrast={hc} compact textScale={textScale} />
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
                <ChordSheet body={transpose(s.content)} highContrast={hc} compact textScale={textScale} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating key button — one compact affordance instead of a strip of
          14 chips eating the top of the pane. Shows the current key at a
          glance; opens the sheet with key grid + size slider. */}
      <button
        onClick={() => setSheetOpen(true)}
        aria-label="Key and text size"
        className={`fixed right-3 z-30 h-11 min-w-11 px-3 rounded-full border shadow-lg flex items-center gap-1.5 active:scale-95 transition-transform ${
          hc ? 'bg-white/95 border-zinc-300' : 'bg-zinc-900/95 border-zinc-700'
        }`}
        style={{ bottom: '186px' }}
      >
        <span className={`text-[9px] font-bold uppercase tracking-widest ${hc ? 'text-zinc-500' : 'text-zinc-500'}`}>Key</span>
        <span className={`text-sm font-black ${hc ? 'text-black' : 'text-white'}`}>
          {canTranspose ? (prefPinned ? (shownKey ?? '—') : 'Auto') : '—'}
        </span>
      </button>

      {sheetOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setSheetOpen(false)} />
          <div className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t p-4 pb-8 ${
            hc ? 'bg-white border-zinc-300' : 'bg-zinc-900 border-zinc-700'
          }`}>
            <div className="max-w-lg mx-auto space-y-4">
              {canTranspose && (
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${hc ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    Key
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { selectAutoKey(); setSheetOpen(false) }}
                      title="Follow the chart's key (clears your saved key for this song)"
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
                        !prefPinned
                          ? 'bg-purple-600 text-white'
                          : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
                      }`}
                    >
                      Auto
                    </button>
                    {ALL_KEYS.map(k => (
                      <button
                        key={k}
                        onClick={() => { selectKey(k); setSheetOpen(false) }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all active:scale-95 ${
                          k === targetKey && prefPinned
                            ? 'bg-purple-600 text-white'
                            : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${hc ? 'text-zinc-500' : 'text-zinc-500'}`}>
                  Text size — or pinch the sheet with two fingers
                </p>
                <div className="flex items-center gap-3">
                  <span className={`shrink-0 text-[10px] font-bold ${hc ? 'text-zinc-600' : 'text-zinc-500'}`}>A</span>
                  <input
                    type="range" min="0.8" max="1.5" step="0.05"
                    value={textScale}
                    onChange={e => changeScale(parseFloat(e.target.value))}
                    className="flex-1 accent-purple-600"
                    aria-label="Chord text size"
                  />
                  <span className={`shrink-0 text-base font-bold ${hc ? 'text-zinc-600' : 'text-zinc-500'}`}>A</span>
                  {textScale !== 1 && (
                    <button onClick={() => changeScale(1)}
                      className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg ${hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400'}`}>
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSheetOpen(false)}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold ${hc ? 'bg-zinc-200 text-zinc-700' : 'bg-zinc-800 text-zinc-300'}`}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

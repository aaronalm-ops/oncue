'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PadEngine, PAD_TONES, type PadTone } from '@/lib/audio/pad-engine'
import { keyIndex } from '@/lib/chords/format'

/**
 * Ambient pad: a floating pill + a details sheet. Lives on Stage View and
 * Live; the page tells it what key the band is sounding in right now and the
 * song's tempo, it does the rest (crossfades on key change, LFOs follow bpm).
 *
 * The pill is two targets: the left segment is ON/OFF (the thing you do
 * mid-service), the chevron opens the sheet (tone, volume — the things you
 * do once, at the start). Tone and volume persist per device, so each
 * player keeps the pad they like.
 *
 * Audio plays from THIS device — the sheet says so in one line, because the
 * alternative is a pad coming out of a phone speaker on stage.
 */

const TONE_LS = 'oncue.pad.tone'
const VOL_LS = 'oncue.pad.volume'

/** "A", "f#m", "Bb major", "D minor" → something keyIndex understands, else null. */
export function padKeyOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^([A-Ga-g])\s*([#b♯♭])?\s*(m\b|min|minor|-)?/i)
  if (!m) return null
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : (m[2] ?? '')
  const root = m[1].toUpperCase() + acc
  if (keyIndex(root) === null) return null
  return root + (m[3] ? 'm' : '')
}

function readTone(): PadTone {
  try {
    const t = localStorage.getItem(TONE_LS)
    if (t && PAD_TONES.some(p => p.id === t)) return t as PadTone
  } catch { /* private mode etc. */ }
  return 'shimmer'
}
function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_LS))
    if (Number.isFinite(v) && v > 0 && v <= 1) return v
  } catch { /* ignore */ }
  return 0.8
}

interface Props {
  /** the key the band is sounding in right now (chart key, not the player's view key) */
  targetKey: string | null | undefined
  bpm: number | null | undefined
  hc: boolean
  /** CSS bottom offset for the floating pill (left edge) */
  bottom: string
}

export default function PadControl({ targetKey, bpm, hc, bottom }: Props) {
  const engineRef = useRef<PadEngine | null>(null)
  const [on, setOn] = useState(false)
  // Lazy init: neither value affects the first paint (the sheet is closed),
  // so reading localStorage here can't cause a hydration mismatch.
  const [tone, setTone] = useState<PadTone>(() => (typeof window === 'undefined' ? 'shimmer' : readTone()))
  const [volume, setVolume] = useState(() => (typeof window === 'undefined' ? 0.8 : readVolume()))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [playingKey, setPlayingKey] = useState<string | null>(null)
  const wakeRef = useRef<WakeLockSentinel | null>(null)

  const key = padKeyOf(targetKey)

  const engine = useCallback((): PadEngine => {
    if (!engineRef.current) engineRef.current = new PadEngine()
    return engineRef.current
  }, [])

  // Follow the song. No key on this song → keep holding the last one (the
  // pill says so) rather than dropping to silence mid-service.
  useEffect(() => {
    if (!on || !key) return
    engine().play(key, tone, bpm ?? null).then(ok => { if (ok) setPlayingKey(key) })
  }, [on, key, tone, bpm, engine])

  useEffect(() => () => { engineRef.current?.dispose(); engineRef.current = null }, [])

  // Screen stays on while the pad plays — a locked phone suspends Web Audio.
  useEffect(() => {
    if (!on) { wakeRef.current?.release().catch(() => {}); wakeRef.current = null; return }
    let cancelled = false
    const request = async () => {
      try {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
        const s = await navigator.wakeLock.request('screen')
        if (cancelled) { s.release().catch(() => {}); return }
        wakeRef.current = s
      } catch { /* denied / unsupported — nothing to do */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible') request() }
    request()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      wakeRef.current?.release().catch(() => {}); wakeRef.current = null
    }
  }, [on])

  // Toggle runs play() synchronously inside the tap — the first AudioContext
  // start must happen in a user gesture (iOS / Chrome autoplay rules).
  function toggle() {
    if (on) { setOn(false); setPlayingKey(null); engineRef.current?.stop(); return }
    setOn(true)
    const e = engine()
    e.prime()
    e.setVolume(volume)
    if (key) e.play(key, tone, bpm ?? null).then(ok => { if (ok) setPlayingKey(key) })
  }

  function chooseTone(t: PadTone) {
    setTone(t)
    try { localStorage.setItem(TONE_LS, t) } catch { /* ignore */ }
  }
  function changeVolume(v: number) {
    setVolume(v)
    engineRef.current?.setVolume(v)
    try { localStorage.setItem(VOL_LS, String(v)) } catch { /* ignore */ }
  }

  const holding = on && !key && playingKey   // song has no key; still sounding the last one
  const label = on ? (key ?? playingKey ?? '—') : 'Pad'
  const toneName = PAD_TONES.find(t => t.id === tone)?.name ?? ''

  const pillOn = 'bg-purple-600 border-purple-500 text-white'
  const pillOff = hc ? 'bg-zinc-100 border-zinc-300 text-zinc-700' : 'bg-zinc-900/90 border-zinc-700 text-zinc-300'

  return (
    <>
      <div
        className={`fixed left-3 z-30 h-8 rounded-full border flex items-stretch overflow-hidden transition-colors ${on ? pillOn : pillOff}`}
        style={{ bottom }}
      >
        <button
          onClick={toggle}
          aria-label={on ? 'Pad off' : 'Pad on'}
          aria-pressed={on}
          className="flex items-center gap-1.5 pl-2.5 pr-2 active:opacity-70"
        >
          {on ? (
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0" />
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h2l2-5 3 10 3-14 3 14 2-5h3" />
            </svg>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wide">
            {on && <span className="opacity-70 mr-1">Pad</span>}
            <span className={holding ? 'opacity-60' : ''}>{label}</span>
          </span>
        </button>
        <button
          onClick={() => setSheetOpen(true)}
          aria-label="Pad tone and volume"
          className={`flex items-center px-2 border-l active:opacity-70 ${on ? 'border-purple-400/60' : hc ? 'border-zinc-300' : 'border-zinc-700'}`}
        >
          <svg className="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>

      {sheetOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setSheetOpen(false)} />
          <div className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t p-4 pb-8 ${
            hc ? 'bg-white border-zinc-300' : 'bg-zinc-900 border-zinc-700'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-semibold uppercase tracking-widest ${hc ? 'text-zinc-500' : 'text-zinc-500'}`}>Pad</p>
                <p className={`text-sm font-semibold truncate ${hc ? 'text-black' : 'text-white'}`}>
                  {on
                    ? <>{key ?? playingKey ?? '—'}{holding && <span className="opacity-60"> · holding</span>}{bpm ? <span className="opacity-60"> · {bpm} bpm</span> : null}</>
                    : key ? <span className="opacity-60">{key}{bpm ? ` · ${bpm} bpm` : ''}</span> : <span className="opacity-60">No key on this song</span>}
                </p>
              </div>
              <button
                onClick={toggle}
                aria-pressed={on}
                className={`shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold active:scale-95 transition-all ${
                  on ? 'bg-purple-600 text-white' : hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'
                }`}
              >
                {on ? 'On' : 'Off'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {PAD_TONES.map(t => {
                const sel = t.id === tone
                return (
                  <button
                    key={t.id}
                    onClick={() => chooseTone(t.id)}
                    className={`rounded-xl px-3 py-2.5 text-left active:scale-[0.98] transition-all border ${
                      sel
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : hc ? 'bg-zinc-100 border-zinc-200 text-zinc-800' : 'bg-zinc-800 border-zinc-800 text-zinc-200'
                    }`}
                  >
                    <span className="block text-sm font-bold">{t.name}</span>
                    <span className={`block text-[11px] leading-snug ${sel ? 'text-purple-100' : hc ? 'text-zinc-500' : 'text-zinc-400'}`}>{t.blurb}</span>
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-3 mb-4">
              <svg className={`w-4 h-4 shrink-0 ${hc ? 'text-zinc-500' : 'text-zinc-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7M19 6a9 9 0 010 12" />
              </svg>
              <input
                type="range" min={0.05} max={1} step={0.01} value={volume}
                onChange={e => changeVolume(Number(e.target.value))}
                aria-label="Pad volume"
                className="flex-1 accent-purple-600"
              />
              <span className={`w-8 text-right text-xs tabular-nums ${hc ? 'text-zinc-500' : 'text-zinc-400'}`}>{Math.round(volume * 100)}</span>
            </div>

            <p className={`text-[11px] mb-4 ${hc ? 'text-zinc-500' : 'text-zinc-500'}`}>
              {toneName} plays from this phone — plug it into the desk and keep the screen on.
            </p>

            <button
              onClick={() => setSheetOpen(false)}
              className={`w-full rounded-xl py-3 text-sm font-semibold ${hc ? 'bg-zinc-200 text-black' : 'bg-zinc-800 text-white'}`}
            >
              Done
            </button>
          </div>
        </>
      )}
    </>
  )
}

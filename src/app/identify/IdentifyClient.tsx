'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  accumulateChroma, estimateKey, keyLabel, modeOfKey, snapToMode,
  type KeyEstimate, type Mode,
} from '@/lib/audio/key-detect'
import { ALL_KEYS } from '@/lib/chords/format'
import { BOTTOM_NAV_HEIGHT } from '@/components/BottomNav'

/* ------------------------------------------------------------------ */
/* Web Speech API — not in TS's DOM lib on every config; declare the   */
/* slice we use. Chrome (Android/desktop) and Safari 14.5+ ship it.    */
/* ------------------------------------------------------------------ */
interface SRResultAlt { transcript: string }
interface SRResult { isFinal: boolean; 0: SRResultAlt; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SRCtor = new () => SpeechRecognitionLike
function getSpeechRecognition(): SRCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/* ------------------------------------------------------------------ */

interface Candidate {
  library_song_id: string
  title: string
  artist: string | null
  stored_key: string | null
  score: number
  matched_via: 'lyrics' | 'title'
}

interface Props {
  target: { id: string; label: string; isToday: boolean } | null
  backHref: string
}

type Phase = 'idle' | 'starting' | 'listening' | 'done'

const MAX_LISTEN_MS = 30_000
const MIN_KEY_MS = 3_000        // don't call a key before this much audio
const QUERY_WORDS = 10          // rolling window sent to identify_song
const STRONG = 0.6              // "that's the one" threshold for the UI
const AUTO_STOP_SCORE = 0.85    // stop early when the match is unmistakable

let clientSingleton: ReturnType<typeof createClient> | null = null
const getClient = () => (clientSingleton ??= createClient())

export default function IdentifyClient({ target, backHref }: Props) {
  const router = useRouter()
  const srSupported = useMemo(() => getSpeechRecognition() !== null, [])

  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [candidates, setCandidates] = useState<Record<string, Candidate>>({})
  const [keyEst, setKeyEst] = useState<KeyEstimate | null>(null)
  const [keyDetectOff, setKeyDetectOff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<Candidate | null>(null)

  // Everything that must survive re-renders without re-running effects
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const chromaRef = useRef(new Float64Array(12))
  const timersRef = useRef<number[]>([])
  const startedAtRef = useRef(0)
  const listeningRef = useRef(false)
  const finalsRef = useRef('')
  const interimRef = useRef('')
  const keyEstRef = useRef<KeyEstimate | null>(null)
  const lastQueryRef = useRef('')
  const queryTimerRef = useRef<number | null>(null)
  const bestScoreRef = useRef(0)

  /* ---------------- matching ---------------- */

  const runQuery = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || q === lastQueryRef.current) return
    lastQueryRef.current = q
    const { data, error: err } = await getClient().rpc('identify_song', { p_text: q, p_limit: 6 })
    if (err) {
      if (err.message?.includes('does not exist')) setError('Song matching isn’t set up yet — run supabase/v21_identify.sql.')
      else console.error('[identify]', err)
      return
    }
    const rows = (data ?? []) as Candidate[]
    setCandidates(prev => {
      const next = { ...prev }
      for (const r of rows) {
        const had = next[r.library_song_id]
        // Keep the best score EVER seen per song — an early "you're the God
        // who fights for me" hit shouldn't be lost when the next window is
        // mumbling between lines.
        if (!had || r.score > had.score) next[r.library_song_id] = r
      }
      return next
    })
    const top = rows[0]?.score ?? 0
    if (top > bestScoreRef.current) bestScoreRef.current = top
  }, [])

  const scheduleQuery = useCallback((fullText: string) => {
    const words = fullText.trim().split(/\s+/).filter(Boolean)
    if (words.length < 2) return
    const window = words.slice(-QUERY_WORDS).join(' ')
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current)
    queryTimerRef.current = window_setTimeout(() => runQuery(window), 500)
  }, [runQuery])

  /* ---------------- teardown ---------------- */

  const stopAll = useCallback((toPhase: Phase = 'done') => {
    listeningRef.current = false
    timersRef.current.forEach(t => clearInterval(t))
    timersRef.current = []
    if (queryTimerRef.current) { clearTimeout(queryTimerRef.current); queryTimerRef.current = null }
    const rec = recRef.current
    recRef.current = null
    if (rec) { rec.onend = null; try { rec.stop() } catch {} }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setPhase(toPhase)
    // One last match on everything we heard — the rolling window may have
    // missed the strongest line.
    const all = (finalsRef.current + ' ' + interimRef.current).trim()
    if (all.split(/\s+/).length >= 2) runQuery(all.split(/\s+/).slice(-QUERY_WORDS * 2).join(' '))
  }, [runQuery])

  // Unmount only — stopAll has no reactive deps, so this never re-fires mid-listen.
  const stopAllRef = useRef(stopAll)
  useEffect(() => { stopAllRef.current = stopAll }, [stopAll])
  useEffect(() => () => { stopAllRef.current('idle') }, [])

  /* ---------------- key detection (on-device) ---------------- */

  async function startKeyDetection() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream
      const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 8192
      analyser.smoothingTimeConstant = 0.5
      src.connect(analyser)
      const db = new Float32Array(analyser.frequencyBinCount)
      const power = new Float32Array(analyser.frequencyBinCount)
      chromaRef.current.fill(0)

      const tick = window.setInterval(() => {
        if (ctx.state !== 'running') { ctx.resume().catch(() => {}); return }
        analyser.getFloatFrequencyData(db)
        let peak = -Infinity
        for (let i = 0; i < db.length; i++) { power[i] = 10 ** (db[i] / 10); if (db[i] > peak) peak = db[i] }
        if (peak < -75) return // silence — don't let the noise floor vote
        accumulateChroma(power, ctx.sampleRate, analyser.fftSize, chromaRef.current)
      }, 100)
      const judge = window.setInterval(() => {
        if (Date.now() - startedAtRef.current < MIN_KEY_MS) return
        setKeyEst(estimateKey(chromaRef.current))
      }, 1000)
      timersRef.current.push(tick, judge)
    } catch (e) {
      const name = (e as { name?: string })?.name
      setKeyDetectOff(name === 'NotAllowedError' ? 'mic blocked' : 'not available here')
    }
  }

  /* ---------------- listening ---------------- */

  function startRecognition(withKey: boolean) {
    const Ctor = getSpeechRecognition()
    if (!Ctor) { setError('Voice needs Chrome, or Safari 14.5+. You can still type a lyric below.'); setPhase('idle'); return }
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onstart = () => {
      if (!listeningRef.current) return
      setPhase('listening')
      if (withKey && !streamRef.current) startKeyDetection()
    }
    rec.onresult = (e: SREvent) => {
      let finals = finalsRef.current
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finals = (finals + ' ' + r[0].transcript).trim()
        else live += r[0].transcript
      }
      finalsRef.current = finals
      interimRef.current = live
      setTranscript(finals)
      setInterim(live)
      scheduleQuery(finals + ' ' + live)
    }
    rec.onerror = (e: SRErrorEvent) => {
      if (!listeningRef.current) return
      if (e.error === 'no-speech' || e.error === 'aborted') return // onend will restart
      if (e.error === 'audio-capture' && streamRef.current) {
        // Chrome on some Android builds won't share the mic between
        // SpeechRecognition and getUserMedia. Words matter more than the
        // key — drop key detection and carry on.
        streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null
        audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null
        timersRef.current.forEach(t => clearInterval(t)); timersRef.current = []
        setKeyDetectOff('mic is busy with voice on this phone')
        return
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone access was blocked. Allow the mic for OnCue in your browser settings, or type a lyric below.')
        stopAll('idle')
        return
      }
      setError(`Listening stopped (${e.error}). Tap to try again, or type a lyric below.`)
      stopAll('idle')
    }
    rec.onend = () => {
      // Continuous recognition still ends itself after a pause — keep going
      // until we say stop.
      if (listeningRef.current && Date.now() - startedAtRef.current < MAX_LISTEN_MS) {
        try { rec.start() } catch { /* already starting */ }
      }
    }
    recRef.current = rec
    try { rec.start() } catch { setError('Couldn’t start listening. Tap again.'); setPhase('idle') }
  }

  function begin() {
    setError(null)
    setCandidates({})
    setKeyEst(null)
    setKeyDetectOff(null)
    setChosen(null)
    setTranscript(''); setInterim('')
    finalsRef.current = ''; interimRef.current = ''; lastQueryRef.current = ''; bestScoreRef.current = 0
    startedAtRef.current = Date.now()
    listeningRef.current = true
    setElapsed(0)
    setPhase('starting')
    const clock = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current
      setElapsed(ms)
      if (ms >= MAX_LISTEN_MS) { stopAll('done'); return }
      // Shazam moment: unmistakable match + a settled key → stop early.
      if (ms > 8_000 && bestScoreRef.current >= AUTO_STOP_SCORE && (keyEstRef.current?.confidence ?? 0) >= 0.5) stopAll('done')
    }, 250)
    timersRef.current.push(clock)
    startRecognition(true)
  }
  useEffect(() => { keyEstRef.current = keyEst }, [keyEst])

  async function searchTyped() {
    if (!typed.trim()) return
    setSearching(true)
    setCandidates({})
    lastQueryRef.current = ''
    await runQuery(typed)
    setSearching(false)
    setPhase('done')
  }

  /* ---------------- derived ---------------- */

  const ranked = useMemo(() => Object.values(candidates).sort((a, b) => b.score - a.score), [candidates])
  const top = ranked[0] ?? null

  // Detected key, snapped to the identified song's mode when we know it.
  const detected = useMemo(() => {
    if (!keyEst) return null
    const sheetMode: Mode | null = modeOfKey(top?.stored_key)
    const pick = sheetMode ? snapToMode(keyEst, sheetMode) : keyEst.ranked[0]
    const snapped = sheetMode !== null && (pick.tonic !== keyEst.tonic || pick.mode !== keyEst.mode)
    return { label: keyLabel(pick.tonic, pick.mode), mode: pick.mode, confidence: keyEst.confidence, snapped, sheetMode }
  }, [keyEst, top])

  /* ---------------- go live ---------------- */

  const [goKey, setGoKey] = useState<string | null>(null)
  const [going, setGoing] = useState(false)
  function choose(c: Candidate) {
    setChosen(c)
    setGoKey(detected?.label ?? c.stored_key ?? null)
  }
  async function goLive() {
    if (!chosen || !target) return
    setGoing(true)
    const { error: err } = await getClient().rpc('set_impromptu', {
      p_service_id: target.id,
      p_library_song_id: chosen.library_song_id,
      p_key: goKey,
    })
    if (err) { console.error('[identify] set_impromptu', err); setError('Couldn’t go live — try again.'); setGoing(false); return }
    router.push(`/services/${target.id}/live`)
  }

  const listening = phase === 'listening' || phase === 'starting'
  const secs = Math.floor(elapsed / 1000)
  const chosenMode: Mode = modeOfKey(goKey) ?? modeOfKey(chosen?.stored_key) ?? detected?.mode ?? 'major'

  /* ---------------- render ---------------- */

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-56">
        <Link href={backHref} className="inline-flex items-center gap-2 mb-5 text-zinc-500 text-sm active:text-zinc-300 transition-colors">
          <span className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </span>
          Back
        </Link>

        <h1 className="text-2xl font-bold leading-tight">Which song is this?</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Hold the phone toward the singer. A few words is enough.
          {target
            ? <> Goes live on <span className="text-zinc-300">{target.isToday ? 'today’s service' : `${target.label}’s service`}</span>.</>
            : <> No service yet — you can still open the chords.</>}
        </p>

        {/* The button */}
        <div className="flex flex-col items-center mt-10 mb-8">
          <button
            onClick={() => (listening ? stopAll('done') : begin())}
            disabled={!srSupported && !listening}
            aria-label={listening ? 'Stop listening' : 'Start listening'}
            className="relative w-32 h-32 rounded-full flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
          >
            {listening && (
              <>
                <span className="absolute inset-0 rounded-full bg-purple-600/30 animate-ping" />
                <span className="absolute -inset-3 rounded-full border border-purple-500/30 animate-pulse" />
              </>
            )}
            <span className={`relative w-32 h-32 rounded-full flex items-center justify-center shadow-lg shadow-purple-950/60 ring-1 ${
              listening ? 'bg-purple-600 ring-purple-400/60' : 'bg-gradient-to-br from-purple-600 via-purple-700 to-purple-950 ring-purple-500/40'
            }`}>
              {listening ? (
                <span className="w-9 h-9 rounded-md bg-white" />
              ) : (
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              )}
            </span>
          </button>
          <p className="mt-4 text-sm font-semibold text-zinc-300">
            {phase === 'starting' && 'Starting…'}
            {phase === 'listening' && `Listening · 0:${String(secs).padStart(2, '0')}`}
            {phase === 'idle' && (srSupported ? 'Tap to listen' : 'Voice isn’t available in this browser')}
            {phase === 'done' && (top ? 'Here’s what I heard' : 'Nothing matched — try again closer to the singer')}
          </p>
          {(transcript || interim) && (
            <p className="mt-2 text-center text-xs text-zinc-500 italic leading-relaxed max-w-xs">
              “…{[transcript, interim].join(' ').trim().split(/\s+/).slice(-18).join(' ')}”
            </p>
          )}
        </div>

        {/* Key chip */}
        {(listening || phase === 'done') && (
          <div className="flex justify-center mb-6">
            {detected ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-zinc-900 border border-zinc-800 pl-3 pr-4 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Key</span>
                <span className="text-lg font-black text-purple-300">{detected.label}</span>
                <span className="text-[11px] text-zinc-500">
                  {detected.confidence >= 0.6 ? 'confident' : detected.confidence >= 0.3 ? 'likely' : 'guessing'}
                  {detected.snapped && ` · ${detected.sheetMode} like the sheet`}
                </span>
              </div>
            ) : keyDetectOff ? (
              <p className="text-[11px] text-zinc-600">Key detection off — {keyDetectOff}</p>
            ) : listening ? (
              <p className="text-[11px] text-zinc-600">Listening for the key…</p>
            ) : null}
          </div>
        )}

        {/* Candidates */}
        {ranked.length > 0 && (
          <div className="space-y-2 mb-8">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
              {top && top.score >= STRONG ? 'Best match' : 'Could be'}
            </p>
            {ranked.slice(0, 5).map((c, i) => {
              const strong = c.score >= STRONG
              const isTop = i === 0
              return (
                <button
                  key={c.library_song_id}
                  onClick={() => choose(c)}
                  className={`w-full text-left rounded-2xl px-4 py-3.5 border transition-colors active:bg-zinc-800 ${
                    isTop && strong
                      ? 'bg-purple-950/40 border-purple-700/60 ring-1 ring-purple-600/30'
                      : 'bg-zinc-900 border-zinc-800/60'
                  } ${chosen?.library_song_id === c.library_song_id ? 'ring-2 ring-purple-400' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold truncate ${isTop && strong ? 'text-white text-base' : 'text-zinc-200 text-sm'}`}>{c.title}</p>
                      <p className="text-[11px] text-zinc-500 truncate">
                        {c.artist ?? (c.matched_via === 'title' ? 'matched by title' : 'matched by lyrics')}
                      </p>
                    </div>
                    {c.stored_key && (
                      <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                        sheet in {c.stored_key}
                      </span>
                    )}
                    <svg className="w-4 h-4 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={`h-full rounded-full ${strong ? 'bg-purple-500' : 'bg-zinc-600'}`} style={{ width: `${Math.round(Math.min(1, c.score) * 100)}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {error && <p className="mb-6 text-center text-sm text-amber-500">{error}</p>}

        {/* Typed fallback — iOS without voice, or a leader who just announced the title */}
        <div className="rounded-2xl bg-zinc-950 border border-zinc-800/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">Or type a lyric or title</p>
          <form onSubmit={e => { e.preventDefault(); searchTyped() }} className="flex gap-2">
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="you’re the God who fights for me…"
              className="flex-1 min-w-0 rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600"
            />
            <button type="submit" disabled={searching || !typed.trim()} className="shrink-0 rounded-xl bg-zinc-800 px-4 text-sm font-semibold text-white disabled:opacity-40 active:scale-95 transition-transform">
              {searching ? '…' : 'Find'}
            </button>
          </form>
        </div>
      </div>

      {/* Confirm sheet */}
      {chosen && (
        <div
          className="fixed left-0 right-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 pt-3 pb-4"
          // sits on top of the bottom tab bar, never under it
          style={{ bottom: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom))` }}
        >
          <div className="max-w-lg mx-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Go live with</p>
                <p className="font-bold text-white truncate">{chosen.title}</p>
              </div>
              <button onClick={() => setChosen(null)} className="shrink-0 text-zinc-500 text-sm py-1 px-2 active:text-zinc-300">Cancel</button>
            </div>

            {/* Key row — detected key preselected; tap to correct */}
            <div className="mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mr-1">Key</span>
              {ALL_KEYS.map(k => {
                const label = chosenMode === 'minor' ? `${k}m` : k
                const on = goKey === label
                return (
                  <button key={k} onClick={() => setGoKey(label)}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${on ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
                    {label}
                  </button>
                )
              })}
              <button onClick={() => setGoKey(null)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold ${goKey === null ? 'bg-purple-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                as written
              </button>
            </div>
            {detected && goKey === detected.label && (
              <p className="mt-1 text-[11px] text-zinc-500">Detected from the room — change it if the leader moved.</p>
            )}

            <div className="mt-3 flex gap-2">
              <Link href={`/library/${chosen.library_song_id}`}
                className="flex-1 rounded-xl bg-zinc-800 py-3.5 text-center text-sm font-semibold text-white active:scale-95 transition-transform">
                Open chords
              </Link>
              {target && (
                <button onClick={goLive} disabled={going}
                  className="flex-[1.4] rounded-xl bg-purple-600 py-3.5 text-sm font-bold text-white disabled:opacity-50 active:scale-95 transition-transform">
                  {going ? 'Going live…' : `Go live · ${target.label}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** window.setTimeout typed for the browser (avoids Node's Timeout type). */
function window_setTimeout(fn: () => void, ms: number): number {
  return window.setTimeout(fn, ms)
}

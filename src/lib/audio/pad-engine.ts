import { keyIndex } from '@/lib/chords/format'

/**
 * Ambient worship pad, synthesised live in the browser (Web Audio).
 *
 * No audio files: any key instantly, mid-song key changes crossfade, and
 * the movement is locked to the song's tempo — the lowpass filter breathes
 * once every 2 bars, the level swells every 4, high layers drift in and out.
 * The four tones were chosen by ear from offline renders of exactly this
 * graph (scratch: padsynth.py / padsynth2.py), so the numbers below are the
 * ones Issac approved, not guesses.
 *
 * Graph per key ("voice set"):
 *   layers (3 detuned oscillators each) → sum → lowpass (LFO on frequency)
 *   → chorus (2 modulated delays + dry) → reverb (synthetic IR convolver,
 *   wet/dry) → swell gain (LFO) → voice gain (crossfade) → master
 * Master: volume → limiter (DynamicsCompressor) → safety gain → destination.
 *
 * Key change / tone change = build a new voice set, ramp it in over
 * CROSSFADE_S while the old one ramps out, then tear the old one down.
 */

export type PadTone = 'shimmer' | 'warm' | 'glass' | 'air'
export const PAD_TONES: Array<{ id: PadTone; name: string; blurb: string }> = [
  { id: 'shimmer', name: 'Shimmer', blurb: 'Full and bright, a high layer that swells' },
  { id: 'warm', name: 'Warm', blurb: 'Round and soft, sits under everything' },
  { id: 'glass', name: 'Glass', blurb: 'Heavenly — high sines over a light bed' },
  { id: 'air', name: 'Air', blurb: 'The softest: pure tones, almost all wash' },
]

interface Layer {
  /** frequency as a multiple of the root; 'third' = the key's 3rd (major/minor) an octave up */
  ratio: number | 'third'
  kind: OscillatorType
  gain: number
  /** high layers drift in and out every 2 bars */
  drift?: boolean
}
interface Preset {
  /** root register: 2 → A2 (110 Hz) region, 3 → A3 (220 Hz) region */
  octave: 2 | 3
  layers: Layer[]
  cutoff: [number, number]
  wet: number
  rt60: number
  chorusRate: number
  spreadCents: number
}

const PRESETS: Record<PadTone, Preset> = {
  shimmer: {
    octave: 2,
    layers: [
      { ratio: 1, kind: 'sawtooth', gain: 0.7 },
      { ratio: 1.5, kind: 'triangle', gain: 0.6 },
      { ratio: 2, kind: 'sawtooth', gain: 0.5 },
      { ratio: 4, kind: 'sine', gain: 0.35, drift: true },
      { ratio: 6, kind: 'sine', gain: 0.18, drift: true },
    ],
    cutoff: [700, 3000], wet: 0.6, rt60: 6.5, chorusRate: 0.3, spreadCents: 7,
  },
  warm: {
    octave: 3,
    layers: [
      { ratio: 0.5, kind: 'sine', gain: 0.35 },
      { ratio: 1, kind: 'triangle', gain: 0.9 },
      { ratio: 1.5, kind: 'triangle', gain: 0.6 },
      { ratio: 2, kind: 'sine', gain: 0.5 },
      { ratio: 3, kind: 'sine', gain: 0.3, drift: true },
    ],
    cutoff: [900, 2200], wet: 0.6, rt60: 6.0, chorusRate: 0.2, spreadCents: 5,
  },
  glass: {
    octave: 3,
    layers: [
      { ratio: 1, kind: 'triangle', gain: 0.6 },
      { ratio: 1.5, kind: 'sine', gain: 0.5 },
      { ratio: 2, kind: 'triangle', gain: 0.45 },
      { ratio: 'third', kind: 'sine', gain: 0.3 },
      { ratio: 3, kind: 'sine', gain: 0.35, drift: true },
      { ratio: 4, kind: 'sine', gain: 0.3, drift: true },
      { ratio: 6, kind: 'sine', gain: 0.15, drift: true },
    ],
    cutoff: [1500, 4500], wet: 0.7, rt60: 7.5, chorusRate: 0.3, spreadCents: 9,
  },
  air: {
    octave: 3,
    layers: [
      { ratio: 1, kind: 'sine', gain: 0.7 },
      { ratio: 1.5, kind: 'sine', gain: 0.55 },
      { ratio: 2, kind: 'sine', gain: 0.6 },
      { ratio: 3, kind: 'sine', gain: 0.4, drift: true },
      { ratio: 4, kind: 'sine', gain: 0.3, drift: true },
      { ratio: 8, kind: 'sine', gain: 0.08, drift: true },
    ],
    cutoff: [2000, 6000], wet: 0.75, rt60: 8.0, chorusRate: 0.22, spreadCents: 10,
  },
}

const CROSSFADE_S = 4
const ATTACK_S = 4.5
const RELEASE_S = 4
const DEFAULT_BPM = 72
/** Overall level so the pad never dominates — the volume control sits on top. */
// Level-matched by measurement (headless Chrome, A, 72 bpm): each tone sits
// around -20 dBFS RMS / -9 dBFS peak at full volume — line level for a desk.
const PRESET_TRIM: Record<PadTone, number> = { shimmer: 0.42, warm: 0.36, glass: 0.42, air: 0.36 }

/** Root frequency for a key in the preset's register. "F#m" → F# root, minor. */
function rootFreq(key: string, octave: 2 | 3): { freq: number; minor: boolean } | null {
  const idx = keyIndex(key)
  if (idx === null) return null
  const minor = /m$/.test(key.trim())
  // A2 = 110, A3 = 220. Keep the root within [G, F#] of that octave so the
  // register stays consistent from key to key (B2 is 123 Hz, G2 is 98 Hz).
  let f = (octave === 2 ? 110 : 220) * 2 ** ((idx - 9) / 12)
  const lo = octave === 2 ? 98 : 196
  if (f < lo) f *= 2
  return { freq: f, minor }
}

interface VoiceSet {
  key: string
  tone: PadTone
  out: GainNode
  nodes: AudioNode[]
  oscs: OscillatorNode[]
  lfos: { node: OscillatorNode; barsPerCycle: number }[]
}

export class PadEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private irCache = new Map<number, AudioBuffer>()
  private current: VoiceSet | null = null
  private unlockEl: HTMLAudioElement | null = null
  private bpm = DEFAULT_BPM
  private volume = 0.8

  get isRunning(): boolean { return this.current !== null }
  get playingKey(): string | null { return this.current?.key ?? null }

  /** Must be called from a user gesture the first time (autoplay rules). */
  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx({ latencyHint: 'playback' })
    const master = ctx.createGain()
    master.gain.value = this.volume
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    const safety = ctx.createGain()
    safety.gain.value = 0.9
    master.connect(limiter).connect(safety).connect(ctx.destination)
    this.ctx = ctx; this.master = master; this.limiter = limiter
    return ctx
  }

  /**
   * iOS routes Web Audio as "ambient" and the ring/silent switch mutes it —
   * unless an <audio> element is playing. A looping silent clip flips the
   * category to playback. Harmless everywhere else.
   */
  private unlockIOS(): void {
    if (this.unlockEl) { this.unlockEl.play().catch(() => {}); return }
    const sr = 8000, n = sr / 10
    const buf = new ArrayBuffer(44 + n * 2)
    const v = new DataView(buf)
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true)
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true)
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true)
    const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })))
    el.loop = true; el.volume = 0.01
    el.play().catch(() => {})
    this.unlockEl = el
  }

  private impulse(ctx: AudioContext, rt60: number): AudioBuffer {
    const cached = this.irCache.get(rt60)
    if (cached) return cached
    const n = Math.floor(ctx.sampleRate * rt60)
    const buf = ctx.createBuffer(2, n, ctx.sampleRate)
    const decay = 6.91 / rt60 / ctx.sampleRate
    // One-pole lowpass on the noise so the tail is darker than the attack.
    const k = Math.exp(-2 * Math.PI * 3500 / ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let lp = 0, energy = 0
      for (let i = 0; i < n; i++) {
        lp = k * lp + (1 - k) * (Math.random() * 2 - 1)
        d[i] = lp * Math.exp(-i * decay)
        energy += d[i] * d[i]
      }
      const norm = 1 / Math.sqrt(energy)
      for (let i = 0; i < n; i++) d[i] *= norm
    }
    this.irCache.set(rt60, buf)
    return buf
  }

  private barSeconds(): number { return (60 / this.bpm) * 4 }

  private buildVoiceSet(key: string, tone: PadTone): VoiceSet | null {
    const ctx = this.ensureContext()
    const p = PRESETS[tone]
    const root = rootFreq(key, p.octave)
    if (!root) return null
    const t0 = ctx.currentTime
    const nodes: AudioNode[] = []
    const oscs: OscillatorNode[] = []
    const lfos: VoiceSet['lfos'] = []
    const bar = this.barSeconds()

    const sum = ctx.createGain(); sum.gain.value = PRESET_TRIM[tone]; nodes.push(sum)

    p.layers.forEach((layer, li) => {
      const f = layer.ratio === 'third'
        ? root.freq * 2 ** ((root.minor ? 3 : 4) / 12) * 2
        : root.freq * layer.ratio
      const lg = ctx.createGain(); nodes.push(lg)
      if (layer.drift) {
        // gain = 0.65·g + 0.35·g·sin(2π t / 2 bars), phases staggered by rate
        lg.gain.value = 0.65 * layer.gain
        const lfo = ctx.createOscillator(); lfo.type = 'sine'
        lfo.frequency.value = (1 / (bar * 2)) * (1 + 0.07 * li)
        const amt = ctx.createGain(); amt.gain.value = 0.35 * layer.gain
        lfo.connect(amt).connect(lg.gain); lfo.start(t0)
        nodes.push(amt); oscs.push(lfo); lfos.push({ node: lfo, barsPerCycle: 2 / (1 + 0.07 * li) })
      } else {
        lg.gain.value = layer.gain
      }
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator()
        o.type = layer.kind
        o.frequency.value = f
        o.detune.value = (i - 1) * p.spreadCents
        o.connect(lg); o.start(t0); oscs.push(o)
      }
      lg.connect(sum)
    })

    // Lowpass that breathes once every 2 bars between cutoff[0]..cutoff[1]
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 0.707
    filt.frequency.value = (p.cutoff[0] + p.cutoff[1]) / 2
    const fl = ctx.createOscillator(); fl.type = 'sine'; fl.frequency.value = 1 / (bar * 2)
    const famt = ctx.createGain(); famt.gain.value = (p.cutoff[1] - p.cutoff[0]) / 2
    fl.connect(famt).connect(filt.frequency); fl.start(t0)
    nodes.push(filt, famt); oscs.push(fl); lfos.push({ node: fl, barsPerCycle: 2 })
    sum.connect(filt)

    // Chorus: dry + two modulated delays, halved
    const chorusOut = ctx.createGain(); chorusOut.gain.value = 0.5; nodes.push(chorusOut)
    filt.connect(chorusOut)
    ;[1, 1.37].forEach(mult => {
      const d = ctx.createDelay(0.05); d.delayTime.value = 0.018
      const dl = ctx.createOscillator(); dl.type = 'sine'; dl.frequency.value = p.chorusRate * mult
      const damt = ctx.createGain(); damt.gain.value = 0.0025
      dl.connect(damt).connect(d.delayTime); dl.start(t0)
      const dg = ctx.createGain(); dg.gain.value = 0.5
      filt.connect(d).connect(dg).connect(chorusOut)
      nodes.push(d, damt, dg); oscs.push(dl)
    })

    // Reverb: (1-wet)·dry + wet·0.5·conv
    const conv = ctx.createConvolver(); conv.buffer = this.impulse(ctx, p.rt60); conv.normalize = false
    const dry = ctx.createGain(); dry.gain.value = 1 - p.wet
    const wetG = ctx.createGain(); wetG.gain.value = p.wet * 0.5
    const mix = ctx.createGain(); mix.gain.value = 1
    chorusOut.connect(dry).connect(mix)
    chorusOut.connect(conv).connect(wetG).connect(mix)
    nodes.push(conv, dry, wetG, mix)

    // 4-bar swell: 0.88 + 0.12·sin
    const swell = ctx.createGain(); swell.gain.value = 0.88
    const sl = ctx.createOscillator(); sl.type = 'sine'; sl.frequency.value = 1 / (bar * 4)
    const samt = ctx.createGain(); samt.gain.value = 0.12
    sl.connect(samt).connect(swell.gain); sl.start(t0)
    mix.connect(swell); nodes.push(swell, samt); oscs.push(sl); lfos.push({ node: sl, barsPerCycle: 4 })

    // Crossfade gain — starts silent, the caller ramps it
    const out = ctx.createGain(); out.gain.value = 0
    swell.connect(out); out.connect(this.master!)
    nodes.push(out)

    return { key, tone, out, nodes, oscs, lfos }
  }

  private teardown(vs: VoiceSet, afterSeconds: number): void {
    const ctx = this.ctx!
    const at = ctx.currentTime + afterSeconds
    vs.oscs.forEach(o => { try { o.stop(at) } catch { /* already stopped */ } })
    window.setTimeout(() => {
      vs.nodes.forEach(n => { try { n.disconnect() } catch { /* ok */ } })
    }, (afterSeconds + 0.5) * 1000)
  }

  /**
   * Call inside the user's tap, even when there's no key to play yet: creates
   * and resumes the AudioContext while the gesture is live, so a later
   * play() from a song change isn't blocked by autoplay rules.
   */
  prime(): void {
    const ctx = this.ensureContext()
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    this.unlockIOS()
  }

  /** Start (or switch to) a key. Safe to call repeatedly; same key+tone is a no-op. */
  async play(key: string, tone: PadTone, bpm: number | null): Promise<boolean> {
    const ctx = this.ensureContext()
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    this.unlockIOS()
    if (bpm && bpm > 20 && bpm < 300) this.setBpm(bpm)
    if (this.current && this.current.key === key && this.current.tone === tone) return true

    const next = this.buildVoiceSet(key, tone)
    if (!next) return false
    const now = ctx.currentTime
    const fade = this.current ? CROSSFADE_S : ATTACK_S
    next.out.gain.setValueAtTime(0, now)
    next.out.gain.linearRampToValueAtTime(1, now + fade)
    if (this.current) {
      const old = this.current
      old.out.gain.cancelScheduledValues(now)
      old.out.gain.setValueAtTime(old.out.gain.value, now)
      old.out.gain.linearRampToValueAtTime(0, now + CROSSFADE_S)
      this.teardown(old, CROSSFADE_S)
    }
    this.current = next
    return true
  }

  setBpm(bpm: number): void {
    if (!(bpm > 20 && bpm < 300) || bpm === this.bpm) return
    this.bpm = bpm
    if (!this.current || !this.ctx) return
    const bar = this.barSeconds()
    const now = this.ctx.currentTime
    for (const { node, barsPerCycle } of this.current.lfos) {
      node.frequency.setTargetAtTime(1 / (bar * barsPerCycle), now, 2)
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
  }

  stop(): void {
    if (!this.current || !this.ctx) return
    const now = this.ctx.currentTime
    const cur = this.current
    cur.out.gain.cancelScheduledValues(now)
    cur.out.gain.setValueAtTime(cur.out.gain.value, now)
    cur.out.gain.linearRampToValueAtTime(0, now + RELEASE_S)
    this.teardown(cur, RELEASE_S)
    this.current = null
    if (this.unlockEl) { this.unlockEl.pause() }
  }

  /** Full shutdown (page leaving). */
  dispose(): void {
    this.stop()
    window.setTimeout(() => { this.ctx?.close().catch(() => {}); this.ctx = null; this.master = null; this.limiter = null }, (RELEASE_S + 1) * 1000)
  }
}

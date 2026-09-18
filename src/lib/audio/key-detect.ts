/**
 * On-device key estimation — no API, no upload, nothing leaves the phone.
 *
 * 1. Web Audio hands us an FFT magnitude spectrum every ~100ms.
 * 2. accumulateChroma() folds every tuned spectral PEAK onto its pitch
 *    class (C, C#, … B) — a 12-bin "how much of each note is in the room".
 * 3. estimateKey() correlates that against the 24 Krumhansl-Kessler key
 *    profiles (12 major, 12 minor). Best correlation wins.
 *
 * Known weakness: a key and its relative minor (G / Em) look nearly the
 * same. snapToMode() fixes that using what we DO know — the identified
 * song's sheet is written in major or minor — so the caller can ask for
 * "the best minor key" instead of "the best key".
 */

// Krumhansl & Kessler (1982) probe-tone profiles, C-rooted.
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** Spelling the rest of the app uses (ALL_KEYS in chords/format.ts). */
const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export type Mode = 'major' | 'minor'
export interface KeyCandidate { tonic: number; mode: Mode; r: number }
export interface KeyEstimate {
  tonic: number
  mode: Mode
  /** 0–1: how far the winner is ahead of the runner-up */
  confidence: number
  ranked: KeyCandidate[]
}

export function keyLabel(tonic: number, mode: Mode): string {
  return KEY_NAMES[((tonic % 12) + 12) % 12] + (mode === 'minor' ? 'm' : '')
}

/** "F#m" → minor, "G" → major, anything else → null. */
export function modeOfKey(key: string | null | undefined): Mode | null {
  if (!key) return null
  const m = key.trim().match(/^[A-G](?:#|b)?(m)?$/)
  if (!m) return null
  return m[1] ? 'minor' : 'major'
}

/**
 * Fold one FFT frame onto the 12 pitch classes, in place.
 * @param power  linear power per bin (NOT dB)
 * @param sampleRate  AudioContext.sampleRate
 * @param fftSize  analyser.fftSize (power.length === fftSize / 2)
 */
export function accumulateChroma(
  power: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  chroma: Float64Array,
  opts: { fMin?: number; fMax?: number } = {},
): void {
  const fMin = opts.fMin ?? 70     // below the low E on a bass — rumble
  const fMax = opts.fMax ?? 1200   // fundamentals live here; above is mostly harmonics + consonants
  const binHz = sampleRate / fftSize
  const lo = Math.max(1, Math.ceil(fMin / binHz))
  const hi = Math.min(power.length - 2, Math.floor(fMax / binHz))

  // Loudest bin in range → every frame votes with the same total weight, and
  // log compression stops one held note from drowning the rest of the frame
  // (linear power made a single sustained "aaah" decide the whole key).
  let max = 0
  for (let i = lo; i <= hi; i++) if (power[i] > max) max = power[i]
  if (!(max > 0)) return

  for (let i = lo; i <= hi; i++) {
    const p = power[i]
    // Only spectral peaks count — the floor between harmonics is noise.
    if (p <= power[i - 1] || p < power[i + 1]) continue
    const rel = p / max
    if (rel < 0.001) continue // 30 dB below the frame's loudest — noise floor
    const f = i * binHz
    const pitch = 12 * Math.log2(f / 440) + 69
    const nearest = Math.round(pitch)
    // A peak sitting between two semitones isn't a note (drum ring, breath).
    if (Math.abs(pitch - nearest) > 0.35) continue
    chroma[((nearest % 12) + 12) % 12] += Math.log1p(100 * rel)
  }
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0, mb = 0
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i] }
  ma /= 12; mb /= 12
  let num = 0, da = 0, db = 0
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma, y = b[i] - mb
    num += x * y; da += x * x; db += y * y
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db)
}

export function estimateKey(chroma: ArrayLike<number>): KeyEstimate | null {
  let total = 0
  for (let i = 0; i < 12; i++) total += chroma[i]
  if (!(total > 0)) return null

  const ranked: KeyCandidate[] = []
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotMaj = new Array<number>(12), rotMin = new Array<number>(12)
    for (let i = 0; i < 12; i++) {
      rotMaj[(i + tonic) % 12] = KK_MAJOR[i]
      rotMin[(i + tonic) % 12] = KK_MINOR[i]
    }
    ranked.push({ tonic, mode: 'major', r: pearson(chroma, rotMaj) })
    ranked.push({ tonic, mode: 'minor', r: pearson(chroma, rotMin) })
  }
  ranked.sort((a, b) => b.r - a.r)
  const best = ranked[0]
  if (best.r < 0.4) return null // nothing tonal enough to call
  // Runner-up that is NOT just the relative major/minor of the winner — that
  // pair is always close and would make every estimate look uncertain.
  const rel = relative(best)
  const runner = ranked.find(c => !(c.tonic === best.tonic && c.mode === best.mode) && !(c.tonic === rel.tonic && c.mode === rel.mode))
  const gap = best.r - (runner?.r ?? 0)
  return { tonic: best.tonic, mode: best.mode, confidence: Math.max(0, Math.min(1, gap / 0.2)), ranked }
}

/** G major ↔ E minor. */
export function relative(c: { tonic: number; mode: Mode }): { tonic: number; mode: Mode } {
  return c.mode === 'major'
    ? { tonic: (c.tonic + 9) % 12, mode: 'minor' }
    : { tonic: (c.tonic + 3) % 12, mode: 'major' }
}

/**
 * The key in a given mode — used once the song is identified and we know
 * its sheet is major or minor. Turns a G/Em coin-flip into a fact.
 *
 * The relative key of the winner comes first: G-major chroma asked for
 * "minor" should say Em (same notes), not whichever unrelated minor key
 * happens to correlate a hair better. Only if the relative is clearly
 * worse do we fall back to the best key in that mode.
 */
export function snapToMode(est: KeyEstimate, mode: Mode): KeyCandidate {
  const best = est.ranked[0]
  if (best.mode === mode) return best
  const rel = relative(best)
  const relC = est.ranked.find(c => c.tonic === rel.tonic && c.mode === rel.mode)
  const bestInMode = est.ranked.find(c => c.mode === mode)
  if (relC && bestInMode && relC.r >= bestInMode.r - 0.08) return relC
  return bestInMode ?? best
}

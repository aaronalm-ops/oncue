import { keyAtOffset, keyIndex } from '@/lib/chords/format'
import type { KeyCandidate, Mode } from '@/lib/audio/key-detect'
import { modeOfKey } from '@/lib/audio/key-detect'

/**
 * Song-aware key detection.
 *
 * Generic key profiles (Krumhansl-Kessler) answer "which key do these notes
 * suggest?" — fine for a band, weak for one voice: a melody sitting on the
 * 3rd and 5th of A major reads as C# to a generic profile. But once the song
 * is identified we know its CHORDS, so we can ask the far narrower question:
 * "which transposition of THIS song's notes fits what the mic heard?"
 *
 * The sheet's chords become a 12-bin note profile in the sheet's key; we
 * rotate it through all 12 transpositions and pick the best fit. Mode
 * ambiguity disappears too — the song's chords already decide major/minor.
 */

const NOTE: Record<string, number> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4,
  F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
  'A#': 10, Bb: 10, B: 11, Cb: 11,
}

/** Pitch classes (with weights) for one chord symbol, e.g. "F#m7/A". */
export function chordPitchClasses(symbol: string): Array<[pc: number, weight: number]> {
  const m = symbol.trim().match(/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?/)
  if (!m) return []
  const root = NOTE[m[1]]
  if (root === undefined) return []
  const q = m[2] ?? ''
  const out: Array<[number, number]> = [[root, 1.5]]

  const minor = /^(m(?!aj)|min|dim)/.test(q)
  const dim = /^dim/.test(q)
  const aug = /^aug|\+/.test(q)
  const sus2 = /sus2/.test(q)
  const sus4 = /sus4|sus(?!2)/.test(q)

  if (sus2) out.push([(root + 2) % 12, 1])
  else if (sus4) out.push([(root + 5) % 12, 1])
  else out.push([(root + (minor ? 3 : 4)) % 12, 1])

  out.push([(root + (dim ? 6 : aug ? 8 : 7)) % 12, 0.8])

  if (/maj7|M7/.test(q)) out.push([(root + 11) % 12, 0.5])
  else if (/7/.test(q)) out.push([(root + 10) % 12, 0.5])
  if (/6/.test(q)) out.push([(root + 9) % 12, 0.4])
  if (/(^|[^1])2\b|add9|9/.test(q)) out.push([(root + 2) % 12, 0.4])
  if (/add4|11/.test(q)) out.push([(root + 5) % 12, 0.3])

  if (m[3] && NOTE[m[3]] !== undefined) out.push([NOTE[m[3]], 0.7])
  return out
}

/** All [chords] in a ChordPro body → 12-bin profile in the sheet's own key. */
export function songChordProfile(body: string): Float64Array | null {
  const profile = new Float64Array(12)
  let n = 0
  const re = /\[([^\]\n]{1,24})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const pcs = chordPitchClasses(m[1])
    if (!pcs.length) continue
    n++
    for (const [pc, w] of pcs) profile[pc] += w
  }
  return n >= 2 ? profile : null
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

export interface SongKeyMatch {
  /** key the room is in, spelled like the app's keys ("A", "F#m") */
  key: string
  /** semitones above the sheet's stored key */
  offset: number
  confidence: number
  ranked: Array<{ key: string; offset: number; r: number }>
  mode: Mode
}

/**
 * Which transposition of the song fits the room?
 * @param chroma     what the mic heard (12 bins)
 * @param profile    songChordProfile() of the sheet
 * @param storedKey  the key the sheet is written in ("A", "F#m")
 */
export function matchKeyToSong(chroma: ArrayLike<number>, profile: Float64Array, storedKey: string): SongKeyMatch | null {
  const base = keyIndex(storedKey)
  if (base === null) return null
  let total = 0
  for (let i = 0; i < 12; i++) total += chroma[i]
  if (!(total > 0)) return null

  // sqrt-compress both sides so one dominant melody note (the 3rd, say)
  // can't outvote the rest, then penalise energy on notes the song never
  // uses at all — scale membership is the strongest clue a lone voice gives.
  const cs = Array.from({ length: 12 }, (_, i) => Math.sqrt(chroma[i]))
  let nc = 0
  for (let i = 0; i < 12; i++) nc += cs[i] * cs[i]

  const ranked: Array<{ key: string; offset: number; r: number }> = []
  for (let k = 0; k < 12; k++) {
    const rot = new Array<number>(12)
    for (let i = 0; i < 12; i++) rot[(i + k) % 12] = Math.sqrt(profile[i])
    let out = 0
    for (let i = 0; i < 12; i++) if (rot[i] === 0) out += cs[i] * cs[i]
    ranked.push({ key: keyAtOffset(storedKey, k), offset: k, r: pearson(cs, rot) - 1.5 * (nc ? out / nc : 0) })
  }
  ranked.sort((a, b) => b.r - a.r)
  const best = ranked[0]
  if (best.r < 0.25) return null
  const gap = best.r - ranked[1].r
  return {
    key: best.key,
    offset: best.offset,
    confidence: Math.max(0, Math.min(1, gap / 0.12)),
    ranked,
    mode: modeOfKey(storedKey) ?? 'major',
  }
}

/** Convenience for callers holding KK candidates: same shape as key-detect. */
export function asKeyCandidate(m: SongKeyMatch): KeyCandidate {
  const idx = keyIndex(m.key) ?? 0
  return { tonic: idx, mode: m.mode, r: m.ranked[0].r }
}

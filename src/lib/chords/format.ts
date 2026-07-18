/**
 * OnCue internal chord text format ("body"). Human-editable, line-based:
 *
 *   # Verse 1              → section header
 *   > Chorus x2            → flow marker (jump to an earlier section)
 *   [G]Praise [C]Him       → lyric line with inline chords
 *   [G] [C] [D]            → instrumental line (chords only)
 *   plain text             → lyric line without chords
 *   (To Verse)  [ to end]  → annotations survive verbatim inside lines
 *
 * Stored in song_versions.content_chordpro. chord_sections rows are derived
 * from this text on approve.
 */

export interface ChordToken {
  chord: string | null // null = plain text run
  text: string
}

export type BodyLine =
  | { type: 'section'; label: string }
  | { type: 'flow'; label: string; times: number }
  | { type: 'line'; parts: ChordToken[]; instrumental: boolean }
  | { type: 'blank' }

export interface DerivedSection {
  order_index: number
  label: string
  content: string
}

// Chord grammar: root + quality/extensions + optional slash bass.
// Deliberately loose on extensions (Em9, F#m7, Esus, A2/7, E7(#9), Bm7, D2)
// so real-world sheets pass through; validity is the reviewer's call.
export const CHORD_RE =
  /^[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add|M)?[0-9]*(?:\((?:[^)]{1,6})\))?(?:(?:\/|\\)[A-G0-9](?:#|b)?[0-9]*)*$/

const ANNOTATION_TOKEN_RE = /^(?:x\d{1,2}|\d{1,2}x|\(\d{1,2}\s*times?\)|\(repeat\)|N\.?C\.?)$/i

export function isChordToken(tok: string): boolean {
  const t = tok.replace(/^[([]+|[)\]]+$/g, '') // tolerate wrapping brackets
  if (!t) return false
  return CHORD_RE.test(t) || ANNOTATION_TOKEN_RE.test(tok)
}

/** ≥70% chordish tokens, nothing word-like, sane length → chord line */
export function isChordLine(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 24) return false
  let chordish = 0
  for (const tok of tokens) {
    if (isChordToken(tok)) chordish++
    else if (/^[a-z]{3,}$/.test(tok)) return false // lowercase word = lyrics
  }
  return chordish / tokens.length >= 0.7
}

export function parseBody(body: string): BodyLine[] {
  const out: BodyLine[] = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (!trimmed) {
      out.push({ type: 'blank' })
      continue
    }
    if (trimmed.startsWith('# ')) {
      out.push({ type: 'section', label: trimmed.slice(2).trim() })
      continue
    }
    if (trimmed.startsWith('> ')) {
      const m = trimmed.slice(2).trim().match(/^(.*?)(?:\s*[x×]\s*(\d{1,2})|\s*(\d{1,2})\s*[x×])?$/i)
      out.push({
        type: 'flow',
        label: (m?.[1] ?? trimmed.slice(2)).trim(),
        times: parseInt(m?.[2] ?? m?.[3] ?? '1', 10) || 1,
      })
      continue
    }
    const parts = parseInlineChords(line)
    // Instrumental = chords with NO lyric text at all. Never classify by
    // "every word has a chord" — "[G]Hallelujah [D]hallelujah" is a lyric
    // line, and treating it as instrumental silently dropped the lyrics.
    const instrumental = parts.some(p => p.chord !== null)
      && parts.every(p => p.text.trim() === '')
    out.push({ type: 'line', parts, instrumental })
  }
  // drop trailing blanks
  while (out.length && out[out.length - 1].type === 'blank') out.pop()
  return out
}

export function parseInlineChords(line: string): ChordToken[] {
  const parts: ChordToken[] = []
  const re = /\[([^\]\n]{1,24})\]/g
  let last = 0
  let m: RegExpExecArray | null
  let pending: string | null = null
  while ((m = re.exec(line)) !== null) {
    const before = line.slice(last, m.index)
    if (pending !== null || before) parts.push({ chord: pending, text: before })
    pending = m[1]
    last = re.lastIndex
  }
  const tail = line.slice(last)
  if (pending !== null || tail) parts.push({ chord: pending, text: tail })
  if (parts.length === 0) parts.push({ chord: null, text: line })
  return parts
}

/** Derive chord_sections rows from body text. Content before any header gets an implicit "Song" section. */
export function deriveSections(body: string): DerivedSection[] {
  const sections: DerivedSection[] = []
  let currentLabel: string | null = null
  let buf: string[] = []

  function flush() {
    const content = buf.join('\n').replace(/^\n+|\n+$/g, '')
    if (currentLabel !== null || content) {
      sections.push({
        order_index: sections.length,
        label: currentLabel ?? 'Song',
        content,
      })
    }
    buf = []
  }

  for (const raw of body.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.startsWith('# ')) {
      flush()
      currentLabel = trimmed.slice(2).trim()
    } else {
      buf.push(raw)
    }
  }
  flush()
  return sections.filter(s => s.label !== 'Song' || s.content !== '')
}

/** Normalise a section label for fuzzy matching: "CHORUS 2 (HE HAS DONE…)" → "chorus" */
export function normalizeSectionLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z]/g, ' ')
    .trim()
    .split(/\s+/)[0] ?? ''
}

/** Full normalised label including number: "Verse 2" → "verse 2" */
export function normalizeSectionLabelFull(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ============================================================
// Transposition — deterministic music theory, no guessing.
// Unknown tokens pass through untouched (the viewer flags them).
// ============================================================

const SHARP_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_SCALE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const NOTE_INDEX: Record<string, number> = {
  'C': 0, 'B#': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'Fb': 4,
  'F': 5, 'E#': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9,
  'A#': 10, 'Bb': 10, 'B': 11, 'Cb': 11,
}
// Keys whose signatures spell flats (majors + common minors)
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'])

export const ALL_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export function keyIndex(key: string): number | null {
  const m = key.trim().match(/^([A-G](?:#|b)?)(m)?$/)
  if (!m) return null
  return NOTE_INDEX[m[1]] ?? null
}

/** Transpose one chord symbol by `semitones`, spelling for `targetKey`. */
export function transposeChord(chord: string, semitones: number, targetKey: string): string {
  if (semitones % 12 === 0) return chord
  const useFlats = FLAT_KEYS.has(targetKey.trim())
  const scale = useFlats ? FLAT_SCALE : SHARP_SCALE

  // Transpose every note-root occurrence: leading root and any post-slash roots.
  return chord.replace(/(^|\/)([A-G](?:#|b)?)/g, (full, prefix: string, note: string) => {
    const idx = NOTE_INDEX[note]
    if (idx === undefined) return full
    return prefix + scale[((idx + semitones) % 12 + 12) % 12]
  })
}

/** Transpose all [chords] in a body text. Non-chord text is untouched. */
export function transposeBody(body: string, fromKey: string, toKey: string): string {
  const from = keyIndex(fromKey)
  const to = keyIndex(toKey)
  if (from === null || to === null) return body
  const semitones = ((to - from) % 12 + 12) % 12
  if (semitones === 0) return body
  return body.replace(/\[([^\]\n]{1,24})\]/g, (_full, chord: string) => {
    return `[${transposeChord(chord, semitones, toKey)}]`
  })
}

// ============================================================
// Chart-flow reorder: rearrange a chord body's sections to follow
// the conductor's chart (Intro → Verse → Chorus → …).
// ============================================================

export interface ReorderResult {
  body: string
  matched: number
  unmatched: string[] // chart labels with no chord section
}

/**
 * Rebuild the body in the order of `chartLabels` (the service chart's section
 * labels, in order). Matching: exact full label first ("verse 2"), then base
 * word ("verse"). A chord section may be reused when the chart repeats it.
 * Chart labels with no match are skipped (reported), and chord sections never
 * matched are appended at the end under their own headers so nothing is lost.
 */
export function reorderBodyToChart(body: string, chartLabels: string[]): ReorderResult {
  const sections = deriveSections(body)
  if (sections.length === 0) return { body, matched: 0, unmatched: [] }

  const byFull = new Map<string, DerivedSection[]>()
  const byBase = new Map<string, DerivedSection[]>()
  for (const s of sections) {
    const full = normalizeSectionLabelFull(s.label)
    const base = normalizeSectionLabel(s.label)
    byFull.set(full, [...(byFull.get(full) ?? []), s])
    byBase.set(base, [...(byBase.get(base) ?? []), s])
  }

  const out: string[] = []
  const used = new Set<number>()
  const unmatched: string[] = []
  let matched = 0
  // Per-label cursor so "VERSE, VERSE" walks Verse 1 → Verse 2, then wraps.
  const cursors = new Map<string, number>()

  for (const chartLabel of chartLabels) {
    const full = normalizeSectionLabelFull(chartLabel)
    const base = normalizeSectionLabel(chartLabel)
    const pool = byFull.get(full)?.length ? byFull.get(full)! : (byBase.get(base) ?? [])
    if (pool.length === 0) {
      unmatched.push(chartLabel)
      continue
    }
    const cursorKey = pool === byFull.get(full) ? `f:${full}` : `b:${base}`
    const cursor = cursors.get(cursorKey) ?? 0
    const section = pool[cursor % pool.length]
    cursors.set(cursorKey, cursor + 1)
    used.add(section.order_index)
    matched++
    // Keep the CHART's label (the conductor's wording) as the header
    out.push(`# ${chartLabel}`)
    if (section.content) out.push(section.content)
    out.push('')
  }

  // Anything never used goes at the end, unchanged
  const leftovers = sections.filter(s => !used.has(s.order_index))
  if (leftovers.length > 0 && matched > 0) {
    for (const s of leftovers) {
      out.push(`# ${s.label}`)
      if (s.content) out.push(s.content)
      out.push('')
    }
  }

  if (matched === 0) return { body, matched: 0, unmatched }
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/g, ''), matched, unmatched }
}

// ============================================================
// Per-chart-section mapping for the combined chart+chords pane:
// one entry per chart section, in chart order, so the pane can
// highlight and follow the live position (index-aligned).
// ============================================================

export interface ChartSectionChords {
  label: string // the chart's label (conductor's wording)
  content: string | null // matched chord content, or null
}

export interface ChartChordsMap {
  sections: ChartSectionChords[]
  leftovers: DerivedSection[] // chord sections the chart never used
  matched: number
}

/**
 * `overrides`: manual chart→chord section maps (chart label normalized-full →
 * chord section label), set by editors when auto-matching can't work
 * (e.g. chart "INSTRUMENTAL SOLO" → sheet "Interlude"). Highest precedence.
 */
export function mapChartSectionsToChords(
  body: string,
  chartLabels: string[],
  overrides?: Record<string, string>,
): ChartChordsMap {
  const chordSections = deriveSections(body)
  const byFull = new Map<string, DerivedSection[]>()
  const byBase = new Map<string, DerivedSection[]>()
  for (const s of chordSections) {
    const full = normalizeSectionLabelFull(s.label)
    const base = normalizeSectionLabel(s.label)
    byFull.set(full, [...(byFull.get(full) ?? []), s])
    byBase.set(base, [...(byBase.get(base) ?? []), s])
  }

  const used = new Set<number>()
  const cursors = new Map<string, number>()
  let matched = 0

  const sections: ChartSectionChords[] = chartLabels.map(chartLabel => {
    const full = normalizeSectionLabelFull(chartLabel)
    const base = normalizeSectionLabel(chartLabel)

    // Manual override first
    const mappedLabel = overrides?.[full]
    let pool: DerivedSection[] = []
    if (mappedLabel !== undefined) {
      pool = byFull.get(normalizeSectionLabelFull(mappedLabel)) ?? []
    }
    if (pool.length === 0) {
      pool = byFull.get(full)?.length ? byFull.get(full)! : (byBase.get(base) ?? [])
    }
    if (pool.length === 0) return { label: chartLabel, content: null }

    const cursorKey = `p:${normalizeSectionLabelFull(pool[0].label)}`
    const cursor = cursors.get(cursorKey) ?? 0
    const section = pool[cursor % pool.length]
    cursors.set(cursorKey, cursor + 1)
    used.add(section.order_index)
    matched++
    return { label: chartLabel, content: section.content || null }
  })

  return {
    sections,
    leftovers: chordSections.filter(s => !used.has(s.order_index)),
    matched,
  }
}

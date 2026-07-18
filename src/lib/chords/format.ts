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
    const instrumental = parts.every(p => p.chord !== null || p.text.trim() === '')
      && parts.some(p => p.chord !== null)
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

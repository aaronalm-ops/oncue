/**
 * Heuristic chord-sheet parser: positioned lines → draft body + metadata.
 * Deterministic, no AI. The review screen is the safety net — this only
 * needs to be right most of the time and obviously wrong the rest.
 */
import type { PositionedLine } from './extract'
import { isChordLine, isChordToken } from './format'

export interface ParsedChordSheet {
  title: string | null
  artist: string | null
  key: string | null
  bpm: number | null
  ccli: string | null
  body: string
  sectionCount: number
  warnings: string[]
}

const KEY_RE = '[A-G](?:#|b)?m?'
const SECTION_VOCAB = new Set([
  'verse', 'chorus', 'bridge', 'intro', 'outro', 'interlude', 'tag', 'ending',
  'turnaround', 'prechorus', 'pre-chorus', 'instrumental', 'vamp', 'refrain',
  'channel', 'hook', 'breakdown',
])
const SECTION_QUALIFIERS = new Set(['last', 'final', 'first'])

function stripDotLeaders(text: string): string {
  return text.replace(/(?:\s*\.){3,}\s*/g, ' ').replace(/\s+$/g, '')
}

function isNoiseLine(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/https?:\/\//i.test(t)) return true
  if (/^©|^\(c\)\s|copyright/i.test(t)) return true
  if (/CCLI/i.test(t)) return true
  if (/For use solely with/i.test(t)) return true
  if (/^Page \d+/i.test(t)) return true
  return false
}

function detectSectionHeader(text: string): string | null {
  const t = text.trim().replace(/:$/, '').trim()
  if (!t || t.length > 40) return null
  const words = t.split(/\s+/)
  if (words.length > 4) return null
  const first = words[0].toLowerCase().replace(/[^a-z-]/g, '')
  if (SECTION_VOCAB.has(first)) return t
  if (
    words.length >= 2 &&
    SECTION_QUALIFIERS.has(first) &&
    SECTION_VOCAB.has(words[1].toLowerCase().replace(/[^a-z-]/g, ''))
  ) return t
  return null
}

/** "-Verse", "-Chorus 2x", "Repeat Chorus", "-Verse (repeat)" → flow */
function detectFlowMarker(text: string): { label: string; times: number } | null {
  const t = text.trim()
  let m = t.match(/^-\s*([A-Za-z][A-Za-z\s-]{2,20}?)\s*(?:[x×]\s*(\d{1,2})|(\d{1,2})\s*[x×])?\s*$/)
  if (!m) m = t.match(/^repeat\s+([A-Za-z][A-Za-z\s-]{2,20}?)\s*(?:[x×]?\s*(\d{1,2}))?\s*$/i)
  if (!m) return null
  const label = m[1].trim()
  const first = label.split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '')
  if (!SECTION_VOCAB.has(first)) return null
  return { label, times: parseInt(m[2] ?? m[3] ?? '1', 10) || 1 }
}

function extractKey(text: string): string | null {
  let m = text.match(new RegExp(`\\(\\s*key\\s+of\\s+(${KEY_RE})\\s*\\)`, 'i'))
  if (m) return m[1]
  m = text.match(new RegExp(`key\\s*[-–:]\\s*(${KEY_RE})(?![a-z0-9#])`, 'i'))
  if (m) return m[1]
  m = text.match(new RegExp(`(?:scale\\s+of|//\\s*scale\\s+of)\\s+(${KEY_RE})(?![a-z0-9#])`, 'i'))
  if (m) return m[1]
  return null
}

function extractTrailingParenKey(text: string): string | null {
  const m = text.match(new RegExp(`\\((${KEY_RE})\\)\\s*$`))
  return m ? m[1] : null
}

/**
 * Align a chord line's tokens over the following lyric line using shared
 * page x-coordinates, producing inline [Chord]lyric text.
 */
function mergeChordAndLyric(chordLine: PositionedLine, lyricLine: PositionedLine): string {
  const em = Math.max(Math.min(chordLine.fontSize, lyricLine.fontSize) * 0.5, 3)
  const origin = Math.min(
    chordLine.words[0]?.x ?? 0,
    lyricLine.words[0]?.x ?? 0,
  )

  // Build the lyric as a column grid so char index ≈ column
  let grid = ''
  for (const w of lyricLine.words) {
    const col = Math.max(0, Math.round((w.x - origin) / em))
    if (col > grid.length) grid = grid.padEnd(col, ' ')
    else if (grid.length > 0 && !grid.endsWith(' ')) grid += ' '
    grid += w.str
  }

  // Chord insert positions (right to left so indices stay valid)
  const chords = chordLine.words
    .map(w => ({ str: w.str, col: Math.max(0, Math.round((w.x - origin) / em)) }))
    .sort((a, b) => b.col - a.col)

  for (const c of chords) {
    let idx = Math.min(c.col, grid.length)
    // snap to the start of the word we landed in
    while (idx > 0 && idx < grid.length && grid[idx - 1] !== ' ' && grid[idx] !== ' ') idx--
    grid = grid.slice(0, idx) + `[${c.str}]` + grid.slice(idx)
  }

  return grid.replace(/ {2,}/g, ' ').trimEnd()
}

function chordLineToInstrumental(line: PositionedLine): string {
  return line.text
    .trim()
    .split(/\s+/)
    .map(tok => (isChordToken(tok) && !/^\(/.test(tok) ? `[${tok}]` : tok))
    .join(' ')
}

export function parseChordSheet(rawLines: PositionedLine[], filename: string): ParsedChordSheet {
  const warnings: string[] = []
  let ccli: string | null = null

  // ---- Clean + collect noise-free lines (keep positions) ----
  const lines: PositionedLine[] = []
  for (const l of rawLines) {
    const cleaned = stripDotLeaders(l.text)
    const m = cleaned.match(/CCLI Song #\s*(\d+)/i)
    if (m) ccli = m[1]
    if (isNoiseLine(cleaned)) continue
    lines.push({ ...l, text: cleaned })
  }

  // ---- Title: largest font on page 1 that isn't a chord line ----
  let title: string | null = null
  let titleIdx = -1
  const page1 = lines.filter(l => l.page === 1)
  if (page1.length) {
    const candidates = [...page1]
      .filter(l => !isChordLine(l.text) && l.text.trim().length >= 3)
      .sort((a, b) => b.fontSize - a.fontSize || a.y - b.y)
    if (candidates.length) {
      const tl = candidates[0]
      titleIdx = lines.indexOf(tl)
      title = tl.text.trim()
    }
  }

  let key: string | null = null
  let artist: string | null = null
  let bpm: number | null = null

  if (title) {
    key = extractKey(title)
    // "EWho is this King? - By Lamar Boschman // Scale of C"
    const glued = title.match(/^([A-G][#b]?)(?=[A-Z][a-z])/)
    if (glued) {
      title = title.slice(glued[1].length)
      warnings.push(`Removed stray "${glued[1]}" glued to the title`)
    }
    // leading standalone chord token ("E Who is this King")
    const firstWord = title.split(/\s+/)[0]
    if (firstWord && isChordToken(firstWord) && title.split(/\s+/).length > 2) {
      title = title.slice(firstWord.length).trim()
      warnings.push(`Dropped leading chord "${firstWord}" from the title`)
    }
    const byInline = title.match(/[-–]\s*by\s+(.+?)(?:\s*\/\/.*)?$/i)
    if (byInline) artist = byInline[1].trim()
    // strip metadata decorations from the title text
    title = title
      .replace(new RegExp(`\\(\\s*key\\s+of\\s+${KEY_RE}\\s*\\)`, 'i'), '')
      .replace(/[-–]\s*by\s+.+$/i, '')
      .replace(/\/\/.*$/, '')
      .replace(/\bchords\b/i, '')
      .trim()
      .replace(/[-–,\s]+$/, '')
    if (!key) {
      const trailing = extractTrailingParenKey(title)
      if (trailing) {
        key = trailing
        title = title.replace(new RegExp(`\\(${KEY_RE}\\)\\s*$`), '').trim()
      }
    }
  }
  if (!title || title.length < 2) {
    title = filename
      .replace(/\.pdf$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\bchords?\b/gi, '')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase())
    warnings.push('Title taken from the filename — check it')
  }

  // ---- Artist / key / bpm from the lines near the title ----
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (i === titleIdx) continue
    const t = lines[i].text.trim()
    if (!key) key = extractKey(t)
    const by = t.match(/^(?:words and music )?by\s+(.+)$/i)
    if (by && !artist) artist = by[1].trim()
    if (!artist && i === titleIdx + 1 && t && !isChordLine(t) && !detectSectionHeader(t) && t.split(/\s+/).length <= 8) {
      const bpmM = t.match(/\((\d{2,3})\)\s*$/)
      if (bpmM) {
        const n = parseInt(bpmM[1], 10)
        if (n >= 40 && n <= 220) bpm = n
      }
      const candidate = t.replace(/\(\d{2,3}\)\s*$/, '').trim()
      if (candidate && !/^(intro|verse|chorus)/i.test(candidate)) artist = candidate
    }
  }
  if (artist) {
    // "Justin Rizzo - Justin Rizzo" → "Justin Rizzo"
    const dup = artist.match(/^(.+?)\s*[-–]\s*(.+)$/)
    if (dup && dup[1].trim() === dup[2].trim()) artist = dup[1].trim()
    const bpmM = artist.match(/\((\d{2,3})\)\s*$/)
    if (bpmM) {
      const n = parseInt(bpmM[1], 10)
      if (n >= 40 && n <= 220) bpm = n
      artist = artist.replace(/\(\d{2,3}\)\s*$/, '').trim()
    }
  }

  // ---- Walk lines into body ----
  const out: string[] = []
  let sectionCount = 0
  let pendingChordLine: PositionedLine | null = null
  let lastWasBlank = true

  const push = (s: string) => {
    out.push(s)
    lastWasBlank = s.trim() === ''
  }
  const flushPendingInstrumental = () => {
    if (pendingChordLine) {
      push(chordLineToInstrumental(pendingChordLine))
      pendingChordLine = null
    }
  }
  const blankBefore = () => {
    if (!lastWasBlank && out.length) push('')
  }

  for (let i = 0; i < lines.length; i++) {
    if (i === titleIdx) continue
    const line = lines[i]
    const text = line.text.trim()
    if (!text) continue
    // skip pure-metadata lines already consumed
    if (i <= titleIdx + 1 && artist && text.replace(/\(\d{2,3}\)\s*$/, '').trim() === artist) continue
    if (/^(?:words and music )?by\s+/i.test(text)) continue

    const header = detectSectionHeader(text)
    if (header) {
      flushPendingInstrumental()
      blankBefore()
      push(`# ${header}`)
      sectionCount++
      continue
    }

    const flow = detectFlowMarker(text)
    if (flow) {
      flushPendingInstrumental()
      push(`> ${flow.label}${flow.times > 1 ? ` x${flow.times}` : ''}`)
      continue
    }

    if (isChordLine(text)) {
      flushPendingInstrumental()
      pendingChordLine = line
      continue
    }

    // lyric line
    if (pendingChordLine) {
      push(mergeChordAndLyric(pendingChordLine, line))
      pendingChordLine = null
    } else {
      push(text.replace(/ {2,}/g, ' '))
    }
  }
  flushPendingInstrumental()

  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')

  if (sectionCount === 0 && body) {
    warnings.push('No section headers detected — the whole song is one block')
  }
  const chordCharCount = (body.match(/\[[^\]]+\]/g) ?? []).length
  if (body && chordCharCount === 0) {
    warnings.push('No chords detected — check the source PDF')
  }

  return { title, artist, key, bpm, ccli, body, sectionCount, warnings }
}

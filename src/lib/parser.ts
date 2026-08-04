import ExcelJS from 'exceljs'
import { keyAtOffset, keyIndex } from './chords/format'

const INTRO_ORANGE = 'FFFF9900'
// Filename formats: "THURSDAY 28-05-2026 CHART.xlsx" or "THURSDAY_28-05-2026_CHART.xlsx"
const FILENAME_RE = /^(THURSDAY|SATURDAY)[_ ](\d{2}-\d{2}-\d{4})[_ ]CHART\.xlsx$/i

export interface ParsedInstruction {
  instrument: string
  text: string
  is_intro: boolean
}

export interface ParsedSection {
  order_index: number
  label: string
  comments: string
  key_change: string | null // mid-song modulation: sounding key FROM this section on
  instructions: ParsedInstruction[]
}

export interface ParsedSong {
  order_index: number
  title: string
  scale: string | null
  medley_group: string | null
  reference_links: string[]
  sections: ParsedSection[]
}

export interface ParseResult {
  day_of_week: 'THURSDAY' | 'SATURDAY'
  service_date: string // YYYY-MM-DD
  source_filename: string
  instruments: string[]
  songs: ParsedSong[]
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  // Rich text object: { richText: [{ text: string }] }
  if (typeof value === 'object' && 'richText' in (value as object)) {
    const rt = (value as { richText: { text: string }[] }).richText
    return rt.map(r => r.text).join('').trim()
  }
  // Hyperlink object: { text: string, hyperlink: string }
  if (typeof value === 'object' && 'text' in (value as object)) {
    return String((value as { text: string }).text).trim()
  }
  // Formula result
  if (typeof value === 'object' && 'result' in (value as object)) {
    return cellText((value as { result: ExcelJS.CellValue }).result)
  }
  return ''
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/g) ?? []
  return matches.filter(u => u.includes('youtube') || u.includes('youtu.be'))
}

// ============================================================
// Mid-song key change ("transpose mid song"). The conductor marks it on the
// section row where the modulation happens, in the STRUCTURE cell (preferred)
// or the COMMENTS cell:
//
//   LAST CHORUS (KEY A)      absolute — the word KEY + the new key
//   CHORUS - KEY OF Bb       KEY OF / KEY TO / NEW KEY / KEY CHANGE all work
//   BRIDGE (UP 2)            relative — must be wrapped in ( ) or [ ]
//   CHORUS (+1)              +n / -n, wrapped
//   KEY CHANGE A             a marker on its own row becomes a visible
//                            "KEY CHANGE" step in the flow
//
// The change applies from that section to the end of the song, unless a later
// marker changes it again (e.g. back to the original key). Relative markers
// resolve against the song's SCALE; if the scale is missing they're ignored.
// The marker is stripped from the label (so chord-sheet matching stays clean)
// but left verbatim in comments (humans read those).
// ============================================================

/** "A", "BB", "f#", "Abm" → canonical "A" / "Bb" / "F#" / "Abm", or null. */
function normalizeKeyToken(raw: string): string | null {
  const m = raw.trim().match(/^([A-Ga-g])([#♯]|[bB♭])?([mM])?$/)
  if (!m) return null
  const key = m[1].toUpperCase()
    + (m[2] ? (m[2] === '#' || m[2] === '♯' ? '#' : 'b') : '')
    + (m[3] ? 'm' : '')
  return keyIndex(key) !== null ? key : null
}

// Absolute: requires the word KEY, so prose like "(ALL)" or "TO A" never triggers.
const KC_ABS_RE =
  /(?:NEW\s+)?KEY(?:\s*CHANGE)?(?:\s+(?:OF|TO))?\s*[:\-–]?\s*([A-G][#♯bB♭]?[mM]?)(?![A-Za-z0-9#♯])/i
// Relative: only when wrapped — "(UP 2)", "[+1]" — or right after the word KEY.
const KC_REL_WRAPPED_RE = /[(\[]\s*(?:(UP|DOWN)\s+(\d{1,2})|([+-])\s*(\d{1,2}))\s*[)\]]/i
const KC_REL_AFTER_KEY_RE = /KEY(?:\s*CHANGE)?\s*[:\-–]?\s*(?:(UP|DOWN)\s+(\d{1,2})|([+-])\s*(\d{1,2}))(?!\d)/i
// Strip forms (label only): the marker plus any wrapping brackets / dangling dash.
const KC_STRIP_RE = new RegExp(
  '\\s*[-–]?\\s*[(\\[]?\\s*(?:' +
  '(?:NEW\\s+)?KEY(?:\\s*CHANGE)?(?:\\s+(?:OF|TO))?\\s*[:\\-–]?\\s*[A-G][#♯bB♭]?[mM]?' +
  '|(?:UP|DOWN)\\s+\\d{1,2}' +
  '|[+-]\\s*\\d{1,2}' +
  ')\\s*[)\\]]?\\s*',
  'i',
)

function keyChangeIn(text: string, songScale: string | null): string | null {
  if (!text) return null
  const abs = text.match(KC_ABS_RE)
  if (abs) {
    const key = normalizeKeyToken(abs[1])
    if (key) return key
  }
  const rel = text.match(KC_REL_WRAPPED_RE) ?? text.match(KC_REL_AFTER_KEY_RE)
  if (rel && songScale && keyIndex(songScale) !== null) {
    const dirWord = rel[1]?.toUpperCase()
    const n = parseInt(rel[2] ?? rel[4] ?? '', 10)
    const sign = dirWord ? (dirWord === 'UP' ? 1 : -1) : (rel[3] === '+' ? 1 : -1)
    if (Number.isFinite(n) && n >= 1 && n <= 11) return keyAtOffset(songScale, sign * n)
  }
  return null
}

/** Detect a key-change marker on a section row; clean the label if it carried it. */
export function extractKeyChange(label: string, comments: string, songScale: string | null): { label: string; key_change: string | null } {
  const fromLabel = keyChangeIn(label, songScale)
  if (fromLabel) {
    const cleaned = label.replace(KC_STRIP_RE, ' ').replace(/\s{2,}/g, ' ').trim()
    // A marker on its own row stays visible as an explicit flow step
    return { label: cleaned || 'KEY CHANGE', key_change: fromLabel }
  }
  return { label, key_change: keyChangeIn(comments, songScale) }
}

function parseTitleScale(raw: string): { title: string; scale: string | null } {
  // Expect: TITLE - SCALE "X"  or  TITLE - SCALE 'X'
  const m = raw.match(/^(.+?)\s*-\s*SCALE\s*["']([^"']+)["']\s*$/i)
  if (m) return { title: m[1].trim(), scale: m[2].trim() }
  return { title: raw, scale: null }
}

export function parseFilename(filename: string): { day_of_week: 'THURSDAY' | 'SATURDAY'; service_date: string } | null {
  const m = filename.match(FILENAME_RE)
  if (!m) return null
  const day = m[1].toUpperCase() as 'THURSDAY' | 'SATURDAY'
  // m[2] is DD-MM-YYYY
  const [dd, mm, yyyy] = m[2].split('-')
  const service_date = `${yyyy}-${mm}-${dd}`
  return { day_of_week: day, service_date }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseChart(buffer: any, filename: string): Promise<ParseResult> {
  const meta = parseFilename(filename)
  if (!meta) throw new Error(`Filename does not match expected pattern DAY DD-MM-YYYY CHART.xlsx — got: ${filename}`)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  const ws = wb.getWorksheet('Sheet1')
  if (!ws) throw new Error('Sheet1 not found in workbook')

  // --- Classify columns from header row ---
  const headerRow = ws.getRow(1)
  let structureCol = 1 // default: col 1 is always structure
  let commentsCol = -1
  let linkCol = -1
  const instrumentCols: { col: number; name: string }[] = []

  headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
    const h = cellText(cell.value).toUpperCase()
    if (colNum === 1) { structureCol = 1; return }
    if (h.includes('COMMENT')) { commentsCol = colNum; return }
    if (h.includes('LINK')) { linkCol = colNum; return }
    if (h) instrumentCols.push({ col: colNum, name: cellText(cell.value).toUpperCase() })
  })

  const instruments = instrumentCols.map(i => i.name)

  // --- Walk rows ---
  const songs: ParsedSong[] = []
  let currentSong: ParsedSong | null = null
  // A MEDLEY row's label lists its member songs separated by "/".
  // The medley covers exactly the next N SONG rows, so we count down
  // instead of matching titles (labels can carry typos, e.g. "MIGHT" vs "MIGHTY").
  let currentMedley: string | null = null
  let medleyRemaining = 0
  let songIndex = 0

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return

    const colA = cellText(row.getCell(structureCol).value).toUpperCase()
    if (!colA) return // spacer row

    if (colA === 'MEDLEY') {
      currentMedley = cellText(row.getCell(2).value)
      medleyRemaining = currentMedley.split('/').filter(p => p.trim()).length
      if (medleyRemaining === 0) currentMedley = null
      return
    }

    if (colA === 'SONG') {
      const rawTitle = cellText(row.getCell(2).value)
      const { title, scale } = parseTitleScale(rawTitle)

      // Collect any inline URLs on the song row
      const rowUrls: string[] = []
      row.eachCell({ includeEmpty: false }, cell => {
        rowUrls.push(...extractUrls(cellText(cell.value)))
        // Also check hyperlink
        if ((cell as ExcelJS.Cell).hyperlink) rowUrls.push((cell as ExcelJS.Cell).hyperlink as string)
      })
      if (linkCol > 0) {
        const lv = cellText(row.getCell(linkCol).value)
        rowUrls.push(...extractUrls(lv))
      }

      const inMedley = medleyRemaining > 0
      if (inMedley) medleyRemaining--

      currentSong = {
        order_index: songIndex++,
        title,
        scale,
        medley_group: inMedley ? currentMedley : null,
        reference_links: [...new Set(rowUrls.filter(u => u.startsWith('http')))],
        sections: [],
      }
      songs.push(currentSong)

      if (medleyRemaining === 0) currentMedley = null
      return
    }

    // Section row
    if (currentSong) {
      const rawLabel = cellText(row.getCell(structureCol).value) // preserve original case
      const comments = commentsCol > 0 ? cellText(row.getCell(commentsCol).value) : ''
      // Mid-song key change marker (label preferred, comments accepted)
      const { label, key_change } = extractKeyChange(rawLabel, comments, currentSong.scale)

      // Collect inline URLs into the current song
      const inlineUrls: string[] = []
      if (linkCol > 0) {
        const lv = cellText(row.getCell(linkCol).value)
        inlineUrls.push(...extractUrls(lv))
      }
      row.eachCell({ includeEmpty: false }, cell => {
        inlineUrls.push(...extractUrls(cellText(cell.value)))
        if ((cell as ExcelJS.Cell).hyperlink) inlineUrls.push((cell as ExcelJS.Cell).hyperlink as string)
      })
      if (inlineUrls.length) {
        const existing = new Set(currentSong.reference_links)
        inlineUrls.filter(u => u.startsWith('http')).forEach(u => existing.add(u))
        currentSong.reference_links = [...existing]
      }

      const instructions: ParsedInstruction[] = instrumentCols.map(({ col, name }) => {
        const cell = row.getCell(col)
        const text = cellText(cell.value)
        const fill = cell.fill as ExcelJS.Fill & { fgColor?: { argb?: string } }
        const is_intro = fill?.fgColor?.argb === INTRO_ORANGE
        return { instrument: name, text, is_intro }
      })

      currentSong.sections.push({
        order_index: currentSong.sections.length,
        label,
        comments,
        key_change,
        instructions,
      })
    }
  })

  return {
    ...meta,
    source_filename: filename,
    instruments,
    songs,
  }
}

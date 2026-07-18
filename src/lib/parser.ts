import ExcelJS from 'exceljs'

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
      const label = cellText(row.getCell(structureCol).value) // preserve original case
      const comments = commentsCol > 0 ? cellText(row.getCell(commentsCol).value) : ''

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

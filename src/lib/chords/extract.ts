/**
 * Coordinate-aware PDF text extraction (server-side only).
 *
 * PDFs do NOT store text in reading order — WHO IS THIS KING CHORDS.pdf
 * extracts its lyrics divorced from their chords and its title last.
 * We therefore read every text item's x/y position and font size,
 * rebuild lines by y-band per page, and order words by x within a line.
 */
import { getDocumentProxy } from 'unpdf'

export interface PositionedWord {
  str: string
  x: number
  width: number
  fontSize: number
}

export interface PositionedLine {
  page: number
  y: number // top-origin, ascending down the page
  fontSize: number // max font size on the line
  words: PositionedWord[]
  text: string // words joined with column-aware spacing
}

export interface ExtractResult {
  lines: PositionedLine[]
  pageCount: number
  hasTextLayer: boolean
}

interface RawItem {
  str: string
  x: number
  y: number // top-origin
  width: number
  fontSize: number
}

export async function extractPdfLines(buffer: Uint8Array): Promise<ExtractResult> {
  const pdf = await getDocumentProxy(buffer)
  const lines: PositionedLine[] = []
  let totalChars = 0

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()

    const items: RawItem[] = []
    for (const it of content.items as Array<{
      str: string
      transform: number[]
      width: number
      height: number
    }>) {
      if (!it.str || !it.str.trim()) continue
      // transform = [scaleX, skewY, skewX, scaleY, x, y(bottom-origin)]
      const fontSize = Math.hypot(it.transform[2], it.transform[3])
      items.push({
        str: it.str,
        x: it.transform[4],
        y: viewport.height - it.transform[5], // flip to top-origin
        width: it.width,
        fontSize: fontSize || Math.abs(it.height) || 10,
      })
      totalChars += it.str.trim().length
    }

    // Group into lines by y-band: items whose baselines sit within half a
    // font-size of each other are the same visual line.
    items.sort((a, b) => a.y - b.y || a.x - b.x)
    let band: RawItem[] = []
    let bandY = Number.NEGATIVE_INFINITY

    const flush = () => {
      if (band.length === 0) return
      band.sort((a, b) => a.x - b.x)
      // Merge contiguous glyph runs: PDFs emit "E/G#" as "E","/","G#" with
      // ~zero gap between items. Anything separated by less than ~1pt and
      // no explicit spaces is one word.
      const merged: RawItem[] = []
      for (const it of band) {
        const prev = merged[merged.length - 1]
        if (
          prev &&
          it.x - (prev.x + prev.width) <= Math.max(1, prev.fontSize * 0.08) &&
          !prev.str.endsWith(' ') &&
          !it.str.startsWith(' ')
        ) {
          prev.str += it.str
          prev.width = it.x + it.width - prev.x
          prev.fontSize = Math.max(prev.fontSize, it.fontSize)
        } else {
          merged.push({ ...it })
        }
      }
      band = merged
      const fontSize = Math.max(...band.map(i => i.fontSize))
      const words: PositionedWord[] = band.map(i => ({
        str: i.str,
        x: i.x,
        width: i.width,
        fontSize: i.fontSize,
      }))
      lines.push({
        page: p,
        y: bandY,
        fontSize,
        words,
        text: joinWithColumns(words, fontSize),
      })
      band = []
    }

    for (const it of items) {
      const tol = Math.max(it.fontSize, band.length ? band[0].fontSize : it.fontSize) * 0.6
      if (band.length === 0 || Math.abs(it.y - bandY) <= tol) {
        if (band.length === 0) bandY = it.y
        band.push(it)
      } else {
        flush()
        bandY = it.y
        band.push(it)
      }
    }
    flush()
  }

  return {
    lines,
    pageCount: pdf.numPages,
    hasTextLayer: totalChars >= 40, // a scan yields ~0; a real sheet yields hundreds
  }
}

/**
 * Join words preserving approximate column offsets so the chord parser can
 * align chords to lyric positions. ~0.5 em per space column.
 */
function joinWithColumns(words: PositionedWord[], fontSize: number): string {
  const em = Math.max(fontSize * 0.5, 3)
  let out = ''
  let cursorX = words.length ? words[0].x : 0
  for (const w of words) {
    const gap = Math.max(0, Math.round((w.x - cursorX) / em))
    if (out === '') {
      out = w.str
    } else {
      out += ' '.repeat(Math.max(1, gap)) + w.str
    }
    cursorX = w.x + w.width
  }
  return out
}

/** Character-column position of each word for chord→lyric alignment. */
export function wordColumns(line: PositionedLine): { str: string; col: number }[] {
  const em = Math.max(line.fontSize * 0.5, 3)
  const startX = line.words.length ? line.words[0].x : 0
  return line.words.map(w => ({
    str: w.str,
    col: Math.max(0, Math.round((w.x - startX) / em)),
  }))
}

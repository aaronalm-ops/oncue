/**
 * Chord parser regression tests against the real PDFs in "chord-samples/".
 * Run: npm run test:chords
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { bandItemsToLines, pdfTextItemsToRaw, type ExtractResult, type RawItem } from '../src/lib/chords/extract'
import { parseChordSheet } from '../src/lib/chords/parse'
import { deriveSections } from '../src/lib/chords/format'

/**
 * Node-side PDF reading for tests only. In the app, extraction runs in the
 * BROWSER (extract-client.ts) because serverless font handling drops text.
 */
async function extractPdfLines(buf: Uint8Array): Promise<ExtractResult> {
  const { getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(buf)
  const items: RawItem[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    items.push(...pdfTextItemsToRaw(
      content.items as Array<{ str: string; transform: number[]; width: number; height: number }>,
      viewport.height,
      p,
    ))
  }
  return bandItemsToLines(items, pdf.numPages)
}

const DIR = join(process.cwd(), 'chord-samples')

let failures = 0
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ok ${msg}`)
  else { failures++; console.error(`  FAIL: ${msg}`) }
}

interface Expect {
  title: RegExp
  key: string
  artist?: RegExp
  bpm?: number
  ccli?: string
  minSections: number
  mustContain: RegExp[]
  flow?: RegExp
}

const EXPECTATIONS: Record<string, Expect> = {
  'great-in-power.pdf': {
    title: /^Great In Power$/i,
    key: 'G',
    artist: /Zschech/i,
    minSections: 3,
    mustContain: [/# Intro/i, /# Verse/i, /# Chorus/i, /\[G\]/, /\[Em9?\]/],
  },
  'above-every-other-name.pdf': {
    title: /^Above Every Other Name$/i,
    key: 'G',
    artist: /Rizzo/i,
    minSections: 6,
    mustContain: [/# Pre-chorus/i, /# Tag/i, /# Ending/i, /\[G\]/],
  },
  'thank-you-jesus-for-the-blood.pdf': {
    title: /^Thank You Jesus For The Blood$/i,
    key: 'A',
    artist: /Charity Gayle/i,
    minSections: 8,
    mustContain: [/# Turnaround/i, /# Last Chorus/i, /# Outro/i, /\[E\/G#\]/, /\[Esus\]/],
    flow: /> Chorus/i,
  },
  'you_are_good.pdf': {
    title: /^You Are Good$/i,
    key: 'E',
    artist: /Israel Houghton/i,
    bpm: 120,
    minSections: 4,
    mustContain: [/# Interlude/i, /# Bridge/i, /\[B\/E\]/, /F3m7/], // typo must survive verbatim
    flow: /> Verse/i,
  },
  'WHO IS THIS KING CHORDS.pdf': {
    title: /Who is this King/i,
    key: 'C',
    artist: /Lamar Boschman/i,
    minSections: 0, // no explicit headers in this sheet — one block is acceptable
    mustContain: [/\[C\]/, /\[Am\]/, /worthy/i],
  },
}

// Files with no text layer (scanned images) — must be detected as scans so
// the UI can route them to paste-mode instead of producing garbage.
const SCAN_FILES = new Set(['Revelation_Song.pdf'])

async function main() {
  const files = readdirSync(DIR).filter(f => f.endsWith('.pdf') && !/-[0-9a-f]{8}\.pdf$/.test(f))
  check(files.length >= 6, `found ${files.length} fixture PDFs`)

  for (const file of files) {
    console.log(`\n=== ${file}`)
    const buf = new Uint8Array(readFileSync(join(DIR, file)))
    const extracted = await extractPdfLines(buf)
    if (SCAN_FILES.has(file)) {
      check(!extracted.hasTextLayer, 'correctly detected as a scan (no text layer) -> paste-mode')
      continue
    }
    check(extracted.hasTextLayer, `text layer present (${extracted.lines.length} lines, ${extracted.pageCount} page(s))`)

    const parsed = parseChordSheet(extracted.lines, file)
    console.log(`  title: ${JSON.stringify(parsed.title)}  key: ${parsed.key}  artist: ${JSON.stringify(parsed.artist)}  bpm: ${parsed.bpm}  ccli: ${parsed.ccli}`)
    if (parsed.warnings.length) console.log(`  warnings: ${parsed.warnings.join(' | ')}`)

    const exp = EXPECTATIONS[file]
    if (!exp) { console.log('  (no expectations registered)'); continue }

    check(exp.title.test(parsed.title ?? ''), `title matches ${exp.title}`)
    check(parsed.key === exp.key, `key ${parsed.key} === ${exp.key}`)
    if (exp.artist) check(exp.artist.test(parsed.artist ?? ''), `artist matches ${exp.artist}`)
    if (exp.bpm !== undefined) check(parsed.bpm === exp.bpm, `bpm ${parsed.bpm} === ${exp.bpm}`)
    if (exp.ccli !== undefined) check(parsed.ccli === exp.ccli, `ccli ${parsed.ccli} === ${exp.ccli}`)
    check(parsed.sectionCount >= exp.minSections, `sections ${parsed.sectionCount} >= ${exp.minSections}`)
    for (const re of exp.mustContain) check(re.test(parsed.body), `body contains ${re}`)
    if (exp.flow) check(exp.flow.test(parsed.body), `flow marker ${exp.flow}`)

    const derived = deriveSections(parsed.body)
    check(derived.length >= Math.max(1, exp.minSections), `derives ${derived.length} section rows`)
    check(derived.every((s, i) => s.order_index === i), 'derived sections sequentially indexed')
  }

  // ---- Render-safety invariant: rendering NEVER loses lyric text ----
  // For every content line of every fixture body, the render model's text
  // parts must reproduce the line exactly (minus the [chord] markers), and
  // instrumental classification is only allowed when there are no lyrics.
  console.log('\n=== render-safety invariant (no lyric loss)')
  const { parseBody } = await import('../src/lib/chords/format')
  function assertNoTextLoss(body: string, label: string) {
    const rawLines = body.split('\n')
    const model = parseBody(body)
    let checked = 0
    for (let i = 0; i < rawLines.length && i < model.length; i++) {
      const raw = rawLines[i].replace(/\s+$/, '')
      const m = model[i]
      if (m.type !== 'line') continue
      const expected = raw.replace(/\[[^\]\n]{1,24}\]/g, '')
      const rendered = m.parts.map(p => p.text).join('')
      if (rendered !== expected) {
        failures++
        console.error(`  FAIL [${label}] line ${i}: rendered ${JSON.stringify(rendered)} != ${JSON.stringify(expected)}`)
        return
      }
      if (m.instrumental && expected.trim() !== '') {
        failures++
        console.error(`  FAIL [${label}] line ${i}: lyric line misclassified as instrumental: ${JSON.stringify(raw)}`)
        return
      }
      checked++
    }
    console.log(`  ok ${label}: ${checked} lines render losslessly`)
  }
  // The exact regression that shipped broken: all-words-chorded lyric lines
  assertNoTextLoss('[G]Hallelujah [D]hallelujah [Em]hallelujah [C]hallelujah', 'bridge regression')
  assertNoTextLoss('[G]God Transcendent, there\'s [G]no one like You', 'tag regression')
  assertNoTextLoss('[G] [C] [D]', 'true instrumental (allowed)')
  for (const file of files) {
    if (SCAN_FILES.has(file)) continue
    const buf = new Uint8Array(readFileSync(join(DIR, file)))
    const ex = await extractPdfLines(buf)
    const parsed = parseChordSheet(ex.lines, file)
    assertNoTextLoss(parsed.body, file)
  }

  // ---- Transpose unit checks (deterministic music theory) ----
  console.log('\n=== transpose')
  const { transposeChord, transposeBody, reorderBodyToChart } = await import('../src/lib/chords/format')
  check(transposeChord('G', 2, 'A') === 'A', 'G +2 → A')
  check(transposeChord('F#m7/E', 2, 'A') === 'G#m7/F#', 'F#m7/E +2 (sharp key) → G#m7/F#')
  check(transposeChord('D', 1, 'Eb') === 'Eb', 'D +1 (flat key) → Eb')
  check(transposeChord('Esus', 5, 'A') === 'Asus', 'Esus +5 → Asus')
  check(transposeBody('[A]Thank [E/G#]You', 'A', 'Bb') === '[Bb]Thank [F/A]You', 'body A→Bb spells flats')
  check(transposeBody('[G]x [??]y', 'G', 'A') === '[A]x [??]y', 'unknown tokens pass through untouched')
  check(transposeBody('[G]x', 'G', 'G') === '[G]x', 'same key = unchanged')

  // ---- Chart-flow reorder checks ----
  console.log('\n=== reorder to chart flow')
  const body = '# Verse\nV-line\n\n# Chorus\nC-line\n\n# Bridge\nB-line'
  const r = reorderBodyToChart(body, ['INTRO', 'VERSE', 'CHORUS 2 (HE HAS DONE GREAT THINGS)', 'VERSE', 'OUTRO'])
  check(r.matched === 3, `matched 3 chart sections (got ${r.matched})`)
  check(r.unmatched.join(',') === 'INTRO,OUTRO', `unmatched: ${r.unmatched.join(',')}`)
  const order = r.body.split('\n').filter(l => l.startsWith('# '))
  check(order[0] === '# VERSE' && order[1] === '# CHORUS 2 (HE HAS DONE GREAT THINGS)' && order[2] === '# VERSE',
    'sections follow the chart order with the chart\'s own labels')
  check(r.body.includes('# Bridge'), 'unused sections appended so nothing is lost')
  const r2 = reorderBodyToChart(body, ['SOMETHING', 'ELSE'])
  check(r2.matched === 0 && r2.body === body, 'no matches → original body untouched')

  // ---- Manual section-map overrides ----
  console.log('\n=== section-map overrides')
  const { mapChartSectionsToChords, normalizeSectionLabelFull } = await import('../src/lib/chords/format')
  const m1 = mapChartSectionsToChords(body, ['INSTRUMENTAL SOLO'])
  check(m1.sections[0].content === null, 'unmapped chart label has no content')
  const m2 = mapChartSectionsToChords(body, ['INSTRUMENTAL SOLO'], {
    [normalizeSectionLabelFull('INSTRUMENTAL SOLO')]: 'Bridge',
  })
  check(m2.sections[0].content === 'B-line', 'override maps chart label to the chosen sheet section')
  check(m2.sections[0].label === 'INSTRUMENTAL SOLO', 'chart wording stays as the header')

  console.log(failures === 0 ? '\nAll chord checks passed.' : `\n${failures} chord check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => { console.error('Crashed:', err); process.exit(1) })

/**
 * Chord parser regression tests against the real PDFs in "chord-samples/".
 * Run: npm run test:chords
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { extractPdfLines } from '../src/lib/chords/extract'
import { parseChordSheet } from '../src/lib/chords/parse'
import { deriveSections } from '../src/lib/chords/format'

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

  console.log(failures === 0 ? '\nAll chord checks passed.' : `\n${failures} chord check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => { console.error('Crashed:', err); process.exit(1) })

/**
 * Parser regression tests against the real chart files in "Charts Log/".
 * Run: npm run test:parser
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseChart, parseFilename } from '../src/lib/parser'

const CHARTS_DIR = join(process.cwd(), 'Charts Log')

let failures = 0
function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    failures++
    console.error(`  ✗ FAIL: ${msg}`)
  }
}

async function main() {
  const files = readdirSync(CHARTS_DIR).filter(f => f.endsWith('.xlsx'))
  check(files.length > 0, `found ${files.length} sample charts`)

  for (const file of files) {
    console.log(`\n${file}`)
    const meta = parseFilename(file)
    check(meta !== null, 'filename parses')
    if (!meta) continue

    const parsed = await parseChart(readFileSync(join(CHARTS_DIR, file)), file)

    check(parsed.songs.length > 0, `${parsed.songs.length} songs`)
    check(parsed.instruments.length > 0, `instruments: ${parsed.instruments.join(', ')}`)
    check(parsed.songs.every(s => s.sections.length > 0), 'every song has sections')
    check(parsed.songs.every(s => s.scale !== null), 'every song has a scale')
    check(
      parsed.songs.every(s => s.sections.every(sec => sec.instructions.length === parsed.instruments.length)),
      'every section has one instruction per instrument'
    )
    // The ingest_chart SQL function requires order_index on every song AND section
    check(
      parsed.songs.every(s =>
        Number.isInteger(s.order_index) &&
        s.sections.every((sec, i) => sec.order_index === i)
      ),
      'songs and sections carry sequential order_index (ingest contract)'
    )

    const introCount = parsed.songs.flatMap(s => s.sections).flatMap(sec => sec.instructions).filter(i => i.is_intro).length
    check(introCount > 0, `${introCount} intro flags (orange cells) detected`)

    // Medley behavior
    const medleySongs = parsed.songs.filter(s => s.medley_group !== null)
    if (file === 'THURSDAY 02-04-2026 CHART.xlsx') {
      // The MEDLEY row lists 5 songs — exactly the first 5 SONG rows belong to it
      check(medleySongs.length === 5, `medley covers exactly 5 songs (got ${medleySongs.length})`)
      check(
        parsed.songs.slice(0, 5).every(s => s.medley_group !== null) &&
        parsed.songs.slice(5).every(s => s.medley_group === null),
        'medley songs are the first 5; the rest are standalone'
      )
    } else if (medleySongs.length > 0) {
      console.log(`  note: ${medleySongs.length} medley songs`)
    }
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('Test run crashed:', err)
  process.exit(1)
})

'use client'

import { useMemo } from 'react'
import { parseBody, isChordToken, type BodyLine } from '@/lib/chords/format'

interface Props {
  body: string
  highContrast?: boolean
  compact?: boolean
}

/**
 * Renders the internal chord text format: section headers, flow markers,
 * lyric lines with chord badges above the syllable they attach to.
 * Shared by the review editor preview and (Phase 2+) the service views.
 */
export default function ChordSheet({ body, highContrast = false, compact = false }: Props) {
  const lines = useMemo(() => parseBody(body), [body])
  const hc = highContrast

  if (!body.trim()) {
    return <p className={`text-sm ${hc ? 'text-zinc-500' : 'text-zinc-600'}`}>Nothing here yet.</p>
  }

  return (
    <div className={`${compact ? 'space-y-0.5' : 'space-y-1'} font-mono text-[13px] leading-relaxed`}>
      {lines.map((line, i) => <Line key={i} line={line} hc={hc} />)}
    </div>
  )
}

function Line({ line, hc }: { line: BodyLine; hc: boolean }) {
  if (line.type === 'blank') return <div className="h-3" />

  if (line.type === 'section') {
    return (
      <p className={`pt-3 pb-0.5 font-sans text-xs font-bold uppercase tracking-widest ${hc ? 'text-zinc-700' : 'text-purple-400'}`}>
        {line.label}
      </p>
    )
  }

  if (line.type === 'flow') {
    return (
      <p className={`font-sans text-xs italic ${hc ? 'text-zinc-500' : 'text-zinc-500'}`}>
        → {line.label}{line.times > 1 ? ` ×${line.times}` : ''}
      </p>
    )
  }

  // Instrumental: chords in a row
  if (line.instrumental) {
    return (
      <p className="flex flex-wrap gap-x-2 gap-y-1">
        {line.parts.filter(p => p.chord).map((p, i) => (
          <ChordBadge key={i} chord={p.chord!} hc={hc} size="base" />
        ))}
      </p>
    )
  }

  // Lyric line with chords above: each part is a chord anchored to the text run after it
  return (
    <p className="flex flex-wrap items-end" dir="auto">
      {line.parts.map((p, i) => (
        <span key={i} className="inline-flex flex-col items-start whitespace-pre-wrap">
          {p.chord !== null && <ChordBadge chord={p.chord} hc={hc} size="sm" />}
          <span className={hc ? 'text-zinc-900' : 'text-zinc-100'}>{p.text || ' '}</span>
        </span>
      ))}
    </p>
  )
}

/** Unrecognised chord tokens get a dotted underline — visibly "not understood",
 *  never silently transposed wrong. */
function ChordBadge({ chord, hc, size }: { chord: string; hc: boolean; size: 'sm' | 'base' }) {
  const known = isChordToken(chord)
  return (
    <span
      className={`font-bold ${size === 'sm' ? 'text-[11px] leading-none mb-0.5' : ''} ${
        hc ? 'text-black' : 'text-amber-300'
      } ${known ? '' : 'underline decoration-dotted decoration-red-400 underline-offset-2'}`}
      title={known ? undefined : 'Unrecognised chord — not transposed'}
    >
      {chord}
    </span>
  )
}

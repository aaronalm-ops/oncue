'use client'

/** One-time "keep the beat pulse?" bar — shared by My Part and Live so the
 *  wording and behaviour never drift between views. */
export default function PulsePrompt({ hc, onAnswer, className = '' }: {
  hc: boolean
  onAnswer: (keep: boolean) => void
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 border ${
      hc ? 'bg-amber-50 border-amber-300' : 'bg-amber-950/40 border-amber-800/50'
    } ${className}`}>
      <p className={`flex-1 text-[11px] leading-snug ${hc ? 'text-amber-900' : 'text-amber-200'}`}>
        Cards now pulse to the song&rsquo;s tempo. Keep it?
      </p>
      <button onClick={() => onAnswer(true)}
        className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white">
        Keep
      </button>
      <button onClick={() => onAnswer(false)}
        className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
          hc ? 'bg-zinc-200 text-zinc-700' : 'bg-zinc-800 text-zinc-400'
        }`}>
        Turn off
      </button>
    </div>
  )
}

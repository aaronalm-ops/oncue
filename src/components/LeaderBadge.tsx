'use client'

import { useState } from 'react'
import Avatar from '@/components/Avatar'
import { TEAM_LABELS, type AppTeam } from '@/lib/types'

/** The worship leader shown by their initials avatar; tap to see more. */
export default function LeaderBadge({
  name,
  instrument,
  teams,
}: {
  name: string | null
  instrument: string | null
  teams: AppTeam[]
}) {
  const [open, setOpen] = useState(false)
  const display = name ?? 'Worship leader'
  const instr = instrument ? instrument.charAt(0) + instrument.slice(1).toLowerCase() : null

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 active:scale-95 transition-transform"
        aria-label={`Worship leader ${display}`}
      >
        <Avatar name={name} size={30} />
        <span className="text-sm text-zinc-300">
          <span className="text-zinc-500">Led by </span>{display}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-11 z-40 w-60 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <Avatar name={name} size={44} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{display}</p>
                <p className="text-[11px] text-zinc-500">Worship leader</p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-zinc-400">
              {instr && <p>Instrument: <span className="text-zinc-200">{instr}</span></p>}
              {teams.length > 0 && (
                <p>Teams: <span className="text-zinc-200">{teams.map(t => TEAM_LABELS[t]).join(', ')}</span></p>
              )}
              {!instr && teams.length === 0 && <p className="text-zinc-600">No extra details yet.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

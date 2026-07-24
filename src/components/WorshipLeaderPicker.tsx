'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Option { id: string; name: string; isLeader: boolean }

interface Props {
  serviceId: string
  currentId: string | null
  options: Option[]
  canEdit: boolean
  hasLeader: boolean // whether a LeaderBadge is already shown above
}

/**
 * Inline worship-leader assignment on the service page (editors only).
 * Uses the set_worship_leader RPC (v13) so worship_leader-role users can
 * assign too, despite services UPDATE being privileged-only in RLS.
 */
export default function WorshipLeaderPicker({ serviceId, currentId, options, canEdit, hasLeader }: Props) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  if (!canEdit) return null

  async function choose(id: string) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('set_worship_leader', {
      p_service_id: serviceId,
      p_worship_leader: id || null,
    })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="mt-2 text-[11px] text-zinc-500 underline underline-offset-2 active:text-zinc-300 transition-colors"
      >
        {hasLeader ? 'Change worship leader' : 'Set worship leader'}
      </button>
    )
  }

  return (
    <div className="mt-2">
      <select
        autoFocus
        defaultValue={currentId ?? ''}
        disabled={busy}
        onChange={e => choose(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-600 disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.name}{o.isLeader ? ' ★' : ''}</option>
        ))}
      </select>
      <div className="mt-1 flex items-center gap-3">
        <button onClick={() => { setEditing(false); setError(null) }} className="text-[11px] text-zinc-600">
          Cancel
        </button>
        {busy && <span className="text-[11px] text-zinc-500">Saving…</span>}
        {error && <span className="text-[11px] text-red-400">{error}</span>}
      </div>
    </div>
  )
}

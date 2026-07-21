'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ALL_KEYS, instrumentTransposeMode } from '@/lib/chords/format'
import { TEAMS, TEAM_LABELS, type AppTeam } from '@/lib/types'

interface Props {
  userId: string
  instrument: string | null
  initialName: string | null
  initialTeams: AppTeam[]
}

/**
 * One-time "finish your profile" prompt for members who signed up before
 * preferred-scale + teams existed. Dismissible ("Later") for the session; it
 * reappears next login until they save once (which stamps profile_completed_at,
 * so choosing "Actual" / no key still counts as done and it never nags again).
 */
export default function ProfileCompletionModal({ userId, instrument, initialName, initialTeams }: Props) {
  // Start false so server + client first render match (no hydration mismatch);
  // a same-session "Later" is applied in the effect below.
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (sessionStorage.getItem('oncue-profile-later') === '1') setDismissed(true)
  }, [])
  const [name, setName] = useState(initialName ?? '')
  const [preferredKey, setPreferredKey] = useState('') // '' = actual
  const [teams, setTeams] = useState<AppTeam[]>(initialTeams.length ? initialTeams : ['worship'])
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  if (dismissed) return null

  const mode = instrumentTransposeMode(instrument)
  const keyHint =
    mode === 'keyboard' ? 'The key you like to play — we’ll show the keyboard transpose per song.'
      : mode === 'capo' ? 'The shape key you like — we’ll show the capo per song.'
        : 'Leave as “Actual” unless you read chords in a fixed key.'

  function later() {
    sessionStorage.setItem('oncue-profile-later', '1')
    setDismissed(true)
  }

  async function save() {
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from('profiles').update({
      display_name: name.trim() || null,
      preferred_key: preferredKey || null,
      teams,
      profile_completed_at: new Date().toISOString(),
    }).eq('id', userId)
    setSaving(false)
    if (error) return
    setDismissed(true)
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-white">Finish your profile</h2>
          <p className="mt-1 text-zinc-500 text-sm">Two quick things so charts show the way you play.</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Your name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Aaron"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-base placeholder:text-zinc-700 focus:outline-none focus:border-purple-600"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Preferred key</label>
          <p className="text-[11px] text-zinc-600 leading-snug">{keyHint}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setPreferredKey('')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${preferredKey === '' ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'}`}
            >
              Actual
            </button>
            {ALL_KEYS.map(k => (
              <button
                key={k}
                onClick={() => setPreferredKey(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${preferredKey === k ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Teams</label>
          <div className="flex flex-wrap gap-2">
            {TEAMS.map(t => (
              <button
                key={t}
                onClick={() => setTeams(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                className={`rounded-xl px-4 py-2 text-sm font-medium ${teams.includes(t) ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'}`}
              >
                {TEAM_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={later} className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium">
            Later
          </button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-xl bg-white text-black text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

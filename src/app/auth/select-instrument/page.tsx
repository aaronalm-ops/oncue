'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ALL_KEYS, instrumentTransposeMode } from '@/lib/chords/format'
import { TEAMS, TEAM_LABELS, type AppTeam } from '@/lib/types'

export const dynamic = 'force-dynamic'

const INSTRUMENTS = [
  'DRUMS', 'KEYBOARD', 'LEAD GUITAR', 'RHYTHM GUITAR',
  'BASS GUITAR', 'VIOLIN', 'CELLO', 'VOCALS', 'ACOUSTIC GUITAR', 'OTHER',
]

export default function SelectInstrumentPage() {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState('')
  const [currentInstrument, setCurrentInstrument] = useState<string | null>(null)
  const [preferredKey, setPreferredKey] = useState('') // '' = none / actual
  const [teams, setTeams] = useState<AppTeam[]>(['worship'])
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('instrument, display_name, preferred_key, teams').eq('id', user.id).single()
        .then(({ data }) => {
          if (data?.instrument) setCurrentInstrument(data.instrument)
          if (data?.display_name) setName(data.display_name)
          const d = data as { preferred_key?: string | null; teams?: string[] } | null
          if (d?.preferred_key) setPreferredKey(d.preferred_key)
          if (d?.teams && d.teams.length) setTeams(d.teams as AppTeam[])
        })
    })
  }, [])

  const isFirstTime = !currentInstrument
  const activeInstrument = selected || currentInstrument || ''
  const mode = instrumentTransposeMode(activeInstrument)
  const keyHint =
    mode === 'keyboard' ? 'The key you like to play — we’ll show the keyboard transpose number for each song.'
      : mode === 'capo' ? 'The shape key you like — we’ll show the capo position for each song.'
        : 'Leave as “Actual” unless you read chords in a fixed key.'

  function toggleTeam(t: AppTeam) {
    setTeams(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function handleSave() {
    if (!selected && isFirstTime) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        display_name: name.trim() || null,
        instrument: selected || currentInstrument,
        preferred_key: preferredKey || null,
        teams,
        profile_completed_at: new Date().toISOString(),
      })
      if (error) { setSaving(false); return }
    }
    router.push('/services')
  }

  async function handleSignOut() {
    setSigningOut(true)
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  const canSave = isFirstTime ? !!selected : true

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 py-10">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {isFirstTime ? 'Set up your profile' : 'My Profile'}
            </h1>
            <p className="mt-1 text-zinc-500 text-sm">
              {isFirstTime ? 'Your name, instrument, key and teams.' : 'Update your details any time.'}
            </p>
          </div>
          {!isFirstTime && (
            <button onClick={() => router.push('/services')} className="text-zinc-500 text-sm active:text-zinc-300">
              Cancel
            </button>
          )}
        </div>

        {/* Display name */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Your name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Aaron"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-base placeholder:text-zinc-700 focus:outline-none focus:border-purple-600 transition-colors"
          />
        </div>

        {/* Instrument picker */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Instrument</label>
          {INSTRUMENTS.map(instr => (
            <button
              key={instr}
              onClick={() => setSelected(instr)}
              className={`w-full rounded-xl px-4 py-3 text-left font-medium transition-colors ${
                activeInstrument === instr
                  ? 'bg-purple-600 text-white'
                  : 'bg-zinc-900 text-white border border-zinc-800 active:bg-zinc-800'
              }`}
            >
              {instr.charAt(0) + instr.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Preferred key */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Preferred key</label>
          <p className="text-[11px] text-zinc-600 leading-snug">{keyHint}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setPreferredKey('')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                preferredKey === '' ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
              }`}
            >
              Actual
            </button>
            {ALL_KEYS.map(k => (
              <button
                key={k}
                onClick={() => setPreferredKey(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  preferredKey === k ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {/* Teams */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-500 uppercase tracking-widest">Teams</label>
          <p className="text-[11px] text-zinc-600 leading-snug">Pick every team you’re part of.</p>
          <div className="flex flex-wrap gap-2">
            {TEAMS.map(t => (
              <button
                key={t}
                onClick={() => toggleTeam(t)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  teams.includes(t) ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                {TEAM_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="w-full bg-white text-black font-semibold rounded-xl px-4 py-3 text-base disabled:opacity-40 active:scale-95 transition-transform"
        >
          {saving ? 'Saving…' : isFirstTime ? 'Continue' : 'Save'}
        </button>

        <button
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full text-red-500 text-sm py-2 disabled:opacity-50"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>

      </div>
    </div>
  )
}

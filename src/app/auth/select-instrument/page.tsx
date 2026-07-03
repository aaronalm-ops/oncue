'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const INSTRUMENTS = [
  'DRUMS', 'KEYBOARD', 'LEAD GUITAR', 'RHYTHM GUITAR',
  'BASS GUITAR', 'VIOLIN', 'CELLO', 'VOCALS', 'ACOUSTIC GUITAR', 'OTHER',
]

export default function SelectInstrumentPage() {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState('')
  const [currentInstrument, setCurrentInstrument] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('instrument, display_name').eq('id', user.id).single()
        .then(({ data }) => {
          if (data?.instrument) setCurrentInstrument(data.instrument)
          if (data?.display_name) setName(data.display_name)
        })
    })
  }, [])

  const isFirstTime = !currentInstrument

  async function handleSave() {
    if (!selected && isFirstTime) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').upsert({
        id: user.id,
        display_name: name.trim() || null,
        instrument: selected || currentInstrument,
      })
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
      <div className="w-full max-w-sm space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {isFirstTime ? 'Set up your profile' : 'My Profile'}
            </h1>
            {isFirstTime ? (
              <p className="mt-1 text-zinc-500 text-sm">Tell us your name and instrument.</p>
            ) : (
              <p className="mt-1 text-zinc-500 text-sm">
                Instrument: <span className="text-purple-400 font-medium">
                  {(selected || currentInstrument ?? '').charAt(0) + (selected || currentInstrument ?? '').slice(1).toLowerCase()}
                </span>
              </p>
            )}
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
                (selected || currentInstrument) === instr
                  ? 'bg-purple-600 text-white'
                  : 'bg-zinc-900 text-white border border-zinc-800 active:bg-zinc-800'
              }`}
            >
              {instr.charAt(0) + instr.slice(1).toLowerCase()}
            </button>
          ))}
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

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
  const [selected, setSelected] = useState('')
  const [current, setCurrent] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      createClient().from('profiles').select('instrument').eq('id', user.id).single()
        .then(({ data }) => { if (data?.instrument) setCurrent(data.instrument) })
    })
  }, [])

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').upsert({ id: user.id, instrument: selected })
    }
    router.push('/services')
  }

  async function handleSignOut() {
    setSigningOut(true)
    await createClient().auth.signOut()
    router.push('/auth/login')
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {current ? 'Change instrument' : 'Your instrument'}
            </h1>
            {current ? (
              <p className="mt-1 text-zinc-500 text-sm">
                Currently: <span className="text-purple-400 font-medium">{current.charAt(0) + current.slice(1).toLowerCase()}</span>
              </p>
            ) : (
              <p className="mt-1 text-zinc-500 text-sm">Sets your default view in every service.</p>
            )}
          </div>
          {current && (
            <button onClick={() => router.push('/services')}
              className="text-zinc-500 text-sm active:text-zinc-300">
              Cancel
            </button>
          )}
        </div>

        <div className="space-y-2">
          {INSTRUMENTS.map(instr => (
            <button
              key={instr}
              onClick={() => setSelected(instr)}
              className={`w-full rounded-xl px-4 py-3 text-left font-medium transition-colors ${
                selected === instr
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
          disabled={!selected || saving}
          className="w-full bg-white text-black font-semibold rounded-xl px-4 py-3 text-base disabled:opacity-40 active:scale-95 transition-transform"
        >
          {saving ? 'Saving…' : current ? 'Save change' : 'Continue'}
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

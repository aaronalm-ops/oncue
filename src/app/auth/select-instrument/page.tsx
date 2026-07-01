'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const INSTRUMENTS = [
  'DRUMS', 'KEYBOARD', 'LEAD GUITAR', 'RHYTHM GUITAR',
  'BASS GUITAR', 'VIOLIN', 'CELLO',
]

export default function SelectInstrumentPage() {
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').upsert({ id: user.id, instrument: selected })
    }
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Your instrument</h1>
          <p className="mt-1 text-zinc-400 text-sm">This sets your default view. You can always look at others.</p>
        </div>

        <div className="space-y-2">
          {INSTRUMENTS.map(instr => (
            <button
              key={instr}
              onClick={() => setSelected(instr)}
              className={`w-full rounded-xl px-4 py-3 text-left font-medium transition-colors ${
                selected === instr
                  ? 'bg-white text-black'
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
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

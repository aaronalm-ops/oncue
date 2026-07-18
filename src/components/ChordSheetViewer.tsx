'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ChordSheet from '@/components/ChordSheet'
import { ALL_KEYS, keyIndex, transposeBody } from '@/lib/chords/format'

interface Props {
  body: string
  storedKey: string | null // the key the sheet is written in
  initialKey?: string | null // preferred/target key to open in
  librarySongId: string
  userId: string | null // null = don't persist preference
  highContrast?: boolean
}

/**
 * ChordSheet + transpose strip. Changing key transposes deterministically
 * and (like the instrument selector) saves the user's preferred scale for
 * this song — next time it opens in their key.
 */
export default function ChordSheetViewer({ body, storedKey, initialKey, librarySongId, userId, highContrast = false }: Props) {
  const canTranspose = storedKey !== null && keyIndex(storedKey) !== null
  const [targetKey, setTargetKey] = useState<string>(
    (initialKey && keyIndex(initialKey) !== null ? initialKey : null) ?? storedKey ?? ''
  )
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function selectKey(k: string) {
    setTargetKey(k)
    if (!userId) return
    // Debounced upsert — same pattern as the instrument preference
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (!supabaseRef.current) supabaseRef.current = createClient()
      supabaseRef.current
        .from('user_scale_preferences')
        .upsert(
          { user_id: userId, library_song_id: librarySongId, preferred_key: k },
          { onConflict: 'user_id,library_song_id' },
        )
        .then(() => {})
    }, 500)
  }

  const shown = useMemo(() => {
    if (!canTranspose || !targetKey || targetKey === storedKey) return body
    return transposeBody(body, storedKey!, targetKey)
  }, [body, storedKey, targetKey, canTranspose])

  const hc = highContrast

  return (
    <div>
      {canTranspose ? (
        <div className="mb-3 -mx-1 px-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
          <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-widest mr-1 ${hc ? 'text-zinc-600' : 'text-zinc-500'}`}>
            Key
          </span>
          {ALL_KEYS.map(k => (
            <button
              key={k}
              onClick={() => selectKey(k)}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold transition-all active:scale-95 ${
                k === targetKey
                  ? 'bg-purple-600 text-white'
                  : (hc ? 'bg-zinc-200 text-zinc-600' : 'bg-zinc-800 text-zinc-400')
              }`}
            >
              {k}
            </button>
          ))}
          {targetKey !== storedKey && (
            <button
              onClick={() => selectKey(storedKey!)}
              className={`shrink-0 ml-1 text-[10px] underline ${hc ? 'text-zinc-600' : 'text-zinc-500'}`}
            >
              reset to {storedKey}
            </button>
          )}
        </div>
      ) : (
        storedKey === null && (
          <p className={`mb-3 text-[11px] ${hc ? 'text-zinc-600' : 'text-zinc-600'}`}>
            No key set for this sheet — transpose unavailable. An editor can set it in the review screen.
          </p>
        )
      )}
      <ChordSheet body={shown} highContrast={hc} />
    </div>
  )
}

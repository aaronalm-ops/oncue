'use client'

import { useEffect, useState } from 'react'

/**
 * Beat-pulse preference — ON by default, per-device, SHARED by My Part and
 * Live (same localStorage key, so one choice covers the whole app).
 *
 * First-ever visit: pulse is on and a one-time "keep it?" prompt shows.
 * Any explicit choice — the prompt buttons or a pulse chip — persists and
 * the prompt never returns on that device.
 */
export function usePulsePref() {
  const [pulseOn, setPulseOn] = useState(true)
  const [pulsePrompt, setPulsePrompt] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('oncue-pulse')
    if (stored !== null) setPulseOn(stored === '1') // they already chose
    else setPulsePrompt(true) // default ON + one-time ask
  }, [])

  function togglePulse() {
    setPulsePrompt(false)
    setPulseOn(p => {
      localStorage.setItem('oncue-pulse', p ? '0' : '1')
      return !p
    })
  }

  function answerPulsePrompt(keep: boolean) {
    localStorage.setItem('oncue-pulse', keep ? '1' : '0')
    setPulseOn(keep)
    setPulsePrompt(false)
  }

  return { pulseOn, pulsePrompt, togglePulse, answerPulsePrompt }
}

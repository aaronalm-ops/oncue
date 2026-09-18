import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { nvidiaTranscribe } from '@/lib/riva/asr'

/**
 * Sung words → text. The browser's built-in speech recogniser is built for
 * dictation and falls apart on singing ("Jesus, name above all names" came
 * back as "beautiful beautiful say if you"). Whisper was trained on a lot of
 * music and copes with sustained vowels, melody and a band behind the voice.
 *
 * Provider is whichever key exists in Vercel env, in this order:
 *   NVIDIA_API_KEY  → whisper-large-v3 on build.nvidia.com (gRPC, free tier)
 *   GROQ_API_KEY    → whisper-large-v3-turbo (HTTPS)
 *   OPENAI_API_KEY  → whisper-1 (HTTPS)
 * With none, this answers 501 and the client falls back to the browser
 * recogniser, so the feature never dies because a key is missing.
 *
 * Input: one mono 16-bit PCM WAV clip (the client records exactly that —
 * every provider accepts it, no codec games). Forwarded and discarded.
 */

export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES = 4 * 1024 * 1024 // 16 kHz mono 16-bit = 32 KB/s → ~2 min; clips are 5 s

// Nudges Whisper (HTTP providers) toward the vocabulary it will actually hear.
const PROMPT = 'Christian worship song lyrics. Jesus, Lord, God, holy, hallelujah, glory, praise, worship, grace, mercy, saviour, King, name above all names, blessed, forever, heaven, cross, risen.'

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const nvidia = process.env.NVIDIA_API_KEY
  const groq = process.env.GROQ_API_KEY
  const openai = process.env.OPENAI_API_KEY
  if (!nvidia && !groq && !openai) return NextResponse.json({ error: 'No transcription provider configured' }, { status: 501 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('audio')
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: 'No audio' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Clip too large' }, { status: 413 })
  const sampleRate = Number(form?.get('sampleRate') ?? 16000) || 16000

  try {
    if (nvidia) {
      const wav = Buffer.from(await file.arrayBuffer())
      const { text } = await nvidiaTranscribe(wav, { apiKey: nvidia, sampleRate })
      return NextResponse.json({ text, provider: 'nvidia' })
    }

    const upstream = new FormData()
    upstream.append('file', file, 'clip.wav')
    upstream.append('model', groq ? 'whisper-large-v3-turbo' : 'whisper-1')
    upstream.append('language', 'en')
    upstream.append('response_format', 'json')
    upstream.append('temperature', '0')
    upstream.append('prompt', PROMPT)
    const res = await fetch(
      groq ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions',
      { method: 'POST', headers: { Authorization: `Bearer ${groq ?? openai}` }, body: upstream },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[transcribe]', res.status, detail.slice(0, 300))
      return NextResponse.json({ error: `Transcription failed (${res.status})` }, { status: 502 })
    }
    const json = (await res.json()) as { text?: string }
    return NextResponse.json({ text: (json.text ?? '').trim(), provider: groq ? 'groq' : 'openai' })
  } catch (e) {
    const msg = (e as { details?: string; message?: string }).details ?? (e as Error).message ?? 'unknown'
    console.error('[transcribe]', msg)
    return NextResponse.json({ error: `Transcription failed: ${msg}` }, { status: 502 })
  }
}

/**
 * Float32 mic samples → mono 16-bit PCM WAV at a lower rate. Every speech
 * provider accepts this, and it sidesteps MediaRecorder's per-browser
 * container/codec differences (webm here, mp4 there, nothing on some).
 */
export const WAV_RATE = 16000

/** Average-decimate from `inRate` to `outRate`. Good enough for speech. */
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  const ratio = inRate / outRate
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  let o = 0, i = 0
  while (o < outLen) {
    const next = Math.round((o + 1) * ratio)
    let sum = 0, n = 0
    for (; i < next && i < input.length; i++) { sum += input[i]; n++ }
    out[o++] = n ? sum / n : 0
  }
  return out
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((a, c) => a + c.length, 0)
  const out = new Float32Array(len)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  let o = 44
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Peak level 0–1 — used to skip sending silent clips. */
export function peakOf(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a }
  return p
}

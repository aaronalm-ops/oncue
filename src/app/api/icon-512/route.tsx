import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    <div style={{
      width: 512, height: 512,
      background: '#09090b',
      borderRadius: 96,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
    }}>
      <svg width="220" height="220" viewBox="0 0 220 220">
        <polygon points="54,42 178,110 54,178" fill="#9333EA" />
      </svg>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ width: 88, height: 14, background: '#9333EA', borderRadius: 7 }} />
        <div style={{ width: 60, height: 14, background: '#4C1D95', borderRadius: 7 }} />
        <div style={{ width: 38, height: 14, background: '#2E1065', borderRadius: 7 }} />
      </div>
    </div>,
    { width: 512, height: 512 }
  )
}

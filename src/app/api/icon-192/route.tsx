import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(
    <div style={{
      width: 192, height: 192,
      background: '#09090b',
      borderRadius: 36,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    }}>
      <svg width="80" height="80" viewBox="0 0 80 80">
        <polygon points="20,16 66,40 20,64" fill="#9333EA" />
      </svg>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <div style={{ width: 32, height: 5, background: '#9333EA', borderRadius: 3 }} />
        <div style={{ width: 22, height: 5, background: '#4C1D95', borderRadius: 3 }} />
        <div style={{ width: 14, height: 5, background: '#2E1065', borderRadius: 3 }} />
      </div>
    </div>,
    { width: 192, height: 192 }
  )
}

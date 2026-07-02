import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#09090b',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '44px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <span style={{
            color: '#9333EA',
            fontSize: 78,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            lineHeight: 1,
            marginBottom: 6,
          }}>▶</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 36, height: 5, background: '#9333EA', borderRadius: 3 }} />
            <div style={{ width: 22, height: 5, background: '#4C1D95', borderRadius: 3 }} />
            <div style={{ width: 14, height: 5, background: '#2E1065', borderRadius: 3 }} />
          </div>
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  )
}

import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#09090b',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '116px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <span style={{
            color: '#9333EA',
            fontSize: 210,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            lineHeight: 1,
            marginBottom: 16,
          }}>▶</span>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 96, height: 14, background: '#9333EA', borderRadius: 8 }} />
            <div style={{ width: 58, height: 14, background: '#4C1D95', borderRadius: 8 }} />
            <div style={{ width: 36, height: 14, background: '#2E1065', borderRadius: 8 }} />
          </div>
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  )
}

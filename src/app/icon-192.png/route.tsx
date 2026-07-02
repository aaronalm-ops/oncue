import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#0a0a0a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '44px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          {/* Play triangle */}
          <span style={{
            color: '#F59E0B',
            fontSize: 78,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            lineHeight: 1,
            marginBottom: 6,
          }}>▶</span>
          {/* Music bar lines */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 36, height: 5, background: '#F59E0B', borderRadius: 3 }} />
            <div style={{ width: 22, height: 5, background: '#78350F', borderRadius: 3 }} />
            <div style={{ width: 14, height: 5, background: '#451a03', borderRadius: 3 }} />
          </div>
        </div>
      </div>
    ),
    { width: 192, height: 192 }
  )
}

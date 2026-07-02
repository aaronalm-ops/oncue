import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#0a0a0a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '116px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          {/* Play triangle */}
          <span style={{
            color: '#F59E0B',
            fontSize: 210,
            fontWeight: 900,
            fontFamily: 'sans-serif',
            lineHeight: 1,
            marginBottom: 16,
          }}>▶</span>
          {/* Music bar lines */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ width: 96, height: 14, background: '#F59E0B', borderRadius: 8 }} />
            <div style={{ width: 58, height: 14, background: '#78350F', borderRadius: 8 }} />
            <div style={{ width: 36, height: 14, background: '#451a03', borderRadius: 8 }} />
          </div>
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  )
}

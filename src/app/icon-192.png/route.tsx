import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#000000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '38px',
      }}>
        <span style={{
          color: '#ffffff',
          fontSize: 80,
          fontWeight: 700,
          fontFamily: 'sans-serif',
          letterSpacing: '-4px',
        }}>OC</span>
      </div>
    ),
    { width: 192, height: 192 }
  )
}

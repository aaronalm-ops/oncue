import { NextRequest, NextResponse } from 'next/server'

/**
 * Legacy icon URL — older installed PWAs reference /api/icon-192 from their
 * cached manifest. Redirect them to the current artwork so their home-screen
 * icon updates on the next manifest check instead of going stale.
 */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/icon-192.png', request.url), 308)
}

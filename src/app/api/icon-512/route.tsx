import { NextRequest, NextResponse } from 'next/server'

/** Legacy icon URL — see icon-192. Kept as a redirect for old manifests. */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/icon-512.png', request.url), 308)
}

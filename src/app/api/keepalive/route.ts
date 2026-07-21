import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Called by Vercel Cron every 5 days — keeps the Supabase free project from pausing.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  // Fail CLOSED when the secret is missing — otherwise the check degrades to
  // comparing against "Bearer undefined", which any caller can send.
  if (!secret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('services').select('id').limit(1)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

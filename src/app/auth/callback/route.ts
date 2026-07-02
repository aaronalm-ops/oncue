import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)

    // First-time users: redirect to instrument selection if not set yet
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles').select('instrument').eq('id', user.id).single()
      if (!profile?.instrument) {
        return NextResponse.redirect(`${origin}/auth/select-instrument`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/services`)
}

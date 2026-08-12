import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * P1: identity via getClaims() — validates the JWT locally (no auth-server
 * round-trip) once asymmetric signing keys are enabled in the Supabase
 * dashboard. On legacy HS256 projects supabase-js transparently falls back
 * to a server check, so this is safe to deploy BEFORE the key migration.
 * Only identity (id) is exposed — everything else must come from the DB.
 */
export async function getAuthUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ id: string } | null> {
  const { data } = await supabase.auth.getClaims()
  const sub = data?.claims?.sub
  return typeof sub === 'string' && sub ? { id: sub } : null
}

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

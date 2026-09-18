import { redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import MeClient from './MeClient'
import type { AppRole, AppTeam } from '@/lib/types'

/**
 * Me — everything that used to hide in the avatar dropdown: who you are,
 * your instrument and key, and the role-gated doors (Stats for leaders,
 * Admin for admins). Pulling it here is what lets the top of every other
 * page go quiet.
 */
export default async function MePage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, instrument, display_name, preferred_key, teams')
    .eq('id', user.id)
    .single()

  const p = profile as {
    role?: AppRole; instrument?: string | null; display_name?: string | null
    preferred_key?: string | null; teams?: AppTeam[]
  } | null

  return (
    <MeClient
      role={(p?.role ?? 'member') as AppRole}
      instrument={p?.instrument ?? null}
      displayName={p?.display_name ?? null}
      preferredKey={p?.preferred_key ?? null}
      teams={(p?.teams ?? []) as AppTeam[]}
    />
  )
}

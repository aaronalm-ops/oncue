import { redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { findLiveTarget } from '@/lib/live-target'
import IdentifyClient from './IdentifyClient'

/**
 * "Which song is this?" — the leader starts an impromptu song, anyone taps
 * listen, the phone hears a few words, the library says which song it is
 * (and, on-device, which key it's in). One more tap and it's on everyone's
 * Live screen in that key.
 */
export default async function IdentifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/auth/login')

  const sp = await searchParams
  const back = typeof sp.from === 'string' && sp.from.startsWith('/') ? sp.from : '/services'

  // Today's service, else the next one, else the last — where "go live" lands.
  const target = await findLiveTarget(supabase)

  return (
    <IdentifyClient
      target={target ? { id: target.id, label: target.label, isToday: target.isToday } : null}
      backHref={back}
    />
  )
}

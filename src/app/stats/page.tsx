import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import StatsClient, { type StatsPayload } from './StatsClient'
import type { AppRole } from '@/lib/types'

export default async function StatsPage() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'member') as AppRole

  // Same gate as the RPC — bounce members before the round trip rather than
  // letting them hit an exception.
  if (!['master', 'admin', 'worship_leader'].includes(role)) redirect('/services')

  // Scope is decided server-side inside worship_stats(): a worship_leader
  // always gets their own numbers, master/admin get every leader.
  const { data, error } = await supabase.rpc('worship_stats')

  if (error?.message?.includes('does not exist')) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p className="font-semibold">Stats aren&rsquo;t set up yet.</p>
          <p className="text-sm text-zinc-500">
            Run <code className="text-purple-400">supabase/v18_worship_stats.sql</code> in your Supabase SQL editor first.
          </p>
          <Link href="/services" className="block mt-4 text-sm text-zinc-600 active:text-zinc-400">← Back to services</Link>
        </div>
      </div>
    )
  }

  return <StatsClient stats={(data ?? null) as StatsPayload | null} role={role} error={error?.message ?? null} />
}

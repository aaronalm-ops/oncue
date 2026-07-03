import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import AdminClient from './AdminClient'
import type { AppRole } from '@/lib/types'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  const actorRole = (profile?.role ?? 'member') as AppRole
  if (!['master', 'admin'].includes(actorRole)) redirect('/services')

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, instrument, role, created_at')
    .order('created_at', { ascending: true })

  const { count: serviceCount } = await supabase
    .from('services')
    .select('*', { count: 'exact', head: true })

  // Enrich with emails via service role key (optional — set SUPABASE_SERVICE_ROLE_KEY in Vercel env)
  let emailMap: Record<string, string> = {}
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceKey && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        serviceKey,
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      const { data: { users } } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
      users?.forEach(u => { emailMap[u.id] = u.email ?? '' })
    } catch {
      // non-fatal — admin panel works without emails
    }
  }

  const members = (profiles ?? []).map(p => ({
    id: p.id,
    display_name: p.display_name as string | null,
    instrument: p.instrument as string | null,
    role: (p.role ?? 'member') as AppRole,
    email: emailMap[p.id] ?? null,
  }))

  return (
    <AdminClient
      members={members}
      actorRole={actorRole}
      actorId={user.id}
      serviceCount={serviceCount ?? 0}
    />
  )
}

import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import EditSetlistClient from './EditSetlistClient'

export default async function EditSetlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role === 'member') redirect(`/services/${id}`)

  const { data: service } = await supabase
    .from('services')
    .select('id, service_date, worship_leader_id')
    .eq('id', id)
    .single()

  if (!service) notFound()

  const { data: songs } = await supabase
    .from('songs')
    .select('id, title, scale, order_index')
    .eq('service_id', id)
    .order('order_index', { ascending: true })

  // Worship-leader options — so it can be assigned/changed after creation
  // (setlists are often built before the intended leader has registered).
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .order('display_name', { ascending: true })
  const leaders = (profiles ?? []).map(p => ({
    id: p.id,
    name: p.display_name || 'Unnamed member',
    isLeader: p.role === 'worship_leader',
  }))

  return (
    <EditSetlistClient
      serviceId={id}
      serviceDate={service.service_date}
      leaders={leaders}
      initialLeaderId={(service as { worship_leader_id?: string | null }).worship_leader_id ?? null}
      initialSongs={(songs ?? []).map(s => ({
        id: s.id,
        title: s.title,
        scale: s.scale,
        order_index: s.order_index,
      }))}
    />
  )
}

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
    .select('id, service_date')
    .eq('id', id)
    .single()

  if (!service) notFound()

  const { data: songs } = await supabase
    .from('songs')
    .select('id, title, scale, order_index')
    .eq('service_id', id)
    .order('order_index', { ascending: true })

  return (
    <EditSetlistClient
      serviceId={id}
      serviceDate={service.service_date}
      initialSongs={(songs ?? []).map(s => ({
        id: s.id,
        title: s.title,
        scale: s.scale,
        order_index: s.order_index,
      }))}
    />
  )
}

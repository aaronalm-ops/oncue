import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Check if profile has instrument set
  const { data: profile } = await supabase
    .from('profiles')
    .select('instrument')
    .eq('id', user.id)
    .single()

  if (!profile?.instrument) redirect('/auth/select-instrument')

  // Check for a service today
  const today = new Date().toISOString().split('T')[0]
  const { data: todayService } = await supabase
    .from('services')
    .select('id')
    .eq('service_date', today)
    .single()

  if (todayService) redirect(`/services/${todayService.id}`)

  redirect('/services')
}

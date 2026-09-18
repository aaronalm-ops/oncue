import { redirect } from 'next/navigation'
import { createClient, getAuthUser } from '@/lib/supabase/server'

export default async function RootPage() {
  const supabase = await createClient()

  const user = await getAuthUser(supabase)
  if (!user) redirect('/auth/login')

  // This is the PWA's launch screen — every cold open of the app comes
  // through here, so the two lookups run together, not one after the other.
  // Today's service — in the church's timezone, not the server's (UTC on Vercel)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
  const [{ data: profile }, { data: todayService }] = await Promise.all([
    supabase.from('profiles').select('instrument').eq('id', user.id).single(),
    supabase.from('services').select('id').eq('service_date', today).single(),
  ])

  if (!profile?.instrument) redirect('/auth/select-instrument')
  if (todayService) redirect(`/services/${todayService.id}`)

  redirect('/services')
}

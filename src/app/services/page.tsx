import { createClient } from '@/lib/supabase/server'
import UploadButton from '@/components/UploadButton'
import ServicesClient from './ServicesClient'

export default async function ServicesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user!.id).single()
  const role = (profile?.role ?? 'member') as 'master' | 'admin' | 'member'
  const isPrivileged = role === 'master' || role === 'admin'

  const { data: services } = await supabase
    .from('services')
    .select('id, service_date, day_of_week, source_filename')
    .order('service_date', { ascending: false })

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="w-9 h-9 bg-zinc-900 rounded-xl border border-zinc-800 flex flex-col items-center justify-center gap-0.5">
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none">
                <polygon points="4,3 13,8 4,13" fill="#F59E0B" />
              </svg>
              <div className="flex gap-0.5 items-center">
                <div className="w-3.5 h-0.5 bg-amber-500 rounded-full" />
                <div className="w-2 h-0.5 bg-amber-800 rounded-full" />
              </div>
            </div>
            <h1 className="text-xl font-bold tracking-tight">OnCue</h1>
          </div>
          {isPrivileged && <UploadButton />}
        </div>
        <ServicesClient services={services ?? []} isPrivileged={isPrivileged} />
      </div>
    </div>
  )
}

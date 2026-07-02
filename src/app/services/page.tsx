import { createClient } from '@/lib/supabase/server'
import UploadButton from '@/components/UploadButton'
import ServicesClient from './ServicesClient'

export default async function ServicesPage() {
  const supabase = await createClient()

  const { data: services } = await supabase
    .from('services')
    .select('id, service_date, day_of_week, source_filename')
    .order('service_date', { ascending: false })

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Services</h1>
          <UploadButton />
        </div>
        <ServicesClient services={services ?? []} />
      </div>
    </div>
  )
}

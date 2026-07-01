import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import UploadButton from '@/components/UploadButton'

function formatServiceDate(dateStr: string, day: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function ServicesPage() {
  const supabase = await createClient()

  const { data: services } = await supabase
    .from('services')
    .select('id, service_date, day_of_week, source_filename')
    .order('service_date', { ascending: false })

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Services</h1>
          <UploadButton />
        </div>

        {(!services || services.length === 0) ? (
          <div className="text-zinc-500 text-center py-16">
            <p>No services yet.</p>
            <p className="text-sm mt-1">Upload a chart to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {services.map(s => (
              <Link
                key={s.id}
                href={`/services/${s.id}`}
                className="flex items-center justify-between bg-zinc-900 rounded-xl px-5 py-4 active:bg-zinc-800 transition-colors"
              >
                <div>
                  <p className="font-semibold text-white">{formatServiceDate(s.service_date, s.day_of_week)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{s.source_filename}</p>
                </div>
                <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

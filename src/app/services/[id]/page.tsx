import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: service } = await supabase
    .from('services')
    .select('id, service_date, day_of_week, instruments')
    .eq('id', id)
    .single()

  if (!service) notFound()

  const date = new Date(service.service_date + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24 space-y-8">
        <div>
          <Link href="/services" className="text-zinc-500 text-sm flex items-center gap-1 mb-4">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All services
          </Link>
          <h1 className="text-2xl font-bold">{dateLabel}</h1>
          <p className="text-zinc-500 text-sm mt-1">{service.instruments.join(' · ')}</p>
        </div>

        <div className="space-y-3">
          <Link
            href={`/services/${id}/live`}
            className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">Live Sync</p>
              <p className="text-zinc-400 text-sm">Follow the service in real time</p>
            </div>
          </Link>

          <Link
            href={`/services/${id}/my-part`}
            className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">My Part</p>
              <p className="text-zinc-400 text-sm">Your instrument across the whole service</p>
            </div>
          </Link>
        </div>

        <a
          href={`/api/services/${id}/download`}
          className="flex items-center gap-2 text-zinc-500 text-sm py-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          Download original chart
        </a>
      </div>
    </div>
  )
}

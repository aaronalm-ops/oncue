import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

const DAY_GRADIENT: Record<string, string> = {
  THURSDAY: 'from-amber-900/30 to-transparent',
  SATURDAY: 'from-sky-900/30 to-transparent',
}

const DAY_BADGE: Record<string, string> = {
  THURSDAY: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  SATURDAY: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
}

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
  const gradient = DAY_GRADIENT[service.day_of_week] ?? 'from-zinc-900/30 to-transparent'
  const badge = DAY_BADGE[service.day_of_week] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24 space-y-8">

        {/* Header */}
        <div>
          <Link href="/services" className="text-zinc-500 text-sm flex items-center gap-1 mb-5 active:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All services
          </Link>

          <div className={`rounded-2xl bg-gradient-to-b ${gradient} p-5 border border-zinc-800/50`}>
            <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border mb-3 ${badge}`}>
              {service.day_of_week.charAt(0) + service.day_of_week.slice(1).toLowerCase()}
            </span>
            <h1 className="text-2xl font-bold leading-tight">{dateLabel}</h1>
            <p className="text-zinc-500 text-sm mt-2">{service.instruments.join(' · ')}</p>
          </div>
        </div>

        {/* Mode selection */}
        <div className="space-y-3">
          <Link
            href={`/services/${id}/live`}
            className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors border border-zinc-800/50"
          >
            <div className="w-11 h-11 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-black" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">Live Sync</p>
              <p className="text-zinc-400 text-sm">Follow the service in real time</p>
            </div>
            <svg className="w-4 h-4 text-zinc-600 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href={`/services/${id}/my-part`}
            className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors border border-zinc-800/50"
          >
            <div className="w-11 h-11 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white">My Part</p>
              <p className="text-zinc-400 text-sm">Your instrument across the whole service</p>
            </div>
            <svg className="w-4 h-4 text-zinc-600 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* Download */}
        <a
          href={`/api/services/${id}/download`}
          className="flex items-center gap-2 text-zinc-600 text-sm py-2 active:text-zinc-400 transition-colors"
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

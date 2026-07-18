import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { canSeeChords } from '@/lib/chords/access'

const DAY_GRADIENT: Record<string, string> = {
  THURSDAY: 'from-purple-900/30 to-transparent',
  SATURDAY: 'from-violet-900/20 to-transparent',
}

const DAY_BADGE: Record<string, string> = {
  THURSDAY: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SATURDAY: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
}

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: service }, { data: { user } }] = await Promise.all([
    supabase.from('services').select('id, service_date, day_of_week, instruments').eq('id', id).single(),
    supabase.auth.getUser(),
  ])

  if (!service) notFound()

  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }

  const role = profile?.role ?? 'member'
  const canEdit = role !== 'member'

  const date = new Date(service.service_date + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const gradient = DAY_GRADIENT[service.day_of_week] ?? 'from-zinc-900/30 to-transparent'
  const badge = DAY_BADGE[service.day_of_week] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'

  // Which songs have chords available (via confirmed link, or title match)?
  // Gated to editors until the parser rollout opens chords to everyone.
  const chordsVisible = canSeeChords(role)
  const { data: songs } = chordsVisible
    ? await supabase
        .from('songs')
        .select('id, order_index, title, scale')
        .eq('service_id', id)
        .order('order_index')
    : { data: [] as { id: string; order_index: number; title: string; scale: string | null }[] }

  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const songIds = (songs ?? []).map(s => s.id)
  const [{ data: links }, { data: librarySongs }] = await Promise.all([
    songIds.length
      ? supabase.from('song_links').select('song_id, library_song_id').in('song_id', songIds)
      : Promise.resolve({ data: [] as { song_id: string; library_song_id: string }[] }),
    supabase.from('library_songs').select('id, title, song_versions(id, reviewed_at)'),
  ])
  const linkMap = new Map((links ?? []).map(l => [l.song_id, l.library_song_id]))
  const reviewedLib = new Map(
    (librarySongs ?? [])
      .filter(ls => (ls.song_versions ?? []).some(v => v.reviewed_at !== null))
      .map(ls => [norm(ls.title), ls.id]),
  )
  const reviewedLibIds = new Set(
    (librarySongs ?? [])
      .filter(ls => (ls.song_versions ?? []).some(v => v.reviewed_at !== null))
      .map(ls => ls.id),
  )
  const songChords = (songs ?? []).map(s => {
    const linked = linkMap.get(s.id)
    const libId = linked && reviewedLibIds.has(linked) ? linked : reviewedLib.get(norm(s.title)) ?? null
    return { ...s, hasChords: libId !== null }
  })
  const anyChords = songChords.some(s => s.hasChords)

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-12 pb-24 space-y-8">

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

        <div className="space-y-3">
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

          {canEdit && (
            <Link
              href={`/services/${id}/edit`}
              className="flex items-center gap-4 bg-zinc-900 rounded-2xl px-5 py-5 active:bg-zinc-800 transition-colors border border-zinc-800/50"
            >
              <div className="w-11 h-11 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">Edit Setlist</p>
                <p className="text-zinc-400 text-sm">Reorder, rename, or add songs</p>
              </div>
              <svg className="w-4 h-4 text-zinc-600 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>

        {anyChords && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600 mb-2">Song chords</p>
            <div className="space-y-1.5">
              {songChords.map(s => (
                s.hasChords ? (
                  <Link
                    key={s.id}
                    href={`/services/${id}/chords/${s.id}`}
                    className="flex items-center gap-3 bg-zinc-900 rounded-xl px-4 py-3 active:bg-zinc-800 transition-colors border border-zinc-800/50"
                  >
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">{s.title}</span>
                    {s.scale && (
                      <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded bg-purple-600 text-white">{s.scale}</span>
                    )}
                    <svg className="w-4 h-4 text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ) : (
                  <div key={s.id} className="flex items-center gap-3 rounded-xl px-4 py-3 border border-zinc-900">
                    <span className="flex-1 min-w-0 text-sm text-zinc-600 truncate">{s.title}</span>
                    <span className="shrink-0 text-[10px] text-zinc-700">no chords</span>
                  </div>
                )
              ))}
            </div>
          </div>
        )}

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

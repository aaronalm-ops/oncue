'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Avatar from '@/components/Avatar'

interface Service {
  id: string
  service_date: string
  day_of_week: string
  source_filename: string
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function whatsappUrl(service: Service) {
  const label = formatDate(service.service_date)
  const text = `The chart for the service ${label} has been uploaded.`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

const DAY_ACCENT: Record<string, string> = {
  THURSDAY: 'border-l-purple-600',
  SATURDAY: 'border-l-violet-400',
}

export default function ServicesClient({
  services,
  isPrivileged,
  canCreateSetlist,
  todayStr,
  leaders = {},
}: {
  services: Service[]
  isPrivileged: boolean
  canCreateSetlist: boolean
  todayStr: string
  leaders?: Record<string, { name: string | null }>
}) {
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [list, setList] = useState(services)

  // Find the id of the next upcoming service (earliest date >= today, since list is desc)
  const nextUpcomingId = [...list]
    .filter(s => s.service_date >= todayStr)
    .sort((a, b) => a.service_date.localeCompare(b.service_date))[0]?.id ?? null

  const filtered = query.trim()
    ? list.filter(s =>
        formatDate(s.service_date).toLowerCase().includes(query.toLowerCase()) ||
        s.source_filename.toLowerCase().includes(query.toLowerCase())
      )
    : list

  async function handleDelete(id: string, filename: string) {
    setDeleting(id)
    const supabase = createClient()
    await supabase.from('services').delete().eq('id', id)
    // Best-effort: clean up the file from Storage (don't fail if it errors)
    supabase.storage.from('charts').remove([`${id}/${filename}`]).catch(() => {})
    setList(prev => prev.filter(s => s.id !== id))
    setConfirmDelete(null)
    setDeleting(null)
  }

  if (list.length === 0) {
    return (
      <div className="text-zinc-500 text-center py-16">
        <p>No services yet.</p>
        {isPrivileged && <p className="text-sm mt-1">Upload a chart to get started.</p>}
        {canCreateSetlist && (
          <Link href="/services/new"
            className="inline-flex items-center gap-2 mt-4 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-95 transition-transform">
            + New Setlist
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {canCreateSetlist && (
        <Link href="/services/new"
          className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-purple-700 to-purple-600 px-5 py-4 shadow-lg shadow-purple-950/40 active:scale-[0.99] transition-transform">
          <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-white">New Setlist</p>
            <p className="text-purple-200/80 text-xs">Start here — plan the next service</p>
          </div>
          <svg className="w-4 h-4 text-purple-200 ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      )}

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search services…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 text-sm"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">No results for &ldquo;{query}&rdquo;</p>
      )}

      {filtered.map(s => {
        const accent = DAY_ACCENT[s.day_of_week] ?? 'border-l-zinc-700'
        const isNext = s.id === nextUpcomingId
        return (
          <div key={s.id}>
            {confirmDelete === s.id ? (
              <div className="flex items-center justify-between bg-zinc-900 border border-red-900 rounded-xl px-5 py-4">
                <p className="text-sm text-white">Delete this chart for everyone?</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(null)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-700 text-white active:scale-95 transition-transform">
                    Cancel
                  </button>
                  <button onClick={() => handleDelete(s.id, s.source_filename)} disabled={deleting === s.id}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-50 active:scale-95 transition-transform">
                    {deleting === s.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`flex items-center bg-zinc-900 rounded-xl overflow-hidden border-l-4 ${accent} ${isNext ? 'ring-1 ring-purple-500/60 shadow-[0_0_16px_rgba(147,51,234,0.18)]' : ''}`}>
                <Link href={`/services/${s.id}`} className="flex-1 px-4 py-4 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-white leading-tight">{formatDate(s.service_date)}</p>
                    {isNext && (
                      <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-600 text-white uppercase tracking-wide">
                        Next up
                      </span>
                    )}
                  </div>
                  {leaders[s.id] ? (
                    <div className="flex items-center gap-1.5 mt-1" title={`Led by ${leaders[s.id].name ?? 'worship leader'}`}>
                      <Avatar name={leaders[s.id].name} size={18} />
                      <span className="text-xs text-zinc-500 truncate">Led by {leaders[s.id].name ?? 'worship leader'}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{s.source_filename}</p>
                  )}
                </Link>

                {/* WhatsApp share */}
                <a href={whatsappUrl(s)} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-4 text-zinc-600 hover:text-green-400 transition-colors shrink-0"
                  aria-label="Share on WhatsApp">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </a>

                {/* Delete — privileged only */}
                {isPrivileged && (
                  <button onClick={() => setConfirmDelete(s.id)}
                    className="px-3 py-4 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                    aria-label="Delete chart">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

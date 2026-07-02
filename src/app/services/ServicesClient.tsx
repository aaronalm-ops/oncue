'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

export default function ServicesClient({ services }: { services: Service[] }) {
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [list, setList] = useState(services)
  const router = useRouter()

  const filtered = query.trim()
    ? list.filter(s =>
        formatDate(s.service_date).toLowerCase().includes(query.toLowerCase()) ||
        s.source_filename.toLowerCase().includes(query.toLowerCase())
      )
    : list

  async function handleDelete(id: string) {
    setDeleting(id)
    const supabase = createClient()
    await supabase.from('services').delete().eq('id', id)
    setList(prev => prev.filter(s => s.id !== id))
    setConfirmDelete(null)
    setDeleting(null)
  }

  if (list.length === 0) {
    return (
      <div className="text-zinc-500 text-center py-16">
        <p>No services yet.</p>
        <p className="text-sm mt-1">Upload a chart to get started.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search services…"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 text-sm"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">No results for &ldquo;{query}&rdquo;</p>
      )}

      {filtered.map(s => (
        <div key={s.id} className="relative">
          {confirmDelete === s.id ? (
            <div className="flex items-center justify-between bg-zinc-900 border border-red-800 rounded-xl px-5 py-4">
              <p className="text-sm text-white">Delete this chart?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(null)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-700 text-white">
                  Cancel
                </button>
                <button onClick={() => handleDelete(s.id)} disabled={deleting === s.id}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-50">
                  {deleting === s.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center bg-zinc-900 rounded-xl overflow-hidden">
              <Link href={`/services/${s.id}`} className="flex-1 px-5 py-4">
                <p className="font-semibold text-white">{formatDate(s.service_date)}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{s.source_filename}</p>
              </Link>
              <button onClick={() => setConfirmDelete(s.id)}
                className="px-4 py-4 text-zinc-600 hover:text-red-400 transition-colors shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

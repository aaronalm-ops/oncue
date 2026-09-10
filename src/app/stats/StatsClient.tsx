'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Avatar from '@/components/Avatar'
import type { AppRole } from '@/lib/types'

export interface StatSong {
  library_song_id: string | null
  title: string
  times: number
  last_played: string | null
  weeks_since: number | null
}

export interface StatLeader {
  leader_id: string | null
  display_name: string | null
  setlist_count: number
  first_service: string | null
  last_service: string | null
  distinct_songs: number
  top_songs: StatSong[]
  keys: { key: string; songs: number }[]
}

export interface StatsPayload {
  scope: 'self' | 'all'
  generated_at: string
  leaders: StatLeader[]
  rotation: StatSong[]
}

interface Props {
  stats: StatsPayload | null
  role: AppRole
  error: string | null
}

/** "3 weeks ago" / "this week" / "never" — the only number on this page that
 *  changes a decision, so it gets words rather than a bare integer. */
function agoLabel(weeks: number | null): string {
  if (weeks === null) return 'Never played'
  if (weeks <= 0) return 'This week'
  if (weeks === 1) return '1 week ago'
  if (weeks < 52) return `${weeks} weeks ago`
  const years = Math.floor(weeks / 52)
  return years === 1 ? 'Over a year ago' : `Over ${years} years ago`
}

/** Cold songs earn a warmer colour the longer they sit. */
function agoTone(weeks: number | null): string {
  if (weeks === null) return 'text-zinc-600'
  if (weeks <= 2) return 'text-purple-400'
  if (weeks <= 8) return 'text-zinc-400'
  if (weeks <= 26) return 'text-amber-500/80'
  return 'text-zinc-500'
}

function dateLabel(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export default function StatsClient({ stats, role, error }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'stale' | 'most'>('stale')
  const [openLeader, setOpenLeader] = useState<string | null>(null)

  const leaders = stats?.leaders ?? []
  const isAll = stats?.scope === 'all'

  const filtered = useMemo(() => {
    const rotation = stats?.rotation ?? []
    const q = query.trim().toLowerCase()
    const rows = q ? rotation.filter(s => s.title.toLowerCase().includes(q)) : rotation
    if (sort === 'most') return [...rows].sort((a, b) => b.times - a.times || a.title.localeCompare(b.title))
    // 'stale' — the server already orders oldest-first with never-played last
    return rows
  }, [stats, query, sort])

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/services"
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Stats</h1>
            <p className="text-[11px] text-zinc-600">
              {isAll ? 'All worship leaders' : 'Your setlists'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-900/50 bg-red-950/30 px-4 py-3">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* ---- Leaders ---- */}
        {leaders.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center mb-8">
            <p className="text-sm text-zinc-500">No setlists attributed to a worship leader yet.</p>
            <p className="text-xs text-zinc-600 mt-1.5">
              Assign a leader on a service page and it will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-8">
            {leaders.map(l => {
              const id = l.leader_id ?? 'unassigned'
              const open = openLeader === id || leaders.length === 1
              const name = l.display_name ?? (l.leader_id ? 'Unnamed member' : 'Unassigned')
              return (
                <div key={id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <button
                    onClick={() => setOpenLeader(open && leaders.length > 1 ? null : id)}
                    className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-zinc-800/50 transition-colors"
                    disabled={leaders.length === 1}
                  >
                    {l.leader_id
                      ? <Avatar name={l.display_name} size={36} />
                      : <div className="w-9 h-9 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-600 text-sm">?</div>}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{name}</p>
                      <p className="text-[11px] text-zinc-500">
                        {l.setlist_count} setlist{l.setlist_count === 1 ? '' : 's'} · {l.distinct_songs} song{l.distinct_songs === 1 ? '' : 's'}
                      </p>
                    </div>
                    {leaders.length > 1 && (
                      <svg
                        className={`w-4 h-4 text-zinc-600 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>

                  {open && (
                    <div className="px-4 pb-4 space-y-4 border-t border-zinc-800/70 pt-3.5">
                      {!l.leader_id && (
                        <p className="text-[11px] text-zinc-600 leading-relaxed">
                          Services with no worship leader set — mostly charts uploaded as a PDF,
                          which never record one. Shown so the totals add up.
                        </p>
                      )}

                      <div className="text-[11px] text-zinc-500">
                        {dateLabel(l.first_service)} — {dateLabel(l.last_service)}
                      </div>

                      {/* Keys */}
                      {l.keys.length > 0 && (
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-1.5">Keys used</p>
                          <div className="flex flex-wrap gap-1.5">
                            {l.keys.map(k => (
                              <span
                                key={k.key}
                                className="px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-xs"
                              >
                                <span className="font-semibold text-white">{k.key}</span>
                                <span className="text-zinc-600 ml-1.5">{k.songs}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Most used */}
                      {l.top_songs.length > 0 && (
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-1.5">Most used songs</p>
                          <div className="space-y-1">
                            {l.top_songs.map(s => (
                              <div key={(s.library_song_id ?? s.title)} className="flex items-baseline gap-2">
                                <span className="text-sm text-white truncate flex-1 min-w-0">{s.title}</span>
                                <span className={`text-[11px] shrink-0 ${agoTone(s.weeks_since)}`}>
                                  {agoLabel(s.weeks_since)}
                                </span>
                                <span className="text-xs text-zinc-500 shrink-0 tabular-nums w-6 text-right">
                                  ×{s.times}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ---- Rotation ---- */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Song rotation</h2>
            <p className="text-[11px] text-zinc-600">Across every leader — when the church last sang it</p>
          </div>
          <div className="flex rounded-xl border border-zinc-800 overflow-hidden shrink-0">
            {(['stale', 'most'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  sort === s ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-500'
                }`}
              >
                {s === 'stale' ? 'Longest' : 'Most used'}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search songs…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600 transition-colors"
          />
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-600">
            {query ? 'No songs match your search.' : 'Nothing in the library yet.'}
          </p>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/70 overflow-hidden">
            {filtered.map(s => {
              const row = (
                <div className="px-4 py-3 flex items-baseline gap-3">
                  <span className="text-sm text-white truncate flex-1 min-w-0">{s.title}</span>
                  <span className={`text-[11px] shrink-0 ${agoTone(s.weeks_since)}`}>
                    {agoLabel(s.weeks_since)}
                  </span>
                  <span className="text-xs text-zinc-600 shrink-0 tabular-nums w-8 text-right">
                    {s.times > 0 ? `×${s.times}` : ''}
                  </span>
                </div>
              )
              return s.library_song_id ? (
                <Link
                  key={s.library_song_id}
                  href={`/library/${s.library_song_id}`}
                  className="block active:bg-zinc-800/50 transition-colors"
                >
                  {row}
                </Link>
              ) : (
                <div key={`t:${s.title}`}>{row}</div>
              )
            })}
          </div>
        )}

        {stats && (
          <p className="mt-6 text-center text-[11px] text-zinc-700">
            {role === 'worship_leader'
              ? 'Your own setlists only. Admins see every leader.'
              : 'Every worship leader.'}
          </p>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SongPicker, { type PickedSong } from '@/components/SongPicker'

interface Leader { id: string; name: string; isLeader: boolean }

interface SetlistSong {
  title: string
  scale: string
  library_song_id: string | null
  hasChords: boolean
}

/** A service already occupying the chosen date (chart-only or full setlist). */
interface ExistingService {
  id: string
  leaderId: string | null
  leaderName: string | null
  sourceFilename: string
  songs: Array<{ id: string; title: string; scale: string | null; willLink: boolean }>
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

interface Props {
  leaders: Leader[]
  currentUserId: string
}

/**
 * Setlist-first flow: create the service on Monday, before the conductor's
 * chart exists. Songs are searched by title AND lyrics; repeating songs pre-fill
 * flow + notes + YouTube from last time. Wednesday's chart merges onto this.
 */
export default function NewSetlistClient({ leaders, currentUserId }: Props) {
  const [date, setDate] = useState('')
  const [leaderId, setLeaderId] = useState(
    leaders.find(l => l.isLeader)?.id ?? leaders.find(l => l.id === currentUserId)?.id ?? ''
  )
  const [songs, setSongs] = useState<SetlistSong[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Retro-attach: a service already exists on the chosen date
  const [existing, setExisting] = useState<ExistingService | null>(null)
  const [checkingDate, setCheckingDate] = useState(false)
  const [adoptMode, setAdoptMode] = useState(false)
  const [declinedAdopt, setDeclinedAdopt] = useState(false)
  const router = useRouter()

  const dayOfWeek = useMemo(() => {
    if (!date) return null
    const d = new Date(date + 'T00:00:00')
    const day = d.getDay() // 0 Sun … 6 Sat
    if (day === 4) return 'THURSDAY'
    if (day === 6) return 'SATURDAY'
    return null
  }, [date])

  // Proactively detect an existing service for the chosen date so the user
  // finds out NOW, not at save time.
  useEffect(() => {
    setExisting(null)
    setAdoptMode(false)
    setDeclinedAdopt(false)
    if (!date) return
    let cancelled = false
    ;(async () => {
      setCheckingDate(true)
      const supabase = createClient()
      const { data: svc } = await supabase
        .from('services')
        .select('id, worship_leader_id, source_filename')
        .eq('service_date', date)
        .maybeSingle()
      if (cancelled) return
      if (!svc) { setCheckingDate(false); return }

      const [{ data: svcSongs }, { data: libSongs }, leaderRes] = await Promise.all([
        supabase.from('songs').select('id, title, scale, order_index').eq('service_id', svc.id).order('order_index'),
        supabase.from('library_songs').select('id, title'),
        svc.worship_leader_id
          ? supabase.from('public_profiles').select('display_name').eq('id', svc.worship_leader_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      const libByTitle = new Set((libSongs ?? []).map(ls => normTitle(ls.title)))
      setExisting({
        id: svc.id,
        leaderId: svc.worship_leader_id ?? null,
        leaderName: (leaderRes.data as { display_name?: string | null } | null)?.display_name ?? null,
        sourceFilename: svc.source_filename,
        songs: (svcSongs ?? []).map(s => ({
          id: s.id,
          title: s.title,
          scale: s.scale,
          willLink: libByTitle.has(normTitle(s.title)),
        })),
      })
      setCheckingDate(false)
    })()
    return () => { cancelled = true }
  }, [date])

  /** Retro-attach: enrich the EXISTING service in place — leader + library
   *  links + leader memory. Never deletes or recreates anything, so the
   *  chart's sections, instructions, and personal notes are untouched. */
  async function adoptSave() {
    if (!existing) return
    setError(null)
    setSaving(true)
    const supabase = createClient()

    if (leaderId) {
      const { error: leaderErr } = await supabase.rpc('set_worship_leader', {
        p_service_id: existing.id,
        p_worship_leader: leaderId,
      })
      if (leaderErr) { setSaving(false); setError(leaderErr.message); return }
    }

    // Link the chart's songs to library songs by normalized title (idempotent:
    // song_links is UNIQUE(song_id); existing links are left alone).
    const { data: libSongs } = await supabase.from('library_songs').select('id, title')
    const libMap = new Map((libSongs ?? []).map(ls => [normTitle(ls.title), ls.id]))
    for (const s of existing.songs) {
      const libId = libMap.get(normTitle(s.title))
      if (!libId) continue
      const { error: linkErr } = await supabase
        .from('song_links')
        .upsert({ song_id: s.id, library_song_id: libId }, { onConflict: 'song_id', ignoreDuplicates: true })
      if (linkErr) console.error('link failed for', s.title, linkErr.message)
    }

    // Snapshot the (now-attributed) leader's arrangement — best-effort
    if (leaderId) {
      const { error: memErr } = await supabase.rpc('capture_service_memory', { p_service_id: existing.id })
      if (memErr) console.error('memory capture failed', memErr.message)
    }

    setSaving(false)
    router.push(`/services/${existing.id}`)
      }

  function addFromPick(s: PickedSong) {
    setSongs(prev => [...prev, { title: s.title, scale: '', library_song_id: s.library_song_id, hasChords: s.hasChords }])
    // Prefill the ORIGINAL key (the sheet's own key from the latest reviewed
    // version) — useful when the leader wants "whatever it was written in".
    // Only fills if the field is still empty when the lookup returns.
    if (s.library_song_id) {
      const libId = s.library_song_id
      const title = s.title
      createClient()
        .from('song_versions')
        .select('stored_key')
        .eq('library_song_id', libId)
        .not('reviewed_at', 'is', null)
        .order('reviewed_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const k = data?.[0]?.stored_key
          if (!k) return
          setSongs(prev => prev.map(x =>
            x.library_song_id === libId && x.title === title && x.scale === ''
              ? { ...x, scale: k }
              : x
          ))
        })
    }
  }

  function move(idx: number, dir: -1 | 1) {
    setSongs(prev => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  async function save() {
    setError(null)
    if (!date) { setError('Pick a service date'); return }
    if (!dayOfWeek) { setError('Services are on Thursdays and Saturdays — pick one of those dates'); return }
    if (existing) { setError('This date already has a service — use the options above.'); return }
    if (songs.length === 0) { setError('Add at least one song'); return }

    setSaving(true)
    const supabase = createClient()
    const { data, error: rpcErr } = await supabase.rpc('create_setlist', {
      p_service_date: date,
      p_day_of_week: dayOfWeek,
      p_worship_leader: leaderId || null,
      p_songs: songs.map(s => ({
        title: s.title,
        scale: s.scale.trim() || null,
        library_song_id: s.library_song_id,
      })),
    })
    setSaving(false)
    if (rpcErr) { setError(rpcErr.message); return }
    router.push(`/services/${(data as { service_id: string }).service_id}`)
      }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-lg mx-auto px-4 pt-10 pb-24">

        <div className="flex items-center gap-3 mb-6">
          <Link href="/services"
            className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center active:bg-zinc-800 transition-colors shrink-0">
            <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">New Setlist</h1>
            <p className="text-xs text-zinc-500">The conductor&rsquo;s chart merges onto this when it arrives</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Service date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-600 [color-scheme:dark]" />
              {date && (
                <p className={`mt-1 text-[11px] ${dayOfWeek ? 'text-zinc-500' : 'text-amber-400'}`}>
                  {checkingDate ? 'Checking date…' : (dayOfWeek ?? 'Not a Thursday or Saturday')}
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Worship leader</label>
              <select value={leaderId} onChange={e => setLeaderId(e.target.value)}
                className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-600">
                <option value="">Unassigned — set later</option>
                {leaders.map(l => (
                  <option key={l.id} value={l.id}>{l.name}{l.isLeader ? ' ★' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {/* A service already exists on this date — offer retro-attach */}
          {existing && !adoptMode && (
            <div className="rounded-2xl border border-amber-800/60 bg-amber-950/40 p-4 space-y-3">
              <p className="text-sm text-amber-300 font-semibold">
                {date && `This date already has a service`}
                {existing.leaderName ? ` — led by ${existing.leaderName}` : ''}
              </p>
              <p className="text-xs text-zinc-400">
                {existing.songs.length} song{existing.songs.length === 1 ? '' : 's'}
                {existing.sourceFilename === 'setlist-draft'
                  ? ' from a setlist draft'
                  : ` from the conductor's chart (${existing.sourceFilename})`}.
                {existing.leaderId
                  ? ' It already has a worship leader.'
                  : ' No worship leader is attached yet.'}
              </p>
              {existing.leaderId ? (
                <Link href={`/services/${existing.id}`}
                  className="inline-block rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 transition-transform">
                  Open that service instead
                </Link>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-300">Is this the service you&rsquo;re creating the setlist for?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setAdoptMode(true); setDeclinedAdopt(false) }}
                      className="flex-1 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white active:scale-95 transition-transform">
                      Yes — use its songs
                    </button>
                    <button
                      onClick={() => setDeclinedAdopt(true)}
                      className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm text-zinc-300">
                      No
                    </button>
                  </div>
                  {declinedAdopt && (
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Each date holds exactly one service. If this is a different service, pick another
                      date above. If the existing one is wrong, delete it from the Services page first —
                      then come back and create fresh.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Adopt mode: the chart's songs, read-only — saving attaches leader + links */}
          {adoptMode && existing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Songs from the chart
                </label>
                <button onClick={() => setAdoptMode(false)} className="text-[11px] text-zinc-500 underline underline-offset-2">
                  Cancel — back to new setlist
                </button>
              </div>
              {existing.songs.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
                  <span className="text-[10px] text-zinc-600 w-4 shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-sm truncate">{s.title}</span>
                  {s.scale && (
                    <span className="shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded bg-purple-600 text-white">{s.scale}</span>
                  )}
                  <span className={`shrink-0 text-[10px] font-semibold ${s.willLink ? 'text-green-500' : 'text-zinc-600'}`}
                    title={s.willLink ? 'Will link to the chord library' : 'No library song with this title yet — upload chords later'}>
                    {s.willLink ? 'links' : 'no chords yet'}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-zinc-600">
                The chart stays exactly as uploaded — this only attaches the worship leader,
                links songs to the chord library, and saves the leader&rsquo;s arrangement memory.
              </p>
            </div>
          )}

          {/* Song picker — searches title AND lyrics (hidden while adopting or blocked) */}
          {!adoptMode && !(existing && !declinedAdopt) && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Add songs</label>
            <div className="mt-1">
              <SongPicker onPick={addFromPick} />
            </div>
          </div>
          )}

          {/* Setlist */}
          {!adoptMode && songs.length > 0 && (
            <div className="space-y-1.5">
              {songs.map((s, i) => (
                <div key={i} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
                  <span className="text-[10px] text-zinc-600 w-4 shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-sm truncate">{s.title}</span>
                  <input
                    value={s.scale}
                    onChange={e => setSongs(prev => prev.map((x, xi) => xi === i ? { ...x, scale: e.target.value } : x))}
                    placeholder="Key" size={3}
                    className="w-12 bg-zinc-800 border border-zinc-700 rounded-lg px-1.5 py-1 text-xs text-center text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-600"
                  />
                  {!s.hasChords && (
                    <span className="shrink-0 text-[10px] font-semibold text-amber-500" title="No chord sheet yet — upload one later">needs chords</span>
                  )}
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="text-zinc-500 disabled:opacity-20 px-1">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === songs.length - 1} className="text-zinc-500 disabled:opacity-20 px-1">↓</button>
                  <button onClick={() => setSongs(prev => prev.filter((_, xi) => xi !== i))} className="text-zinc-600 px-1">✕</button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          {adoptMode && existing ? (
            <button onClick={adoptSave} disabled={saving}
              className="w-full py-3 rounded-xl bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform">
              {saving ? 'Attaching…' : 'Attach setlist to this service'}
            </button>
          ) : (
            <button onClick={save} disabled={saving || (!!existing && !declinedAdopt)}
              className="w-full py-3 rounded-xl bg-purple-600 text-white text-sm font-semibold disabled:opacity-40 active:scale-95 transition-transform">
              {saving ? 'Creating…' : existing ? 'Date taken — answer above or pick another' : 'Create setlist'}
            </button>
          )}
          <p className="text-[11px] text-zinc-600">
            Repeating songs keep last time&rsquo;s flow, conductor notes and practice link. When the
            conductor&rsquo;s Excel is uploaded for this date it merges on: matched by title, links and
            notes survive, the chart&rsquo;s order takes over.
          </p>
        </div>
      </div>
    </div>
  )
}

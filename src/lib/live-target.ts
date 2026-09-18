import type { createClient } from '@/lib/supabase/server'

/**
 * Where does "share live" / "go live" land when there's no service today?
 *
 * An impromptu is pushed into a service's session_state, so it needs a
 * service. It used to be today-only — right on a Thursday or Saturday, but
 * it meant the feature was dead in practice, which is exactly when you try
 * things. Now: today's service if there is one, else the NEXT upcoming one
 * (practice is for the coming service), else the most recent past one.
 */
export interface LiveTarget {
  id: string
  service_date: string // YYYY-MM-DD
  day_of_week: string
  isToday: boolean
  /** "today" | "Sat 20 Sep" */
  label: string
}

export function dubaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
}

function shortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export async function findLiveTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<LiveTarget | null> {
  const today = dubaiToday()
  const cols = 'id, service_date, day_of_week'
  const [{ data: upcoming }, { data: past }] = await Promise.all([
    supabase.from('services').select(cols).gte('service_date', today).order('service_date', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('services').select(cols).lt('service_date', today).order('service_date', { ascending: false }).limit(1).maybeSingle(),
  ])
  const s = (upcoming ?? past) as { id: string; service_date: string; day_of_week: string } | null
  if (!s) return null
  const isToday = s.service_date === today
  return { ...s, isToday, label: isToday ? 'today' : shortDate(s.service_date) }
}

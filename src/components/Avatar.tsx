/** Initials avatar — the team's "profile picture". Shared by the admin panel
 *  and the worship-leader display so they always look the same. */

export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  const n = (name ?? '').trim()
  if (!n) return fallback
  return n.split(/\s+/).map(w => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || fallback
}

export default function Avatar({
  name,
  size = 36,
  className = '',
}: {
  name: string | null | undefined
  size?: number
  className?: string
}) {
  return (
    <div
      className={`rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="font-bold text-zinc-300" style={{ fontSize: Math.max(10, Math.round(size * 0.32)) }}>
        {initialsOf(name)}
      </span>
    </div>
  )
}

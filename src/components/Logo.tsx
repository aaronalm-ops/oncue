/**
 * OnCue ensō mark — one calligraphic ring, thick at the lower left tapering
 * to a hairline at the top right, with a single fading pulse ripple.
 * Vector twin of public/icon-*.png (the tapered ring is a purple disc with
 * an offset punch-out; `punch` must match the tile background behind it).
 */
export default function Logo({ className = 'w-5 h-5', punch = '#09090b' }: {
  className?: string
  punch?: string
}) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <defs>
        <linearGradient id="oncue-ripple" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9333EA" stopOpacity="0.75" />
          <stop offset="0.65" stopColor="#9333EA" stopOpacity="0.25" />
          <stop offset="1" stopColor="#9333EA" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="oncue-enso" x1="8" y1="26" x2="24" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7e22ce" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      {/* pulse ripple, fading along its sweep */}
      <circle cx="16" cy="16" r="14.8" stroke="url(#oncue-ripple)" strokeWidth="1.1" />
      {/* ensō: disc minus offset disc = tapered ring */}
      <circle cx="16" cy="16" r="10.2" fill="url(#oncue-enso)" />
      <circle cx="17.05" cy="14.95" r="8.6" fill={punch} />
    </svg>
  )
}

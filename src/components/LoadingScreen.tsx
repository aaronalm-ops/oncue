/**
 * Branded loading screen — the ensō ring spins (a tapered ring is a natural
 * spinner), two pulse ripples radiate outward on a stagger, and the wordmark
 * settles in beneath. Pure CSS (keyframes in globals.css), zero JS cost.
 * Used by every route's loading.tsx so slow moments feel like the brand,
 * not a stall. Honors prefers-reduced-motion (static logo).
 */
export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6">
      <svg viewBox="0 0 32 32" className="w-20 h-20" fill="none" aria-hidden>
        <defs>
          <linearGradient id="oncue-load-enso" x1="8" y1="26" x2="24" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7e22ce" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        {/* staggered pulse ripples */}
        <circle className="oncue-load-ripple" cx="16" cy="16" r="13.5"
          stroke="#9333EA" strokeWidth="0.9" />
        <circle className="oncue-load-ripple oncue-load-ripple-2" cx="16" cy="16" r="13.5"
          stroke="#9333EA" strokeWidth="0.9" />
        {/* the ensō, spinning */}
        <g className="oncue-load-spin">
          <circle cx="16" cy="16" r="10.2" fill="url(#oncue-load-enso)" />
          <circle cx="17.05" cy="14.95" r="8.6" fill="#000000" />
        </g>
      </svg>
      <p className="oncue-load-word text-white font-bold text-lg select-none">
        OnCue
      </p>
    </div>
  )
}

/**
 * Glev brand lockup — symbol + "glev" wordmark with the mint period dot.
 * Mirrors the LOCKUP_SVG defined in app/brand/page.tsx; both must stay in sync.
 */
export default function Lockup({ width = 240 }: { width?: number }) {
  return (
    <svg
      width={width}
      viewBox="0 0 200 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Glev"
    >
      <g transform="translate(0,10) scale(2)">
        <rect width="32" height="32" rx="9" fill="#0F0F14" />
        <line x1="16" y1="7"  x2="25" y2="12" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="25" y1="12" x2="25" y2="20" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="25" y1="20" x2="18" y2="26" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="18" y1="26" x2="9"  y2="22" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="9"  y1="22" x2="7"  y2="14" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="7"  y1="14" x2="16" y2="7"  stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="16" y1="7"  x2="16" y2="16" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="25" y1="12" x2="16" y2="16" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="25" y1="20" x2="16" y2="16" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <line x1="18" y1="26" x2="16" y2="16" stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55" />
        <circle cx="16" cy="7"  r="2" fill="#4F6EF740" stroke="#4F6EF7" strokeWidth="0.8" />
        <circle cx="25" cy="12" r="2" fill="#4F6EF740" stroke="#4F6EF7" strokeWidth="0.8" />
        <circle cx="25" cy="20" r="2" fill="#4F6EF740" stroke="#4F6EF7" strokeWidth="0.8" />
        <circle cx="18" cy="26" r="2" fill="#4F6EF740" stroke="#4F6EF7" strokeWidth="0.8" />
        <circle cx="9"  cy="22" r="2" fill="#4F6EF740" stroke="#4F6EF7" strokeWidth="0.8" />
        <circle cx="7"  cy="14" r="2" fill="#4F6EF740" stroke="#4F6EF7" strokeWidth="0.8" />
        <circle cx="16" cy="16" r="3.5" fill="#4F6EF7" />
      </g>
      <text
        x="80" y="58"
        fontFamily="var(--font-inter), Inter, system-ui, -apple-system, sans-serif"
        fontWeight="700" fontSize="44" letterSpacing="-1.32" fill="#FFFFFF"
      >
        glev
      </text>
      {/* Mint period dot — must sit on the baseline (y=58) like a real ".",
          NOT mid-height of the "v". With r=4 we want the dot's bottom to
          touch the baseline, so cy = 58 - 2 = 56 (center 2px above
          baseline, bottom 2px below — reads exactly as a sentence period).
          The previous cy=50 floated the dot 8px above the baseline,
          giving the wrong "dot stuck to the v" look. */}
      <circle cx="164" cy="56" r="4" fill="#22D3A0" />
    </svg>
  );
}

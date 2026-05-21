/**
 * RefreshingBar — a slim accent-colored animated bar shown at the top
 * of a page when stale cached data is being updated in the background.
 * Non-blocking: it never displaces content, just slides in below the
 * page heading and disappears once fresh data lands.
 *
 * Usage: <RefreshingBar visible={isRefreshing} />
 */
export default function RefreshingBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <>
      <style>{`
        @keyframes glevRefreshSlide {
          0%   { transform: translateX(-100%); }
          60%  { transform: translateX(0%); }
          100% { transform: translateX(0%); }
        }
        @keyframes glevRefreshFade {
          0%   { opacity: 0; }
          10%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
      <div
        role="status"
        aria-label="Refreshing…"
        aria-live="polite"
        style={{
          position: "relative",
          height: 3,
          borderRadius: 99,
          overflow: "hidden",
          marginBottom: 12,
          background: "var(--border-soft, rgba(79,110,247,0.12))",
          animation: "glevRefreshFade 2.4s ease-in-out infinite",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg, #4F6EF7 0%, #7B93FF 50%, #4F6EF7 100%)",
            backgroundSize: "200% 100%",
            animation: "glevRefreshSlide 1.6s cubic-bezier(0.4,0,0.2,1) infinite",
          }}
        />
      </div>
    </>
  );
}

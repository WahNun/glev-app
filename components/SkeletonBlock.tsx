/**
 * Skeleton loading block — pulsing rectangle in the same surface/border
 * style as Glev cards. Used by the (protected) tab pages
 * (Dashboard, Insights, Engine) as a shape-preserving loading state so
 * the user sees the page layout immediately instead of staring at a
 * centered spinner on an empty screen.
 *
 * The `glevPulse` keyframe is defined inline by each consumer (so a
 * single skeleton can be dropped in without a global stylesheet
 * dependency), so this component only renders the rectangle itself.
 */
export default function SkeletonBlock({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      style={{
        height,
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px solid var(--border-soft)",
        animation: "glevPulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

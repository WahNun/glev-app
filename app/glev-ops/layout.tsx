import { isAdminAuthed } from "@/lib/adminAuth";
import AdminNav from "./_components/AdminNav";

export const runtime = "nodejs";

/**
 * Shared chrome for every /admin/* page (Task #171).
 *
 * Renders a top navigation bar above the page content whenever the
 * operator is authenticated, so support staff can hop between buyers,
 * drip pipeline, drip stats and mail preview without typing URLs by
 * hand.
 *
 * Auth check lives here too so that unauthenticated visitors keep
 * seeing only the bare login form (no nav shell, no logout button —
 * those would expose internal section names to anyone hitting /admin
 * without the secret).
 *
 * The cookie is scoped to "/glev-ops" (see app/admin/_actions.ts and the
 * per-page actions), so reading auth state in this layout works for
 * every nested route.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAdminAuthed();

  // Defensive scroll container: every /admin/* page lives inside its
  // own `overflow-y: auto` viewport-tall wrapper so admin scrolling
  // works even if some other route (e.g. /engine) left a stale
  // `overflow: hidden` on html/body, or a browser extension / iOS
  // WebView quirk has locked the document scroll. Without this, the
  // user-detail page (which renders far past 100vh) appears clipped
  // and the mouse wheel does nothing — exactly the bug reported on
  // 2026-05-18. Using 100dvh (dynamic viewport height) keeps the
  // scroll area correct on iOS Safari as the URL bar collapses.
  return (
    <div
      style={{
        height: "100dvh",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        background: "#fafafa",
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      {authed ? <AdminNav /> : null}
      {children}
    </div>
  );
}

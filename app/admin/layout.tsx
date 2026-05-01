import { isAdminAuthed } from "./buyers/actions";
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
 * The cookie is scoped to "/admin" (see app/admin/_actions.ts and the
 * per-page actions), so reading auth state in this layout works for
 * every nested route.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAdminAuthed();

  return (
    <>
      {authed ? <AdminNav /> : null}
      {children}
    </>
  );
}

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionRole } from "@/lib/adminAuth";
import { PATHNAME_HEADER } from "@/lib/appRoutes";
import AdminNav from "./_components/AdminNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shared chrome for every /glev-ops/* page.
 *
 * Renders a top navigation bar above the page content whenever the
 * operator is authenticated, so support staff can hop between buyers,
 * drip pipeline, drip stats and mail preview without typing URLs by hand.
 *
 * Auth roles:
 *   - "admin"    → full access to all /glev-ops/* routes
 *   - "marketer" → read-only access, restricted to /glev-ops/crm only;
 *                  any other /glev-ops/* route redirects to /glev-ops/crm
 *
 * The cookie is scoped to "/" so reading auth state in this layout works
 * for every nested route.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getSessionRole();

  if (role === "marketer") {
    const headerStore = await headers();
    const pathname = headerStore.get(PATHNAME_HEADER) ?? "";
    if (!pathname.startsWith("/glev-ops/crm")) {
      redirect("/glev-ops/crm");
    }
  }

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
      {role !== null ? <AdminNav role={role} /> : null}
      {children}
    </div>
  );
}

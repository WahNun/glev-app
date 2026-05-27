import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "../buyers/actions";
import type { BetaRow, ProRow } from "../buyers/BuyersTables";
import FaelleClient from "./FaelleClient";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin/faelle — Zeigt alle Einträge, die in der Käufer-Übersicht
 * als „Zu bearbeiten" markiert wurden.
 *
 * Die Filterung passiert client-seitig in FaelleClient (localStorage),
 * aber die Daten kommen vom Server. Gleiche Queries wie /admin/buyers.
 */

const PAGE_LIMIT = 200;

export default async function FaellePage() {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/admin/buyers");

  const sb = getSupabaseAdmin();

  const [betaRes, proRes] = await Promise.all([
    sb
      .from("beta_reservations")
      .select(
        "id, email, full_name, status, amount_cents, currency, stripe_session_id, stripe_customer_id, created_at, fulfilled_at",
      )
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT),
    sb
      .from("pro_subscriptions")
      .select(
        "id, email, full_name, status, trial_ends_at, current_period_end, stripe_session_id, stripe_customer_id, stripe_subscription_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT),
  ]);

  const beta = (betaRes.data ?? []) as BetaRow[];
  const pro = (proRes.data ?? []) as ProRow[];

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Offene Fälle</h1>
      <p style={{ fontSize: 13, color: "#666", margin: "0 0 24px" }}>
        Einträge die du in der{" "}
        <a href="/admin/buyers" style={{ color: "#3b4cdc" }}>Käufer-Übersicht</a>{" "}
        als „Zu bearbeiten" markiert hast.
        Status-Änderungen hier werden sofort in der Käufer-Übersicht sichtbar.
      </p>
      <FaelleClient beta={beta} pro={pro} />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1200,
  margin: "0 auto",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};

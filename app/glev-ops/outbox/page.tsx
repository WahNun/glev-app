import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed, loginAction } from "./actions";
import OutboxDashboard from "./OutboxDashboard";
import AdminLoginForm from "../_components/AdminLoginForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-Dashboard für die Email-Outbox (Task #129).
 *
 * Zeigt pending / sending / dead / sent-Zeilen der `email_outbox`-Tabelle
 * auf einen Blick. Tote Zeilen (status='dead') lassen sich per Klick
 * auf "Erneut senden" auf `pending` zurücksetzen (attempts=0), damit der
 * Cron-Worker sie beim nächsten Lauf wieder aufgreift.
 *
 * Auth: identisches Bearer-Token-Cookie-Pattern wie /admin/buyers und
 * /admin/drip — der `glev_admin_token`-Cookie ist auf path="/glev-ops"
 * gescopet, ein einmaliges Login gilt für alle Admin-Seiten.
 *
 * Fetch-Strategie:
 *   - Counter-Karten: 4 parallele HEAD-Count-Queries (kein Row-Payload).
 *   - Tabelle: die letzten LIST_LIMIT (300) Zeilen nach created_at desc.
 *     Bei aktivem Status-Filter: SEARCH_LIMIT (500) Zeilen über die
 *     gesamte Tabelle, damit kein Dead-Mail-Backlog aus dem Fenster fällt.
 */

const LIST_LIMIT = 300;
const SEARCH_LIMIT = 500;

export type OutboxStatus = "pending" | "sending" | "sent" | "dead";
export type OutboxStatusFilter = "all" | OutboxStatus;

const STATUS_VALUES: OutboxStatusFilter[] = ["all", "pending", "sending", "dead", "sent"];

export interface OutboxRow {
  id: string;
  recipient: string;
  template: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  message_id: string | null;
  created_at: string;
}

export interface OutboxCounts {
  pending: number;
  sending: number;
  dead: number;
  sentTotal: number;
  sentLast7Days: number;
}

interface OutboxPageData {
  counts: OutboxCounts;
  rows: OutboxRow[];
  truncated: boolean;
  fetchErrors: string[];
}

function parseStatusFilter(v: unknown): OutboxStatusFilter {
  return typeof v === "string" && (STATUS_VALUES as string[]).includes(v)
    ? (v as OutboxStatusFilter)
    : "all";
}

async function loadOutboxData(statusFilter: OutboxStatusFilter): Promise<OutboxPageData> {
  const sb = getSupabaseAdmin();

  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const pendingCountP = sb
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const sendingCountP = sb
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "sending");

  const deadCountP = sb
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "dead");

  const sentTotalP = sb
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent");

  const sentLast7P = sb
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", sevenDaysAgoIso);

  const limit = statusFilter !== "all" ? SEARCH_LIMIT : LIST_LIMIT;

  let listQ = sb
    .from("email_outbox")
    .select(
      "id, recipient, template, status, attempts, last_error, last_attempt_at, next_attempt_at, sent_at, message_id, created_at",
    );

  if (statusFilter !== "all") {
    listQ = listQ.eq("status", statusFilter);
  }

  const listP = listQ.order("created_at", { ascending: false }).limit(limit);

  const [pendingR, sendingR, deadR, sentTotalR, sentLast7R, listR] = await Promise.all([
    pendingCountP,
    sendingCountP,
    deadCountP,
    sentTotalP,
    sentLast7P,
    listP,
  ]);

  const errs: string[] = [];
  const pushErr = (label: string, err: { message: string } | null) => {
    if (err) errs.push(`${label}: ${err.message}`);
  };
  pushErr("Pending-Count", pendingR.error);
  pushErr("Sending-Count", sendingR.error);
  pushErr("Dead-Count", deadR.error);
  pushErr("Sent-Total-Count", sentTotalR.error);
  pushErr("Sent-7d-Count", sentLast7R.error);
  pushErr("Liste", listR.error);

  return {
    counts: {
      pending: pendingR.count ?? 0,
      sending: sendingR.count ?? 0,
      dead: deadR.count ?? 0,
      sentTotal: sentTotalR.count ?? 0,
      sentLast7Days: sentLast7R.count ?? 0,
    },
    rows: (listR.data ?? []) as OutboxRow[],
    truncated: (listR.data?.length ?? 0) >= limit,
    fetchErrors: errs,
  };
}

export default async function AdminOutboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const authed = await isAdminAuthed();

  const err = typeof params.err === "string" ? params.err : undefined;
  const statusFilter = parseStatusFilter(params.status);

  if (!authed) {
    const loginErr = err === "bad" ? "Login fehlgeschlagen." : null;
    return <AdminLoginForm action={loginAction} title="Mail-Outbox" error={loginErr} />;
  }

  const data = await loadOutboxData(statusFilter);

  return (
    <OutboxDashboard
      counts={data.counts}
      rows={data.rows}
      truncated={data.truncated}
      fetchErrors={data.fetchErrors}
      statusFilter={statusFilter}
    />
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#fafafa",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const loginCardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 32,
  width: 320,
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  fontSize: 14,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const submitBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

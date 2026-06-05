import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";
import { computeEffectivePlan, planColor, planLabel } from "@/lib/admin/effectivePlan";
import { loadAuditLogForUser } from "@/lib/admin/audit";
import UserActions from "./UserActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const giftOk  = Array.isArray(sp.gift_ok)  ? sp.gift_ok[0]  : sp.gift_ok;
  const planOk  = Array.isArray(sp.plan_ok)  ? sp.plan_ok[0]  : sp.plan_ok;
  const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
  const msgParam = Array.isArray(sp.msg) ? sp.msg[0] : sp.msg;
  const authed = await isAdminAuthed();
  if (!authed) {
    return (
      <main style={pageStyle}>
        <p>Nicht eingeloggt — bitte über <Link href="/glev-ops/users">/admin/users</Link>.</p>
      </main>
    );
  }

  const sb = getSupabaseAdmin();

  const { data: authData, error: authErr } = await sb.auth.admin.getUserById(id);
  const authUser = authData?.user;
  if (authErr || !authUser) {
    notFound();
  }
  const email = (authUser.email ?? "").toLowerCase();

  const [profileRes, cgmRes, proRes, betaRes, mealCountRes, insulinCountRes, settingsRes, setupReqRes] =
    await Promise.all([
      sb.from("profiles").select("*").eq("user_id", id).maybeSingle(),
      sb.from("cgm_credentials").select("*").eq("user_id", id).maybeSingle(),
      email
        ? sb.from("pro_subscriptions").select("*").eq("email", email).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      email
        ? sb.from("beta_reservations").select("*").eq("email", email).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      sb.from("meals").select("id", { count: "exact", head: true }).eq("user_id", id),
      sb.from("insulin_logs").select("id", { count: "exact", head: true }).eq("user_id", id),
      sb.from("user_settings").select("feature_flags").eq("user_id", id).maybeSingle(),
      sb.from("cgm_setup_requests").select("sensor_brand, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

  const featureFlags = (settingsRes.data?.feature_flags ?? {}) as Record<string, unknown>;
  const aiVoiceEnabled = featureFlags.ai_voice === true;

  const profile = (profileRes.data ?? null) as Record<string, unknown> | null;
  const cgm = (cgmRes.data ?? null) as
    | { llu_email?: string; llu_region?: string; updated_at?: string }
    | null;
  const pro = (proRes.data ?? null) as
    | {
        status?: string;
        trial_ends_at?: string;
        current_period_end?: string;
        stripe_customer_id?: string;
        stripe_subscription_id?: string;
        stripe_price_id?: string;
        created_at?: string;
      }
    | null;
  const beta = (betaRes.data ?? null) as
    | {
        status?: string;
        amount_cents?: number;
        currency?: string;
        stripe_session_id?: string;
        created_at?: string;
        fulfilled_at?: string;
      }
    | null;

  const setupReq = (setupReqRes.data ?? null) as
    | { sensor_brand?: string; created_at?: string }
    | null;

  const effective = computeEffectivePlan({
    manual_plan_override: profile?.manual_plan_override as string | null | undefined,
    manual_plan_expires_at: profile?.manual_plan_expires_at as string | null | undefined,
    plan: profile?.plan as string | null | undefined,
    subscription_status: profile?.subscription_status as string | null | undefined,
  });
  const c = planColor(effective);

  const audit = await loadAuditLogForUser(id, 30);

  return (
    <main style={pageStyle}>
      <p style={{ margin: "0 0 8px" }}>
        <Link href="/glev-ops/users" style={{ color: "#3b4cdc" }}>
          ← Zurück zur Liste
        </Link>
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>
          {(profile?.display_name as string | null) ?? authUser.email ?? "(ohne Name)"}
        </h1>
        <span
          style={{
            background: c.bg,
            color: c.fg,
            padding: "3px 10px",
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {planLabel(effective)}
        </span>
        {profile?.deleted_at ? (
          <span style={badgeWarn}>Gelöscht (soft) am {fmtDateTime(profile.deleted_at as string)}</span>
        ) : null}
        {(authUser as { banned_until?: string | null }).banned_until ? (
          <span style={badgeWarn}>
            Gebannt bis {fmtDateTime((authUser as { banned_until?: string }).banned_until!)}
          </span>
        ) : null}
        {profile?.created_by_admin ? <span style={badgeInfo}>Admin-angelegt</span> : null}
        {profile?.gift_label ? (
          <span
            style={{
              background: "#fef9c3",
              color: "#92400e",
              border: "1px solid #fde68a",
              padding: "3px 10px",
              borderRadius: 999,
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            🎁 {profile.gift_label as string}
          </span>
        ) : null}
        {setupReq?.created_at ? (
          <span
            style={{
              background: "#ede9fe",
              color: "#5b21b6",
              border: "1px solid #c4b5fd",
              padding: "3px 10px",
              borderRadius: 999,
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            🔧 Setup-Anfrage am {fmtDate(setupReq.created_at)}{setupReq.sensor_brand ? ` — ${setupReq.sensor_brand}` : ""}
          </span>
        ) : null}
      </div>

      <p style={{ color: "#666", fontSize: 14, margin: "0 0 24px" }}>
        E-Mail: <code>{authUser.email ?? "—"}</code> · ID: <code>{id}</code>
      </p>

      {errParam === "migration" ? (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: "12px 14px", borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
          <strong>⚠️ Migration fehlt in Supabase.</strong> Die Spalte <code>gift_label</code> existiert noch nicht in der Datenbank.
          Bitte im <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" style={{ color: "#991b1b" }}>Supabase Dashboard → SQL Editor</a> ausführen:
          <pre style={{ margin: "8px 0 0", background: "#fee2e2", padding: "8px 10px", borderRadius: 6, fontSize: 12, overflowX: "auto" }}>
            {`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gift_label text;`}
          </pre>
        </div>
      ) : null}
      {errParam && errParam !== "migration" ? (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", padding: "12px 14px", borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
          <strong>⚠️ Fehler:</strong>{" "}
          {msgParam ? decodeURIComponent(msgParam) : errParam}
        </div>
      ) : null}
      {giftOk ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", padding: "10px 14px", borderRadius: 8, fontSize: 14, marginBottom: 20 }}>
          ✓ Gift-Label gesetzt: <strong>🎁 {decodeURIComponent(giftOk)}</strong>
        </div>
      ) : null}
      {planOk ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", padding: "10px 14px", borderRadius: 8, fontSize: 14, marginBottom: 20 }}>
          ✓ Plan gesetzt{planOk !== "1" ? `: ${decodeURIComponent(planOk)}` : ""} — Gift-Label wurde automatisch ergänzt.
        </div>
      ) : null}

      {/* Block 1 — Stammdaten */}
      <Section title="Stammdaten">
        <Grid>
          <KV label="E-Mail bestätigt" v={authUser.email_confirmed_at ? `ja (${fmtDateTime(authUser.email_confirmed_at)})` : "nein"} />
          <KV label="Account angelegt" v={fmtDateTime(authUser.created_at)} />
          <KV label="Letzter Login" v={authUser.last_sign_in_at ? fmtDateTime(authUser.last_sign_in_at) : "nie"} />
          <KV label="Sprache" v={(profile?.language as string) ?? "—"} />
          <KV label="Carb-Einheit" v={(profile?.carb_unit as string) ?? "—"} />
          <KV label="Onboarding fertig" v={profile?.onboarding_completed_at ? fmtDateTime(profile.onboarding_completed_at as string) : "nein"} />
          <KV label="Rolle" v={(profile?.role as string) ?? "user"} />
        </Grid>
      </Section>

      {/* Block 2 — Abo & Zahlung */}
      <Section title="Abo & Zahlung">
        <Grid>
          <KV label="Effektiver Plan" v={planLabel(effective)} />
          <KV
            label="Manuelles Override"
            v={
              profile?.manual_plan_override
                ? `${profile.manual_plan_override}${
                    profile?.manual_plan_note ? ` — „${profile.manual_plan_note}"` : ""
                  }${
                    profile?.manual_plan_set_at
                      ? ` · gesetzt am ${fmtDateTime(profile.manual_plan_set_at as string)}`
                      : ""
                  }`
                : "—"
            }
          />
          <KV
            label="Override läuft ab"
            v={
              profile?.manual_plan_expires_at
                ? (() => {
                    const exp = profile.manual_plan_expires_at as string;
                    const expired = Date.parse(exp) < Date.now();
                    return `${fmtDateTime(exp)}${expired ? " · ABGELAUFEN" : ""}`;
                  })()
                : profile?.manual_plan_override
                  ? "kein Ablauf (lifetime)"
                  : "—"
            }
          />
          <KV label="profiles.plan (Stripe)" v={(profile?.plan as string) ?? "—"} />
          <KV label="profiles.subscription_status" v={(profile?.subscription_status as string) ?? "—"} />
          <KV label="Pro-Status (Stripe)" v={pro?.status ?? "—"} />
          <KV label="Trial endet" v={pro?.trial_ends_at ? fmtDateTime(pro.trial_ends_at) : "—"} />
          <KV label="Period endet" v={pro?.current_period_end ? fmtDateTime(pro.current_period_end) : "—"} />
          <KV
            label="Stripe-Customer"
            v={
              pro?.stripe_customer_id ? (
                <a
                  href={`https://dashboard.stripe.com/customers/${pro.stripe_customer_id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#3b4cdc" }}
                >
                  {pro.stripe_customer_id}
                </a>
              ) : (
                "—"
              )
            }
          />
          <KV label="Beta-Reservation" v={beta ? `${beta.status ?? "—"} · ${fmtMoney(beta.amount_cents, beta.currency)}` : "—"} />
        </Grid>
      </Section>

      {/* Block 3 — Daten & Verbindungen */}
      <Section title="Daten & Verbindungen">
        <Grid>
          <KV label="Mahlzeiten" v={String(mealCountRes.count ?? 0)} />
          <KV label="Insulin-Logs" v={String(insulinCountRes.count ?? 0)} />
          <KV
            label="LibreLinkUp"
            v={cgm?.llu_email ? `${cgm.llu_email} (${cgm.llu_region ?? "?"})` : "—"}
          />
          <KV label="Nightscout-URL" v={(profile?.nightscout_url as string) ?? "—"} />
          <KV label="CGM-Quelle (Settings)" v={(profile?.cgm_source as string) ?? "—"} />
          <KV label="cgm_connected" v={profile?.cgm_connected ? "ja" : "nein"} />
        </Grid>
      </Section>

      <UserActions
        userId={id}
        email={authUser.email ?? ""}
        currentRole={(profile?.role as string) ?? "user"}
        currentManualPlan={(profile?.manual_plan_override as string | null) ?? null}
        currentManualPlanNote={(profile?.manual_plan_note as string | null) ?? null}
        currentGiftLabel={(profile?.gift_label as string | null) ?? null}
        currentLanguage={(profile?.language as string | null) ?? null}
        emailConfirmed={!!authUser.email_confirmed_at}
        cgmConnected={!!cgm || !!profile?.cgm_connected || !!profile?.nightscout_url}
        deleted={!!profile?.deleted_at}
        hasActiveStripeSub={
          !!pro?.stripe_subscription_id && (pro?.status ?? "") !== "cancelled"
        }
        phone={
          (authUser.phone ?? "") ||
          ((authUser.user_metadata?.phone as string | undefined) ?? "")
            ? (authUser.phone ?? "") || ((authUser.user_metadata?.phone as string | undefined) ?? "")
            : null
        }
        smsOptedOut={!!(profile?.sms_opted_out)}
        aiVoiceEnabled={aiVoiceEnabled}
        aiConsentAt={(profile?.ai_consent_at as string | null) ?? null}
      />

      {/* Audit */}
      <Section title={`Audit-Log (${audit.length})`}>
        {audit.length === 0 ? (
          <p style={{ color: "#999", margin: 0 }}>Noch keine Admin-Aktionen für diesen User.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8f8f8", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Wann</th>
                <th style={{ padding: "8px 12px" }}>Aktion</th>
                <th style={{ padding: "8px 12px" }}>Notiz</th>
                <th style={{ padding: "8px 12px" }}>Operator</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
                    {fmtDateTime(a.created_at)}
                  </td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace" }}>{a.action}</td>
                  <td style={{ padding: "6px 12px" }}>{a.note ?? "—"}</td>
                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#666" }}>
                    {a.admin_token_hash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginBottom: 24,
        border: "1px solid #eee",
        borderRadius: 10,
        padding: 16,
        background: "#fff",
      }}
    >
      <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "#111" }}>{title}</h2>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}
function KV({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: "#111", marginTop: 2, wordBreak: "break-word" }}>{v}</div>
    </div>
  );
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
function fmtMoney(cents: number | null | undefined, ccy: string | null | undefined): string {
  if (cents == null) return "—";
  const c = (ccy ?? "eur").toUpperCase();
  return `${(cents / 100).toFixed(2)} ${c}`;
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1100,
  margin: "0 auto",
  color: "#111",
  background: "#fafafa",
  minHeight: "100vh",
};
const badgeWarn: React.CSSProperties = {
  background: "#fef3c7",
  color: "#92400e",
  fontSize: 12,
  padding: "3px 8px",
  borderRadius: 4,
  fontWeight: 600,
};
const badgeInfo: React.CSSProperties = {
  background: "#dbeafe",
  color: "#1e40af",
  fontSize: 12,
  padding: "3px 8px",
  borderRadius: 4,
  fontWeight: 600,
};

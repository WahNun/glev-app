"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER = "var(--border)";

interface StatusResponse {
  connected: boolean;
  email: string | null;
  region: string | null;
  tokenExpiresAt: string | null;
  lastConnectedAt: string | null;
  sessionHealth: "active" | "expiring_soon" | "expired" | "never_tested";
  lastReading: { value: number; trend: string; timestamp: string } | null;
}

interface LatestResponse {
  current: { value: number | null; unit: string; timestamp: string | null; trend: string } | null;
}

// /api/cgm/glucose returns Junction state: connected = profile.junction_user_id
// is set; glucose is the last reading in mg/dL (already converted from mmol/L
// by the route). Failures return { connected: false } silently.
interface JunctionStateResponse {
  connected: boolean;
  glucose: number | null;
  timestamp: string | null;
  trend?: string | null;
}

const card: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: "20px 24px",
};
const inp: React.CSSProperties = {
  background: "var(--input-bg)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: "10px 14px",
  color:"var(--text)",
  fontSize: 16,
  outline: "none",
  width: "100%",
};
const label: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-dim)",
  display: "block",
  marginBottom: 6,
};

export default function CgmSettingsCard() {
  const t = useTranslations("cgmSettings");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState("");

  const [showForm, setShowForm] = useState(false);

  const [cgmType, setCgmType] = useState("librelinkup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState<"EU" | "US">("EU");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  // Per-field inline validation errors. Set by onBlur (don't pester the user
  // while they're still typing) and cleared the moment they edit the field
  // again. Keep formError reserved for true server failures so submit-time
  // errors don't shadow validation hints and vice-versa.
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [disconnecting, setDisconnecting] = useState(false);

  // Junction (LibreView via Vital→Junction Link) is independent of LibreLinkUp.
  // Both providers can be connected simultaneously and the engine page reads
  // from each independently (LLU via /api/cgm/latest, Junction via
  // /api/cgm/glucose). The dropdown lets the user pick which to set up.
  const [junctionState, setJunctionState] = useState<JunctionStateResponse | null>(null);
  const [junctionConnecting, setJunctionConnecting] = useState(false);
  const [junctionMessage, setJunctionMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Nightscout (open-source CGM platform) — third source. URL+token stored on
  // profiles.nightscout_url / nightscout_token_enc. The token is optional —
  // many self-hosted instances run unauthenticated. `nightscoutHasToken` lets
  // us show "(gespeichert)" without ever exposing the plaintext token.
  const [nightscoutUrl, setNightscoutUrl] = useState("");
  const [nightscoutToken, setNightscoutToken] = useState("");
  const [nightscoutHasToken, setNightscoutHasToken] = useState(false);
  const [nightscoutConnected, setNightscoutConnected] = useState(false);
  const [nightscoutLatest, setNightscoutLatest] = useState<number | null>(null);
  const [nightscoutSubmitting, setNightscoutSubmitting] = useState(false);
  const [nightscoutMessage, setNightscoutMessage] =
    useState<{ kind: "success" | "error"; text: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError("");
    try {
      const res = await fetch("/api/cgm/status", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || t("errors.http", { status: res.status }));
      }
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      setShowForm(!data.connected);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : t("errors.unknown"));
      // Show the form even when the status API errors so the user can still
      // enter / correct credentials — without this they are completely locked
      // out whenever the endpoint returns 5xx (safety-critical: no CGM access).
      setShowForm(true);
    } finally {
      setLoadingStatus(false);
    }
  }, [t]);

  // Junction state fetcher — silent on error (the route itself returns
  // { connected: false } for any failure, so 5xx here is genuine network/auth
  // trouble; we treat as disconnected and let the user retry via the form).
  const loadJunctionState = useCallback(async () => {
    try {
      const res = await fetch("/api/cgm/glucose", { cache: "no-store" });
      if (!res.ok) {
        setJunctionState({ connected: false, glucose: null, timestamp: null });
        return;
      }
      const data = (await res.json()) as JunctionStateResponse;
      setJunctionState(data);
    } catch {
      setJunctionState({ connected: false, glucose: null, timestamp: null });
    }
  }, []);

  // Nightscout state fetcher — same silent-on-error policy as Junction. The
  // GET on the sync route returns { connected, url, hasToken } so the form
  // can pre-fill the URL field without ever exposing the plaintext token.
  const loadNightscoutState = useCallback(async () => {
    try {
      const res = await fetch("/api/cgm/nightscout/sync", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        connected?: boolean;
        url?: string | null;
        hasToken?: boolean;
      };
      if (data?.connected) {
        setNightscoutConnected(true);
        setNightscoutUrl(data.url || "");
        setNightscoutHasToken(!!data.hasToken);
      }
    } catch {
      // silent — treat as disconnected
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadJunctionState();
    void loadNightscoutState();
  }, [loadStatus, loadJunctionState, loadNightscoutState]);

  // Junction OAuth callback handler — when user returns from Junction's hosted
  // Link flow, the redirect lands at /settings?cgm=connected. Refresh state,
  // show success, then clean the URL so a refresh doesn't re-trigger the toast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("cgm");
    if (flag === "connected") {
      setCgmType("libreview-junction");
      setShowForm(true);
      setJunctionMessage({ kind: "success", text: t("junction.callback_success") });
      void loadJunctionState();
      const url = new URL(window.location.href);
      url.searchParams.delete("cgm");
      window.history.replaceState({}, "", url.toString());
    } else if (flag === "error") {
      const detail = params.get("detail") || t("errors.unknown");
      setCgmType("libreview-junction");
      setShowForm(true);
      setJunctionMessage({ kind: "error", text: t("junction.callback_error", { detail }) });
      const url = new URL(window.location.href);
      url.searchParams.delete("cgm");
      url.searchParams.delete("detail");
      window.history.replaceState({}, "", url.toString());
    }
  }, [loadJunctionState, t]);

  function validateEmail(s: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }
  // LibreLinkUp accepts arbitrary passwords (no published min length); we
  // mirror the backend's `password.length < 1` check so we surface the same
  // failure inline before the round-trip rather than after.
  function validatePassword(s: string) {
    return s.length >= 1;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");
    if (cgmType !== "librelinkup") {
      setFormError(t("form.type_unavailable"));
      return;
    }
    // Inline-first validation: route field errors back to the per-field
    // slots so the user sees them right under the offending input, not as a
    // disconnected banner at the bottom of the form. formError stays
    // reserved for true server failures.
    let invalid = false;
    if (!validateEmail(email)) {
      setEmailError(t("form.email_invalid"));
      invalid = true;
    }
    if (!validatePassword(password)) {
      setPasswordError(t("form.password_empty"));
      invalid = true;
    }
    if (invalid) return;
    if (region !== "EU" && region !== "US") {
      setFormError(t("form.region_invalid"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/cgm/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, region: region.toLowerCase() }),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || t("errors.http", { status: res.status }));
      }
      setFormSuccess(t("form.connected_as", { email }));
      setPassword("");
      await loadStatus();
      setShowForm(false);
      setTimeout(() => setFormSuccess(""), 4000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("form.save_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/cgm/latest", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || t("errors.http", { status: res.status }));
      const cur = (body as LatestResponse).current;
      if (!cur || cur.value == null) throw new Error(t("errors.test_no_values"));
      setTestResult({ ok: true, msg: `${cur.value} mg/dL · ${cur.trend}` });
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : t("errors.test_generic") });
    } finally {
      setTesting(false);
    }
  }

  // Junction connect — POSTs to /api/cgm/connect (which creates/recovers the
  // Junction user, requests a link_token, and returns { link_url }), then
  // redirects the browser to Junction's hosted Link flow. On return the
  // useEffect above handles ?cgm=connected. Errors include the upstream
  // detail (e.g. {"detail":"invalid token"}) so the user sees the actual cause.
  async function handleJunctionConnect() {
    setJunctionConnecting(true);
    setJunctionMessage(null);
    try {
      const res = await fetch("/api/cgm/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        link_url?: string;
        error?: string;
        detail?: unknown;
      };
      if (!res.ok || !body.link_url) {
        const detailText =
          typeof body.detail === "string"
            ? body.detail
            : body.detail
            ? JSON.stringify(body.detail)
            : "";
        const msg = body.error || t("errors.http", { status: res.status });
        throw new Error(detailText ? `${msg}: ${detailText}` : msg);
      }
      window.location.href = body.link_url;
    } catch (err) {
      setJunctionMessage({
        kind: "error",
        text: err instanceof Error ? err.message : t("errors.connection_failed"),
      });
      setJunctionConnecting(false);
    }
  }

  async function handleNightscoutConnect() {
    setNightscoutMessage(null);
    const url = nightscoutUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) {
      setNightscoutMessage({
        kind: "error",
        text: t("nightscout.url_invalid"),
      });
      return;
    }
    setNightscoutSubmitting(true);
    try {
      // Empty token field with an existing saved token = "preserve token" —
      // the server-side route honours this so users don't have to re-paste
      // the token every time they edit their URL.
      const tokenToSend =
        nightscoutToken.trim().length > 0 ? nightscoutToken.trim() : null;
      const res = await fetch("/api/cgm/nightscout/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, token: tokenToSend }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        connected?: boolean;
        current?: { value: number | null } | null;
        error?: string;
      };
      if (!res.ok) throw new Error(body?.error || t("errors.http", { status: res.status }));
      setNightscoutConnected(true);
      // Update hasToken flag: if user just sent a token OR they preserved
      // an existing one, we have a token now.
      setNightscoutHasToken(tokenToSend != null || nightscoutHasToken);
      setNightscoutToken("");
      const cur = body?.current ?? null;
      setNightscoutLatest(cur?.value ?? null);
      setNightscoutMessage({
        kind: "success",
        text:
          cur?.value != null
            ? t("nightscout.connected_value", { value: cur.value })
            : t("nightscout.connected_no_value"),
      });
    } catch (err) {
      setNightscoutMessage({
        kind: "error",
        text: err instanceof Error ? err.message : t("errors.connection_failed"),
      });
    } finally {
      setNightscoutSubmitting(false);
    }
  }

  async function handleNightscoutDisconnect() {
    if (!confirm(t("nightscout.disconnect_confirm"))) return;
    setNightscoutSubmitting(true);
    try {
      const res = await fetch("/api/cgm/nightscout/sync", {
        method: "DELETE",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body?.error || t("errors.http", { status: res.status }));
      setNightscoutConnected(false);
      setNightscoutHasToken(false);
      setNightscoutUrl("");
      setNightscoutToken("");
      setNightscoutLatest(null);
      setNightscoutMessage(null);
    } catch (err) {
      setNightscoutMessage({
        kind: "error",
        text: err instanceof Error ? err.message : t("errors.disconnect_failed"),
      });
    } finally {
      setNightscoutSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t("status.disconnect_confirm"))) return;
    setDisconnecting(true);
    setStatusError("");
    try {
      const res = await fetch("/api/cgm/credentials", {
        method: "DELETE",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || t("errors.http", { status: res.status }));
      }
      setTestResult(null);
      setEmail("");
      setPassword("");
      await loadStatus();
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : t("errors.disconnect_failed"));
    } finally {
      setDisconnecting(false);
    }
  }

  const connected = status?.connected === true;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* STATUS CARD */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
          {t("status.title")}
        </div>

        {loadingStatus ? (
          <div style={{ fontSize: 14, color: "var(--text-dim)" }}>
            {t("status.loading")}
          </div>
        ) : statusError ? (
          <div style={{ fontSize: 14, color: PINK }}>{t("status.error_prefix", { message: statusError })}</div>
        ) : connected ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 99,
                  background: GREEN,
                  boxShadow: `0 0 0 4px ${GREEN}22`,
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {t("status.connected_libre")}
              </div>
            </div>
            {/* Session-Health-Indicator */}
            {(() => {
              const h = status?.sessionHealth;
              if (!h || h === "never_tested") {
                return (
                  <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 14 }}>
                    {t("status.session_never_tested")}
                  </div>
                );
              }
              const cfg: Record<string, { color: string; label: string }> = {
                active:        { color: GREEN,    label: t("status.session_active") },
                expiring_soon: { color: "#FF9500", label: t("status.session_expiring_soon") },
                expired:       { color: PINK,     label: t("status.session_expired") },
              };
              const { color, label } = cfg[h] ?? cfg.expired;
              const expiresAt = status?.tokenExpiresAt ? new Date(status.tokenExpiresAt) : null;
              const diffMin = expiresAt ? Math.round((expiresAt.getTime() - Date.now()) / 60_000) : null;
              const suffix =
                h === "active" && diffMin !== null && diffMin > 0
                  ? t("status.session_in_min", { min: diffMin })
                  : h === "expiring_soon" && diffMin !== null && diffMin > 0
                  ? t("status.session_in_min", { min: diffMin })
                  : h === "expired" && diffMin !== null
                  ? t("status.session_ago_min", { min: Math.abs(diffMin) })
                  : "";
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color }}>{label}{suffix}</span>
                </div>
              );
            })()}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "var(--surface-soft)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 4 }}>{t("status.field_email")}</div>
                <div style={{ fontSize: 14, fontWeight: 600, wordBreak: "break-all" }}>{status?.email}</div>
              </div>
              <div style={{ background: "var(--surface-soft)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 4 }}>{t("status.field_region")}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{status?.region}</div>
              </div>
            </div>

            {testResult && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  marginBottom: 14,
                  fontSize: 14,
                  background: testResult.ok ? `${GREEN}10` : `${PINK}10`,
                  border: `1px solid ${testResult.ok ? GREEN : PINK}30`,
                  color: testResult.ok ? GREEN : PINK,
                }}
              >
                {testResult.ok ? t("status.last_value_prefix") : t("status.error_inline_prefix")}
                {testResult.msg}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                onClick={handleTest}
                disabled={testing}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${ACCENT}40`,
                  cursor: testing ? "wait" : "pointer",
                  background: `${ACCENT}15`,
                  color: ACCENT,
                  fontSize: 14,
                  fontWeight: 600,
                  opacity: testing ? 0.6 : 1,
                }}
              >
                {testing ? t("status.btn_testing") : t("status.btn_test")}
              </button>
              <button
                onClick={() => {
                  setShowForm((v) => !v);
                  setFormError("");
                  setFormSuccess("");
                }}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${BORDER}`,
                  cursor: "pointer",
                  background: "transparent",
                  color: "var(--text-body)",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {showForm ? t("status.btn_cancel") : t("status.btn_change_credentials")}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: `1px solid ${PINK}40`,
                  cursor: disconnecting ? "wait" : "pointer",
                  background: "transparent",
                  color: PINK,
                  fontSize: 14,
                  fontWeight: 500,
                  opacity: disconnecting ? 0.6 : 1,
                }}
              >
                {disconnecting ? t("status.btn_disconnecting") : t("status.btn_disconnect")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 99,
                  background: "var(--text-ghost)",
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t("status.not_connected")}</div>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
              {t("status.not_connected_hint")}
            </div>
          </div>
        )}
      </div>

      {/* HELP */}
      <div style={card}>
        <details style={{ cursor: "pointer" }}>
          <summary
            style={{
              fontSize: 14,
              fontWeight: 600,
              listStyle: "none",
              cursor: "pointer",
              color: "var(--text-strong)",
            }}
          >
            {t("help.summary")}
          </summary>
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.6,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <p style={{ margin: 0 }}>
              <strong style={{ color: "var(--text-strong)" }}>{t("help.p1_app")}</strong>{" "}
              {t("help.p1_text")}
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "var(--text-strong)" }}>{t("help.p2_label")}</strong>{" "}
              {t("help.p2_text")}
            </p>
            <p style={{ margin: 0 }}>
              {t("help.p3_intro")}{" "}
              <strong style={{ color: "var(--text-strong)" }}>
                {t("help.p3_strong")}
              </strong>{" "}
              {t("help.p3_outro")}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-dim)" }}>
              {t("help.security")}
            </p>
          </div>
        </details>
      </div>

      {/* FORM */}
      {showForm && (
        <form onSubmit={handleSubmit} style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
            {connected ? t("form.title_change") : t("form.title_enter")}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={label} htmlFor="cgm-type">{t("form.label_cgm_type")}</label>
              <select
                id="cgm-type"
                value={cgmType}
                onChange={(e) => setCgmType(e.target.value)}
                style={inp}
              >
                <option value="librelinkup">LibreLinkUp</option>
                <option value="libreview-junction">{t("form.option_junction_coming_soon")}</option>
                <option value="nightscout">Nightscout</option>
                <option value="dexcom" disabled>{t("form.option_dexcom_coming_soon")}</option>
              </select>
            </div>

            {cgmType === "librelinkup" && (
              <>
                <div>
                  <label style={label} htmlFor="cgm-email">{t("form.label_email")}</label>
                  <input
                    id="cgm-email"
                    style={{
                      ...inp,
                      border: emailError ? `1px solid ${PINK}` : inp.border,
                    }}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      // Clear inline error the moment the user edits — they
                      // are actively trying to fix it; harassing them with a
                      // red border on every keystroke just creates anxiety.
                      if (emailError) setEmailError("");
                    }}
                    onBlur={() => {
                      if (email.length > 0 && !validateEmail(email)) {
                        setEmailError(t("form.email_invalid"));
                      }
                    }}
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? "cgm-email-err" : undefined}
                    required
                    placeholder="follower@example.com"
                  />
                  {emailError && (
                    <div id="cgm-email-err" role="alert" style={{ fontSize: 13, color: PINK, marginTop: 4 }}>
                      {emailError}
                    </div>
                  )}
                </div>
                <div>
                  <label style={label} htmlFor="cgm-password">{t("form.label_password")}</label>
                  <input
                    id="cgm-password"
                    style={{
                      ...inp,
                      border: passwordError ? `1px solid ${PINK}` : inp.border,
                    }}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                    onBlur={() => {
                      if (!validatePassword(password)) {
                        setPasswordError(t("form.password_empty"));
                      }
                    }}
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? "cgm-password-err" : undefined}
                    required
                  />
                  {passwordError && (
                    <div id="cgm-password-err" role="alert" style={{ fontSize: 13, color: PINK, marginTop: 4 }}>
                      {passwordError}
                    </div>
                  )}
                </div>
                <div>
                  <label style={label} htmlFor="cgm-region">{t("form.label_region")}</label>
                  <select
                    id="cgm-region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value as "EU" | "US")}
                    style={inp}
                  >
                    <option value="EU">EU</option>
                    <option value="US">US</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 12,
                    border: "none",
                    cursor: submitting ? "wait" : "pointer",
                    background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                    color:"var(--text)",
                    fontSize: 14,
                    fontWeight: 700,
                    boxShadow: `0 4px 20px ${ACCENT}40`,
                    opacity: submitting ? 0.6 : 1,
                    marginTop: 4,
                  }}
                >
                  {submitting ? t("form.btn_saving") : t("form.btn_submit")}
                </button>
                {formError && (
                  <div style={{ fontSize: 14, color: PINK, marginTop: 4 }}>{formError}</div>
                )}
                {formSuccess && (
                  <div style={{ fontSize: 14, color: GREEN, marginTop: 4 }}>{formSuccess}</div>
                )}
              </>
            )}

            {cgmType === "libreview-junction" && (
              <>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    lineHeight: 1.6,
                    background: "var(--surface-soft)",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      alignSelf: "flex-start",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--text-strong)",
                      background: "var(--border)",
                      border: `1px solid ${BORDER}`,
                      borderRadius: 999,
                      padding: "3px 9px",
                    }}
                  >
                    {t("junction.badge_coming_soon")}
                  </span>
                  <span>
                    {t("junction.description")}
                  </span>
                </div>
                {junctionState?.connected && junctionState.glucose != null && (
                  <div
                    style={{
                      fontSize: 14,
                      color: GREEN,
                      background: `${GREEN}10`,
                      border: `1px solid ${GREEN}30`,
                      borderRadius: 10,
                      padding: "10px 14px",
                    }}
                  >
                    {t("junction.connected_value", { value: junctionState.glucose })}
                  </div>
                )}
                {/* Junction integration is feature-frozen for now — button is
                    intentionally disabled with "Bald verfügbar" label so the
                    settings UI signals the upcoming option without exposing a
                    half-finished flow. Code path below (handleJunctionConnect,
                    /api/cgm/connect, junctionState polling) is intentionally
                    kept intact so we can re-enable with a single line change
                    once the Junction integration is production-ready. */}
                <button
                  type="button"
                  onClick={handleJunctionConnect}
                  disabled
                  aria-disabled="true"
                  title={t("junction.badge_coming_soon")}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 12,
                    border: "none",
                    cursor: "not-allowed",
                    background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                    color:"var(--text)",
                    fontSize: 14,
                    fontWeight: 700,
                    boxShadow: `0 4px 20px ${ACCENT}40`,
                    opacity: 0.5,
                    marginTop: 4,
                  }}
                >
                  {t("junction.badge_coming_soon")}
                </button>
                {junctionMessage && (
                  <div
                    style={{
                      fontSize: 14,
                      color: junctionMessage.kind === "success" ? GREEN : PINK,
                      marginTop: 4,
                    }}
                  >
                    {junctionMessage.text}
                  </div>
                )}
              </>
            )}

            {cgmType === "nightscout" && (
              <>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    lineHeight: 1.6,
                    background: "var(--surface-soft)",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  {t("nightscout.description_pre")}{" "}
                  <code
                    style={{
                      color: "var(--text-body)",
                      background: "var(--surface-soft)",
                      padding: "1px 6px",
                      borderRadius: 4,
                    }}
                  >
                    cgm-remote-monitor.nightscout.me
                  </code>
                </div>

                <div>
                  <label style={label} htmlFor="ns-url">
                    {t("nightscout.label_url")}
                  </label>
                  <input
                    id="ns-url"
                    type="url"
                    value={nightscoutUrl}
                    onChange={(e) => setNightscoutUrl(e.target.value)}
                    placeholder="https://mynightscout.fly.dev"
                    style={inp}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label style={label} htmlFor="ns-token">
                    {t("nightscout.label_token")}{" "}
                    {nightscoutHasToken && nightscoutConnected ? (
                      <span style={{ color: "var(--text-dim)" }}>
                        {t("nightscout.token_saved_hint")}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>
                        {t("nightscout.token_optional_hint")}
                      </span>
                    )}
                  </label>
                  <input
                    id="ns-token"
                    type="password"
                    value={nightscoutToken}
                    onChange={(e) => setNightscoutToken(e.target.value)}
                    placeholder={
                      nightscoutHasToken
                        ? t("nightscout.token_placeholder_saved")
                        : t("nightscout.token_placeholder_empty")
                    }
                    style={inp}
                    autoComplete="off"
                  />
                </div>

                {nightscoutConnected && nightscoutLatest != null && (
                  <div
                    style={{
                      fontSize: 14,
                      color: GREEN,
                      background: `${GREEN}10`,
                      border: `1px solid ${GREEN}30`,
                      borderRadius: 10,
                      padding: "10px 14px",
                    }}
                  >
                    {t("nightscout.connected_value", { value: nightscoutLatest })}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleNightscoutConnect}
                    disabled={nightscoutSubmitting}
                    style={{
                      padding: "12px 18px",
                      borderRadius: 12,
                      border: "none",
                      cursor: nightscoutSubmitting ? "wait" : "pointer",
                      background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
                      color:"var(--text)",
                      fontSize: 14,
                      fontWeight: 700,
                      boxShadow: `0 4px 20px ${ACCENT}40`,
                      opacity: nightscoutSubmitting ? 0.6 : 1,
                    }}
                  >
                    {nightscoutSubmitting
                      ? t("nightscout.btn_connecting")
                      : nightscoutConnected
                      ? t("nightscout.btn_update")
                      : t("nightscout.btn_connect")}
                  </button>
                  {nightscoutConnected && (
                    <button
                      type="button"
                      onClick={handleNightscoutDisconnect}
                      disabled={nightscoutSubmitting}
                      style={{
                        padding: "12px 18px",
                        borderRadius: 12,
                        border: `1px solid ${PINK}50`,
                        background: "transparent",
                        color: PINK,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: nightscoutSubmitting ? "wait" : "pointer",
                      }}
                    >
                      {t("nightscout.btn_disconnect")}
                    </button>
                  )}
                </div>

                {nightscoutMessage && (
                  <div
                    style={{
                      fontSize: 14,
                      color:
                        nightscoutMessage.kind === "success" ? GREEN : PINK,
                      marginTop: 4,
                    }}
                  >
                    {nightscoutMessage.text}
                  </div>
                )}
              </>
            )}

          </div>
        </form>
      )}
    </div>
  );
}

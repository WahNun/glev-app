"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER = "var(--border)";

interface SyncGetResponse {
  connected: boolean;
  url: string | null;
  hasToken?: boolean;
}

interface SyncPostResponse {
  connected: boolean;
  current: { value: number | null; trend?: string; timestamp?: string } | null;
  error?: string;
}

const card: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: "20px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
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
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-dim)",
  display: "block",
  marginBottom: 6,
};

/**
 * Settings card for the Nightscout CGM integration. Mirrors the LLU
 * card's connect/disconnect flow but with the simpler URL+token model
 * Nightscout uses (no regional auth, no session caching). On mount we
 * GET /api/cgm/nightscout/sync to pre-fill the URL field and surface
 * "already connected" state; Save POSTs the same endpoint which probes
 * upstream first and persists on success; Trennen DELETEs.
 */
export default function NightscoutSettingsCard() {
  const t = useTranslations("nightscout");
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cgm/nightscout/sync", {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as SyncGetResponse;
        if (cancelled) return;
        if (data.connected && data.url) {
          setConnected(true);
          setUrl(data.url);
          setHasToken(!!data.hasToken);
        }
      } catch {
        // Best-effort — leave the form blank if status probe fails.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanUrl = url.trim().replace(/\/+$/, "");
    if (!cleanUrl) {
      setError(t("err_url_required"));
      return;
    }
    if (!/^https?:\/\//i.test(cleanUrl)) {
      setError(t("err_url_protocol"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/cgm/nightscout/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: cleanUrl,
          // Empty string = "don't change" (preserve saved token); explicit
          // value overwrites. Matches the route's submittedToken handling.
          token: token.trim() || null,
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as SyncPostResponse;
      if (!res.ok) {
        setError(data.error ?? t("err_default"));
        return;
      }
      setConnected(true);
      setHasToken(!!token.trim() || hasToken);
      setUrl(cleanUrl);
      setToken("");
      const reading = data.current?.value;
      setSuccess(
        reading != null
          ? t("ok_with_value", { value: reading })
          : t("ok_no_value"),
      );
    } catch {
      setError(t("err_network"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t("confirm_disconnect"))) {
      return;
    }
    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/cgm/nightscout/sync", {
        method: "DELETE",
        cache: "no-store",
      });
      if (!res.ok) {
        setError(t("err_disconnect"));
        return;
      }
      setConnected(false);
      setHasToken(false);
      setUrl("");
      setToken("");
      setSuccess(t("ok_disconnected"));
    } catch {
      setError(t("err_disconnect_network"));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              flexShrink: 0,
              background: "var(--surface-soft)",
              border: `1px solid ${BORDER}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={ACCENT}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-strong)",
                marginBottom: 2,
              }}
            >
              {t("title")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              {t("subtitle")}
            </div>
          </div>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "4px 10px",
            borderRadius: 99,
            background: connected ? `${GREEN}15` : "var(--surface-soft)",
            color: connected ? GREEN : "var(--text-dim)",
            border: `1px solid ${connected ? `${GREEN}55` : BORDER}`,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? t("status_loading") : connected ? t("status_connected") : t("status_disconnected")}
        </span>
      </div>

      <form
        onSubmit={handleSave}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div>
          <label htmlFor="ns-url" style={labelStyle}>
            {t("url_label")}
          </label>
          <input
            id="ns-url"
            type="url"
            inputMode="url"
            placeholder={t("url_placeholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={submitting || disconnecting}
            style={inp}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label htmlFor="ns-token" style={labelStyle}>
            {t("token_label")}{" "}
            {hasToken && (
              <span style={{ color: "var(--text-faint)" }}>
                {t("token_saved_hint")}
              </span>
            )}
          </label>
          <input
            id="ns-token"
            type="password"
            placeholder={hasToken ? t("token_placeholder_saved") : t("token_placeholder_new")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={submitting || disconnecting}
            style={inp}
            autoComplete="new-password"
            spellCheck={false}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: PINK,
              background: `${PINK}10`,
              border: `1px solid ${PINK}30`,
              borderRadius: 8,
              padding: "8px 12px",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
        {success && !error && (
          <div
            role="status"
            style={{
              fontSize: 12,
              color: GREEN,
              background: `${GREEN}10`,
              border: `1px solid ${GREEN}30`,
              borderRadius: 8,
              padding: "8px 12px",
              lineHeight: 1.5,
            }}
          >
            {success}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={submitting || disconnecting}
            style={{
              flex: "1 1 140px",
              minHeight: 44,
              borderRadius: 10,
              border: "none",
              background: ACCENT,
              color:"var(--text)",
              fontSize: 14,
              fontWeight: 600,
              cursor:
                submitting || disconnecting ? "wait" : "pointer",
              opacity: submitting || disconnecting ? 0.7 : 1,
              fontFamily: "inherit",
            }}
          >
            {submitting ? t("save_busy") : connected ? t("update_btn") : t("save_idle")}
          </button>
          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={submitting || disconnecting}
              style={{
                flex: "0 1 auto",
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 10,
                background: "transparent",
                border: `1px solid ${BORDER}`,
                color: "var(--text-body)",
                fontSize: 14,
                fontWeight: 500,
                cursor:
                  submitting || disconnecting ? "wait" : "pointer",
                opacity: submitting || disconnecting ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            >
              {disconnecting ? t("disconnect_busy") : t("disconnect_idle")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

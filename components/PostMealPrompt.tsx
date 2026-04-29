"use client";

import { useEffect, useState } from "react";
import { usePostMealCheck } from "@/hooks/usePostMealCheck";
import { supabase } from "@/lib/supabase";

const ACCENT      = "#4F6EF7";
const SHEET_BG    = "#1A1A24";
const SHEET_BORDER = "rgba(255,255,255,0.1)";
const INPUT_BG    = "#111117";
const TEXT_DIM    = "rgba(255,255,255,0.6)";

/**
 * Floating bottom banner that asks the user for a post-meal BG reading
 * at 30min / 1h / 90min / 2h / 3h after a logged meal. Lives globally
 * inside the protected layout so it surfaces on every authenticated
 * page (Dashboard, Engine, History, Settings) — but never on landing
 * pages (/, /beta, /pro, /legal) which sit outside the protected
 * route group.
 *
 * Sits above the mobile bottom-nav on phones and bottom-corners on
 * desktop. Submits to /api/meals/[id]/glucose which writes the right
 * glucose_* column + matching _at timestamp.
 */
export default function PostMealPrompt() {
  const { pendingMeal, dismiss, refetch } = usePostMealCheck();
  const [glucoseValue, setGlucoseValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset local form state whenever a different prompt comes up so the
  // user doesn't see stale input from the previous timepoint.
  useEffect(() => {
    setGlucoseValue("");
    setSaved(false);
    setError(null);
  }, [pendingMeal?.id, pendingMeal?.timepoint]);

  if (!pendingMeal || saved) return null;

  const handleSave = async () => {
    const value = parseInt(glucoseValue, 10);
    if (!Number.isFinite(value) || value < 20 || value > 600) {
      setError("Bitte einen Wert zwischen 20 und 600 mg/dL eingeben.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Forward the supabase access token so the API can authenticate
      // even when the cookie session race-conditions during a tab focus.
      const { data: { session } } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch(`/api/meals/${pendingMeal.id}/glucose`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ timepoint: pendingMeal.timepoint, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setError(body?.error || `Speichern fehlgeschlagen (${res.status}).`);
        return;
      }
      setSaved(true);
      setTimeout(() => {
        dismiss();
        refetch();
      }, 1200);
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <style>{`
        .glev-postmeal-banner {
          position: fixed; left: 0; right: 0;
          bottom: 24px; z-index: 95; padding: 0 16px;
          display: flex; justify-content: center;
          pointer-events: none;
        }
        .glev-postmeal-banner > * { pointer-events: auto; }
        @media (max-width: 768px) {
          .glev-postmeal-banner {
            bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
          }
        }
      `}</style>
      <div className="glev-postmeal-banner">
        <div
          role="dialog"
          aria-label={`BG nach ${pendingMeal.label} eintragen`}
          style={{
            width: "100%", maxWidth: 480,
            background: SHEET_BG,
            border: `1px solid ${SHEET_BORDER}`,
            borderRadius: 16,
            padding: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>
                BG nach {pendingMeal.label}
              </div>
              <div style={{ color: TEXT_DIM, fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {pendingMeal.name}
              </div>
            </div>
            <button
              onClick={dismiss}
              aria-label="Schließen"
              style={{
                background: "none", border: "none", color: TEXT_DIM,
                fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1,
                width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >×</button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type="number"
                inputMode="numeric"
                placeholder="z.B. 130"
                min={20}
                max={600}
                value={glucoseValue}
                onChange={(e) => { setGlucoseValue(e.target.value); if (error) setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                disabled={saving}
                autoFocus
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: INPUT_BG,
                  border: `1px solid ${SHEET_BORDER}`,
                  borderRadius: 10,
                  padding: "12px 56px 12px 14px",
                  color: "#fff", fontSize: 16,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <span style={{
                position: "absolute", right: 12, top: "50%",
                transform: "translateY(-50%)",
                color: TEXT_DIM, fontSize: 13, pointerEvents: "none",
              }}>mg/dL</span>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !glucoseValue}
              style={{
                background: saving || !glucoseValue ? "#333" : ACCENT,
                color: "#fff", border: "none", borderRadius: 10,
                padding: "0 20px", fontWeight: 600, fontSize: 14,
                fontFamily: "inherit",
                cursor: saving || !glucoseValue ? "default" : "pointer",
                whiteSpace: "nowrap", transition: "background 0.15s",
                minWidth: 96,
              }}
            >
              {saving ? "…" : "Speichern"}
            </button>
          </div>

          {error && (
            <div role="alert" style={{
              marginTop: 10,
              color: "#FF8A8A", fontSize: 12, lineHeight: 1.4,
            }}>{error}</div>
          )}

          <button
            onClick={dismiss}
            style={{
              background: "none", border: "none",
              color: "rgba(255,255,255,0.4)", fontSize: 12,
              cursor: "pointer", marginTop: 10, padding: 0,
              fontFamily: "inherit",
            }}
          >
            Später eingeben
          </button>
        </div>
      </div>
    </>
  );
}

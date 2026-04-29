"use client";

import { useEffect, useMemo, useState } from "react";
import type { Meal } from "@/lib/meals";

const ACCENT = "#4F6EF7";
const BORDER = "rgba(255,255,255,0.08)";

type Timepoint = "30min" | "1h" | "90min" | "2h" | "3h";

type TPCfg = {
  key: Timepoint;
  column: keyof Meal;
  atColumn: keyof Meal;
  label: string;
  min: number;
  max: number;
};

const TIMEPOINTS: TPCfg[] = [
  { key: "30min", column: "glucose_30min", atColumn: "glucose_30min_at", label: "30 Min", min:  25, max:  50 },
  { key: "1h",    column: "glucose_1h",    atColumn: "glucose_1h_at",    label: "1 Std",  min:  55, max:  80 },
  { key: "90min", column: "glucose_90min", atColumn: "glucose_90min_at", label: "90 Min", min:  85, max: 110 },
  { key: "2h",    column: "glucose_2h",    atColumn: "glucose_2h_at",    label: "2 Std",  min: 115, max: 150 },
  { key: "3h",    column: "glucose_3h",    atColumn: "glucose_3h_at",    label: "3 Std",  min: 175, max: 210 },
];

/**
 * Tiny inline strip that surfaces a pending post-meal BG reading
 * directly on the meal card in the Verlauf list. Replaces the global
 * floating PostMealPrompt banner — the badge is dezent, only renders
 * when there's something to do, and the inline editor opens in-place
 * (kein global overlay).
 *
 * Renders nothing unless:
 *   - The meal is currently inside a timepoint window (25–210 min after
 *     meal_time / created_at)
 *   - The matching glucose_<tp> column is still null
 *
 * Always picks the FIRST eligible timepoint so the user is never asked
 * for two values at once. Polls clock state every 30s so a card that
 * crosses into a window while the page is open lights up automatically.
 */
export default function PendingGlucoseStrip({
  meal,
  onSaved,
}: {
  meal: Meal;
  onSaved?: (patch: Partial<Meal>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Re-render every 30s so a card whose meal_time crosses into a new
  // timepoint window (e.g. 24min → 25min after meal) starts showing
  // the badge without requiring the user to refresh / re-render the
  // parent list.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const activeTp = useMemo<TPCfg | null>(() => {
    const anchor = meal.meal_time ?? meal.created_at;
    if (!anchor) return null;
    const ms = new Date(anchor).getTime();
    if (!Number.isFinite(ms)) return null;
    const minutesSince = (Date.now() - ms) / 60_000;
    if (minutesSince < 25 || minutesSince > 210) return null;
    return (
      TIMEPOINTS.find(
        (tp) => minutesSince >= tp.min && minutesSince <= tp.max && meal[tp.column] == null,
      ) ?? null
    );
    // tick is intentionally a dep so the memo re-runs every 30s.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal, tick]);

  if (!activeTp) return null;

  const handleSave = async () => {
    const v = parseInt(val, 10);
    if (!Number.isFinite(v) || v < 20 || v > 600) {
      setErr("Wert zwischen 20 und 600 mg/dL.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/meals/${meal.id}/glucose`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timepoint: activeTp.key, value: v }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({} as { error?: string }));
        setErr(body?.error || `Fehler ${r.status}`);
        return;
      }
      // Patch the parent's local state so the strip disappears
      // immediately and the meal row reflects the new value without a
      // full refetch.
      onSaved?.({
        [activeTp.column]: v,
        [activeTp.atColumn]: new Date().toISOString(),
      } as Partial<Meal>);
      setExpanded(false);
      setVal("");
    } catch {
      setErr("Netzwerkfehler.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        padding: "8px 16px",
        background: "rgba(79,110,247,0.06)",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`BG nach ${activeTp.label} eintragen`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 99,
            border: `1px solid ${ACCENT}66`,
            background: `${ACCENT}1A`,
            color: ACCENT,
            fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 8, lineHeight: 1 }}>●</span>
          BG nach {activeTp.label} eintragen
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
            BG nach {activeTp.label}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <input
                type="number"
                inputMode="numeric"
                placeholder="z.B. 130"
                min={20}
                max={600}
                value={val}
                onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                disabled={saving}
                autoFocus
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "#0D0D12",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: "8px 48px 8px 12px",
                  color: "#fff", fontSize: 14,
                  fontFamily: "inherit", outline: "none",
                }}
              />
              <span style={{
                position: "absolute", right: 10, top: "50%",
                transform: "translateY(-50%)",
                color: "rgba(255,255,255,0.4)", fontSize: 11, pointerEvents: "none",
              }}>mg/dL</span>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !val}
              style={{
                background: saving || !val ? "#333" : ACCENT,
                color: "#fff", border: "none", borderRadius: 8,
                padding: "0 14px", fontWeight: 600, fontSize: 12,
                fontFamily: "inherit",
                cursor: saving || !val ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {saving ? "…" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={() => { setExpanded(false); setVal(""); setErr(null); }}
              aria-label="Schließen"
              style={{
                background: "none", border: "none",
                color: "rgba(255,255,255,0.5)", fontSize: 18,
                cursor: "pointer", padding: "0 4px",
                fontFamily: "inherit",
              }}
            >×</button>
          </div>
          {err && (
            <div role="alert" style={{ color: "#FF8A8A", fontSize: 11 }}>{err}</div>
          )}
        </div>
      )}
    </div>
  );
}

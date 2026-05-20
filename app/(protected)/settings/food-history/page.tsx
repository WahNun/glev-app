"use client";

/**
 * /settings/food-history — "Meine Lebensmittel" Settings tab.
 *
 * Surfaces the Phase B per-user food memory (user_food_history). The
 * user can see every item the app has learned (typical portion + per-
 * 100g macros), edit the values (writes flip source → user_confirmed
 * so passive saveMeal writes don't overwrite the edit), or delete the
 * row entirely (next parse rebuilds from scratch via OFF/USDA).
 *
 * Phase B addition: when the list comes back empty on first load, the
 * page fires POST /api/food-history/backfill once to seed the table
 * from the user's historical meal data, then reloads.
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { hapticSelection, hapticSuccess, hapticError } from "@/lib/haptics";

const ACCENT = "#4F6EF7";
const BORDER = "var(--border)";

interface Row {
  id: string;
  display_name: string;
  normalized_name: string;
  typical_grams: number;
  carbs_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number;
  source: "history" | "user_confirmed";
  occurrences: number;
  last_seen_at: string;
}

export default function FoodHistoryPage() {
  const t = useTranslations("foodHistory");

  const [rows, setRows]           = useState<Row[]>([]);
  const [loading, setLoading]     = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState<Partial<Row>>({});
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  // Guard: run backfill at most once per page visit.
  const hasTriedBackfill = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/food-history", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items: Row[] = Array.isArray(json.items) ? json.items : [];
      setRows(items);

      // Phase B: on first visit with an empty list, trigger the
      // backfill from historical meals silently.
      if (items.length === 0 && !hasTriedBackfill.current) {
        hasTriedBackfill.current = true;
        setBackfilling(true);
        try {
          await fetch("/api/food-history/backfill", { method: "POST" });
        } catch { /* silent — backfill is best-effort */ }
        setBackfilling(false);
        // Reload the list after backfill.
        const res2 = await fetch("/api/food-history", { cache: "no-store" });
        if (res2.ok) {
          const json2 = await res2.json();
          setRows(Array.isArray(json2.items) ? json2.items : []);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function startEdit(r: Row) {
    hapticSelection();
    setEditingId(r.id);
    setDraft({ ...r });
  }
  function cancelEdit() {
    setEditingId(null);
    setDraft({});
  }
  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    setErr(null);
    try {
      const body = {
        display_name:     draft.display_name,
        typical_grams:    draft.typical_grams,
        carbs_per_100g:   draft.carbs_per_100g,
        protein_per_100g: draft.protein_per_100g,
        fat_per_100g:     draft.fat_per_100g,
        fiber_per_100g:   draft.fiber_per_100g,
      };
      const res = await fetch(`/api/food-history/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      hapticSuccess();
      cancelEdit();
      await load();
    } catch (e) {
      hapticError();
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeRow(r: Row) {
    if (!confirm(t("confirm_delete", { name: r.display_name }))) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/food-history/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      hapticSuccess();
      await load();
    } catch (e) {
      hapticError();
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "24px 16px 80px", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings" style={{ color: ACCENT, textDecoration: "none", fontSize: 14 }}>
          ← {t("back_to_settings")}
        </Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{t("page_title")}</h1>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 24 }}>
        {t("page_subtitle")}
      </p>

      {(loading || backfilling) && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
          {backfilling ? "Analysiere frühere Mahlzeiten…" : t("loading")}
        </div>
      )}

      {err && (
        <div style={{ padding: 12, background: "rgba(255,45,120,0.1)", color: "#FF2D78", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {err}
        </div>
      )}

      {!loading && !backfilling && rows.length === 0 && (
        <div style={{ padding: 32, textAlign: "center", border: `1px dashed ${BORDER}`, borderRadius: 12, color: "var(--text-muted)" }}>
          {t("empty")}
        </div>
      )}

      {!loading && !backfilling && rows.map((r) => {
        const isEdit = editingId === r.id;
        return (
          <div
            key={r.id}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 14,
              marginBottom: 10,
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isEdit ? (
                  <input
                    type="text"
                    value={String(draft.display_name ?? "")}
                    onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))}
                    style={inputStyle}
                  />
                ) : (
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{r.display_name}</div>
                )}
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {r.source === "user_confirmed" ? t("source_confirmed") : t("source_history")}
                  {" · "}
                  {t("occurrences", { n: r.occurrences })}
                </div>
              </div>
              {!isEdit && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => startEdit(r)} disabled={busy} style={btnGhost}>{t("edit")}</button>
                  <button onClick={() => void removeRow(r)} disabled={busy} style={btnDanger}>{t("delete")}</button>
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
              <Field label={t("typical_grams")} suffix="g" value={isEdit ? draft.typical_grams : r.typical_grams}
                onChange={(v) => setDraft((d) => ({ ...d, typical_grams: v }))} editable={isEdit} step={1} />
              <Field label={t("carbs_per_100")} suffix="g" value={isEdit ? draft.carbs_per_100g : r.carbs_per_100g}
                onChange={(v) => setDraft((d) => ({ ...d, carbs_per_100g: v }))} editable={isEdit} step={0.1} />
              <Field label={t("protein_per_100")} suffix="g" value={isEdit ? draft.protein_per_100g : r.protein_per_100g}
                onChange={(v) => setDraft((d) => ({ ...d, protein_per_100g: v }))} editable={isEdit} step={0.1} />
              <Field label={t("fat_per_100")} suffix="g" value={isEdit ? draft.fat_per_100g : r.fat_per_100g}
                onChange={(v) => setDraft((d) => ({ ...d, fat_per_100g: v }))} editable={isEdit} step={0.1} />
              <Field label={t("fiber_per_100")} suffix="g" value={isEdit ? draft.fiber_per_100g : r.fiber_per_100g}
                onChange={(v) => setDraft((d) => ({ ...d, fiber_per_100g: v }))} editable={isEdit} step={0.1} />
            </div>

            {isEdit && (
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button onClick={() => void saveEdit()} disabled={busy} style={btnPrimary}>
                  {busy ? t("saving") : t("save")}
                </button>
                <button onClick={cancelEdit} disabled={busy} style={btnGhost}>{t("cancel")}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label, value, suffix, onChange, editable, step,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  onChange: (v: number) => void;
  editable: boolean;
  step: number;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
      {editable ? (
        <input
          type="number"
          step={step}
          min={0}
          value={value ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
          style={inputStyle}
        />
      ) : (
        <div style={{ fontSize: 14, fontWeight: 500 }}>
          {Number(value ?? 0).toFixed(step < 1 ? 1 : 0)}
          {suffix ? <span style={{ color: "var(--text-muted)", marginLeft: 2 }}>{suffix}</span> : null}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 14,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: ACCENT,
  color: "white",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "var(--text)",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "#FF2D78",
  border: `1px solid rgba(255,45,120,0.4)`,
  borderRadius: 8,
  fontSize: 13,
  cursor: "pointer",
};

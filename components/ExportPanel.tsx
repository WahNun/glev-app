"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import {
  fetchAllMeals,
  fetchAllInsulinLogs,
  fetchAllExerciseLogs,
  fetchAllFingersticks,
  mealsToCSV,
  insulinToCSV,
  exerciseToCSV,
  fingersticksToCSV,
  downloadFile,
  todayStamp,
} from "@/lib/export";
import { useCarbUnit } from "@/hooks/useCarbUnit";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

type Kind = "meals" | "insulin" | "exercise" | "fingersticks" | "all" | "pdf";

interface RowSpec {
  kind: Exclude<Kind, "all">;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
  color: string;
}

const ROWS: RowSpec[] = [
  {
    kind: "meals",
    labelKey: "row_meals_label",
    descKey: "row_meals_desc",
    color: ORANGE,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h18"/><path d="M3 12c0 5 4 9 9 9s9-4 9-9"/><path d="M5 8a7 7 0 0 1 14 0"/>
      </svg>
    ),
  },
  {
    kind: "insulin",
    labelKey: "row_insulin_label",
    descKey: "row_insulin_desc",
    color: ACCENT,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6L6 18"/><path d="M14 4l6 6"/><path d="M4 14l6 6"/><path d="M9 11l4 4"/>
      </svg>
    ),
  },
  {
    kind: "exercise",
    labelKey: "row_exercise_label",
    descKey: "row_exercise_desc",
    color: GREEN,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2"/><path d="M12 7v5"/><path d="M9 12l3 3 3-3"/><path d="M9 21l3-6 3 6"/>
      </svg>
    ),
  },
  {
    kind: "fingersticks",
    labelKey: "row_fingersticks_label",
    descKey: "row_fingersticks_desc",
    color: PINK,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C8 8 6 12 6 15a6 6 0 0 0 12 0c0-3-2-7-6-13z"/>
      </svg>
    ),
  },
];

/**
 * ExportPanel — lets the user download their full Glev history as CSV.
 *
 * Each kind exports independently (separate CSV per data type) so the
 * user can grab just one type if that's all they need. The "Alles
 * herunterladen" action triggers all four downloads in sequence so
 * the browser fires four save-as prompts (or four files into the
 * default Downloads folder, depending on browser settings).
 *
 * Row-level loading state isolates feedback to the kind being fetched
 * so other rows stay enabled during a long meals export.
 */
export default function ExportPanel() {
  const t = useTranslations("export");
  const { unit: carbUnit, label: carbUnitLabel } = useCarbUnit();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [email, setEmail] = useState<string>("");
  // Snapshot the user's current ICR (g/IE) once on mount so we can
  // annotate the insulin CSV/PDF with the ratio in their chosen carb
  // unit (e.g. "2 BE/IE"). Null until the async fetch resolves; we
  // simply omit the annotation if it stays null (CSV header is skipped
  // and the PDF cover/insulin section drop the ICR line). Re-fetched
  // once per panel mount which is fine — the user can't change ICR
  // from the export page, so a snapshot captured here matches what
  // they had when they pressed the button.
  const [icrGperIE, setIcrGperIE] = useState<number | null>(null);

  // Pull the signed-in user's email so the PDF report can show it on
  // the cover page. Soft-fail: if supabase is unavailable we just
  // render an empty string and the report still generates.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
    });
  }, []);

  // Read the user's ICR directly from the user_settings row instead
  // of going through fetchInsulinSettings() — that helper transparently
  // substitutes DEFAULT_INSULIN_SETTINGS.icr (15 g/IE) when the row or
  // the column is missing, which would surface a default-derived value
  // as "Aktueller ICR" on the report and could mislead a clinician
  // reading the export. Querying the column directly lets us treat
  // null/missing as "not configured" and suppress the annotation.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_settings")
        .select("icr_g_per_unit")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const raw = data?.icr_g_per_unit;
      // Only annotate when the value is explicitly set AND positive —
      // a missing row, null column, or non-positive value all collapse
      // to null so the export omits the ICR cleanly.
      setIcrGperIE(typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function exportKind(kind: Exclude<Kind, "all">) {
    setBusy(kind);
    setMsg(null);
    try {
      const stamp = todayStamp();
      let count = 0;
      if (kind === "meals") {
        const rows = await fetchAllMeals();
        count = rows.length;
        downloadFile(`glev-mahlzeiten_${stamp}.csv`, mealsToCSV(rows, carbUnit));
      } else if (kind === "insulin") {
        const rows = await fetchAllInsulinLogs();
        count = rows.length;
        downloadFile(
          `glev-insulin_${stamp}.csv`,
          insulinToCSV(rows, { carbUnit, icrGperIE }),
        );
      } else if (kind === "exercise") {
        const rows = await fetchAllExerciseLogs();
        count = rows.length;
        downloadFile(`glev-sport_${stamp}.csv`, exerciseToCSV(rows));
      } else if (kind === "fingersticks") {
        const rows = await fetchAllFingersticks();
        count = rows.length;
        downloadFile(`glev-fingersticks_${stamp}.csv`, fingersticksToCSV(rows));
      }
      flash("ok", count === 1 ? t("exported_one") : t("exported_many", { n: count }));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : t("csv_failed"));
    } finally {
      setBusy(null);
    }
  }

  async function exportAll() {
    setBusy("all");
    setMsg(null);
    try {
      const stamp = todayStamp();
      const [meals, insulin, exercise, fs] = await Promise.all([
        fetchAllMeals(),
        fetchAllInsulinLogs(),
        fetchAllExerciseLogs(),
        fetchAllFingersticks(),
      ]);
      // Sequential downloads with small delay so browsers don't merge or
      // drop the rapid-fire save prompts.
      const files: Array<[string, string]> = [
        [`glev-mahlzeiten_${stamp}.csv`,   mealsToCSV(meals, carbUnit)],
        [`glev-insulin_${stamp}.csv`,      insulinToCSV(insulin, { carbUnit, icrGperIE })],
        [`glev-sport_${stamp}.csv`,        exerciseToCSV(exercise)],
        [`glev-fingersticks_${stamp}.csv`, fingersticksToCSV(fs)],
      ];
      for (const [name, content] of files) {
        downloadFile(name, content);
        await new Promise((r) => setTimeout(r, 200));
      }
      const total = meals.length + insulin.length + exercise.length + fs.length;
      flash("ok", t("exported_all", { n: total }));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : t("csv_failed"));
    } finally {
      setBusy(null);
    }
  }

  // PDF report — dynamically import @react-pdf/renderer so the ~400KB
  // runtime only loads when the user actually generates a report.
  async function exportPdf() {
    setBusy("pdf");
    setMsg(null);
    try {
      const [meals, insulin, exercise, fs] = await Promise.all([
        fetchAllMeals(),
        fetchAllInsulinLogs(),
        fetchAllExerciseLogs(),
        fetchAllFingersticks(),
      ]);
      // Lazy imports keep this expensive code out of the main bundle.
      const [{ pdf }, { GlevReport }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/lib/pdfReport"),
      ]);
      const blob = await pdf(
        <GlevReport
          email={email}
          meals={meals}
          insulin={insulin}
          exercise={exercise}
          fingersticks={fs}
          carbUnit={carbUnit}
          icrGperIE={icrGperIE}
        />,
      ).toBlob();

      // Re-use the same download mechanism but skip the BOM (PDF is
      // binary). Use the Blob directly via object URL.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `glev-bericht_${todayStamp()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const total = meals.length + insulin.length + exercise.length + fs.length;
      flash("ok", t("pdf_done", { n: total }));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : t("pdf_failed"));
    } finally {
      setBusy(null);
    }
  }

  const card: React.CSSProperties = {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    padding: "20px 22px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
          {t("header_title")}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.5 }}>
          {t("header_subtitle")}
        </div>
      </div>

      {/* Per-kind rows */}
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        {ROWS.map((row, i) => (
          <div
            key={row.kind}
            style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "16px 18px",
              borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: `${row.color}15`, color: row.color,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {row.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)", marginBottom: 2 }}>
                {t(row.labelKey)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                {t(row.descKey)}
              </div>
            </div>
            <button
              onClick={() => exportKind(row.kind)}
              disabled={busy !== null}
              style={{
                padding: "8px 14px", borderRadius: 9, border: `1px solid ${BORDER}`,
                background: busy === row.kind ? "var(--surface-soft)" : "var(--surface-soft)",
                color: busy === row.kind ? "var(--text-dim)" : "var(--text-strong)",
                fontSize: 12, fontWeight: 600,
                cursor: busy !== null ? "not-allowed" : "pointer",
                opacity: busy !== null && busy !== row.kind ? 0.45 : 1,
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {busy === row.kind ? t("csv_busy") : t("csv_btn")}
            </button>
          </div>
        ))}
      </div>

      {/* Bulk actions: CSV-all + PDF report side by side */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={exportAll}
          disabled={busy !== null}
          style={{
            flex: "1 1 200px",
            padding: "14px", borderRadius: 12,
            border: `1px solid ${BORDER}`,
            background: "var(--surface-soft)",
            color: "var(--text-strong)",
            fontSize: 13, fontWeight: 600,
            cursor: busy !== null ? "not-allowed" : "pointer",
            opacity: busy !== null && busy !== "all" ? 0.5 : 1,
          }}
        >
          {busy === "all" ? t("all_btn_busy") : t("all_btn_idle")}
        </button>
        <button
          onClick={exportPdf}
          disabled={busy !== null}
          style={{
            flex: "1 1 200px",
            padding: "14px", borderRadius: 12, border: "none",
            background: busy === "pdf"
              ? `${ACCENT}40`
              : `linear-gradient(135deg, ${ACCENT}, #3B5BE0)`,
            color:"var(--text)", fontSize: 14, fontWeight: 700,
            cursor: busy !== null ? "not-allowed" : "pointer",
            boxShadow: busy === null ? `0 4px 18px ${ACCENT}30` : "none",
            opacity: busy !== null && busy !== "pdf" ? 0.5 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="9" y1="13" x2="15" y2="13"/>
            <line x1="9" y1="17" x2="13" y2="17"/>
          </svg>
          {busy === "pdf" ? t("pdf_btn_busy") : t("pdf_btn_idle")}
        </button>
      </div>

      {/* Toast */}
      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: msg.kind === "ok" ? `${GREEN}15` : `${PINK}15`,
          border: `1px solid ${msg.kind === "ok" ? GREEN : PINK}40`,
          color: msg.kind === "ok" ? GREEN : PINK,
          fontSize: 12, fontWeight: 600,
        }}>
          {msg.text}
        </div>
      )}

      {/* PDF report info */}
      <div style={{
        marginTop: 4, padding: "12px 14px", borderRadius: 10,
        background: "var(--surface-soft)", border: `1px dashed ${BORDER}`,
        fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        <strong style={{ color: "var(--text-muted)" }}>{t("pdf_info_label")}</strong>{t("pdf_info_body")}
      </div>

      {/* Carb-unit note — confirms which unit the KH columns in the
          generated CSV / PDF will use. Visually quieter than the PDF
          info card so it reads as a clarification rather than a
          separate feature, and updates live when the user toggles
          their preferred unit on the Einstellungen page. */}
      <div style={{
        padding: "8px 12px", borderRadius: 8,
        background: "var(--surface-soft)",
        fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("carb_unit_note", { unit: carbUnitLabel })}
      </div>
    </div>
  );
}

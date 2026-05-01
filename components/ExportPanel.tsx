"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { supabase } from "@/lib/supabase";
import {
  fetchAllMeals,
  fetchAllInsulinLogs,
  fetchAllExerciseLogs,
  fetchAllFingersticks,
  countAllInWindow,
  mealsToCSV,
  insulinToCSV,
  exerciseToCSV,
  fingersticksToCSV,
  downloadFile,
  todayStamp,
  type DateWindow,
  type RangeCounts,
} from "@/lib/export";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import { fetchLastAppointment } from "@/lib/userSettings";
import { localeToBcp47 } from "@/lib/time";

const ACCENT  = "#4F6EF7";
const GREEN   = "#22D3A0";
const ORANGE  = "#FF9500";
const PINK    = "#FF2D78";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";

// The four real data kinds the user can export individually. Keep
// this distinct from `Kind` (which also covers the bulk "all" and
// "pdf" actions) so that row-level state — the per-kind button label,
// the `counts` lookup, etc. — is provably constrained to the four
// keys that actually exist on `RangeCounts`.
type ExportRowKind = "meals" | "insulin" | "exercise" | "fingersticks";
type Kind = ExportRowKind | "all" | "pdf";

// Range presets the user can pick in the export panel. "all" preserves
// the legacy full-history behaviour; "30d" / "90d" cover the two
// canonical clinician windows ("last month-ish" and "last quarter-ish");
// "lastAppointment" pulls the saved date out of user_settings and pre-
// fills the same window as if the user had typed it into Custom — only
// rendered when the user has set a date in Settings, so the chip
// disappears cleanly when cleared (Task #75); "custom" exposes raw
// from/to date inputs for everything else.
type RangePreset = "all" | "30d" | "90d" | "lastAppointment" | "custom";

// localStorage key for the last-used picker state. Keyed under the
// `glev_` prefix used elsewhere (see `glev_theme` in lib/theme.ts) so
// it shows up alongside the rest of the app's client-side prefs in
// devtools. Bumping the schema (e.g. adding a new preset that should
// invalidate older saves) means renaming this key.
const RANGE_STORAGE_KEY = "glev_export_range";

// Shape of the persisted picker state. Kept as a plain object instead
// of three separate keys so a single read/write atomically captures
// the preset + custom dates together — there's no window where a
// stale `customFrom` could pair with a fresh preset on the next mount.
interface StoredRange {
  preset: RangePreset;
  customFrom: string;
  customTo: string;
}

const DEFAULT_STORED_RANGE: StoredRange = {
  preset: "all",
  customFrom: "",
  customTo: "",
};

function isRangePreset(v: unknown): v is RangePreset {
  return v === "all" || v === "30d" || v === "90d"
      || v === "lastAppointment" || v === "custom";
}

/**
 * Read the persisted picker state from localStorage, defaulting to
 * the legacy "all time" behaviour if anything is missing or malformed
 * (e.g. a hand-edited entry, a bumped schema, or the user wiping site
 * data). Custom-date strings are validated as `YYYY-MM-DD` so a junk
 * value can't slip into the date <input>'s `value` and break it
 * silently. SSR-safe: returns the default when `window` is unavailable.
 */
function readStoredRange(): StoredRange {
  if (typeof window === "undefined") return DEFAULT_STORED_RANGE;
  try {
    const raw = window.localStorage.getItem(RANGE_STORAGE_KEY);
    if (!raw) return DEFAULT_STORED_RANGE;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_STORED_RANGE;
    const obj = parsed as Record<string, unknown>;
    const preset = isRangePreset(obj.preset) ? obj.preset : "all";
    const isDateString = (v: unknown): v is string =>
      typeof v === "string" && (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v));
    const customFrom = isDateString(obj.customFrom) ? obj.customFrom : "";
    const customTo   = isDateString(obj.customTo)   ? obj.customTo   : "";
    return { preset, customFrom, customTo };
  } catch {
    // Storage disabled (Safari private mode), JSON parse failure, etc.
    return DEFAULT_STORED_RANGE;
  }
}

/**
 * Write the current picker state to localStorage. Soft-fail on storage
 * errors (private mode, quota exceeded) since the picker still works
 * in-memory — we just lose the next-visit shortcut, not the export.
 */
function writeStoredRange(value: StoredRange) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore — persistence is best-effort.
  }
}

/**
 * Resolve a preset (+ optional custom from/to dates as `YYYY-MM-DD`
 * strings from the date inputs, plus the saved last-appointment date
 * for the "lastAppointment" preset) into a Supabase fetch window AND
 * the matching display range to print on the PDF cover.
 *
 * Returns `{ window: undefined, display: undefined }` when no filter
 * should be applied (preset = "all", or "custom" with empty inputs);
 * each of the four fetchers treats `undefined` as "full history" and
 * the PDF then falls back to its data-derived range — i.e. legacy
 * behaviour is preserved byte-for-byte.
 *
 * Custom dates are interpreted in the user's local timezone (start
 * of the "from" day, end of the "to" day) so a clinician asking for
 * "the whole 31st" actually gets all entries from that calendar day,
 * not just the ones logged before midnight UTC.
 *
 * The "lastAppointment" branch reuses the same start-of-day / now
 * conversion as a custom "from = lastAppointment, to = today" pick,
 * so the resulting window is byte-for-byte identical to the user
 * typing the date into the Custom inputs — the picker is purely a
 * one-click shortcut, not a different code path.
 */
function resolveRange(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
  lastAppointment: string | null,
): { window?: DateWindow; display?: { from?: string; to?: string } } {
  if (preset === "all") return {};
  const now = new Date();
  if (preset === "30d" || preset === "90d") {
    const days = preset === "30d" ? 30 : 90;
    const from = new Date(now.getTime() - days * 86_400_000);
    const fromIso = from.toISOString();
    const toIso   = now.toISOString();
    return {
      window:  { from: fromIso, to: toIso },
      display: { from: fromIso, to: toIso },
    };
  }
  if (preset === "lastAppointment") {
    // Defensive fallback: if the chip somehow ends up active without a
    // saved date (race between the settings clear and the panel's
    // cached state), behave like "all" rather than crashing on a null
    // Date parse. The chip auto-deselects via the effect in the
    // component, so this branch should be unreachable in practice.
    if (!lastAppointment) return {};
    const fromIso = new Date(`${lastAppointment}T00:00:00`).toISOString();
    const toIso   = now.toISOString();
    return {
      window:  { from: fromIso, to: toIso },
      display: { from: fromIso, to: toIso },
    };
  }
  // preset === "custom"
  // Either bound may be empty — the user might want "since X" with no
  // explicit upper bound, or "up to Y" with no lower bound. Empty
  // strings collapse to `undefined` so `fetchAll*` skips that filter.
  const fromIso = customFrom
    ? new Date(`${customFrom}T00:00:00`).toISOString()
    : undefined;
  const toIso = customTo
    ? new Date(`${customTo}T23:59:59.999`).toISOString()
    : undefined;
  if (!fromIso && !toIso) return {};
  return {
    window:  { from: fromIso, to: toIso },
    display: { from: fromIso, to: toIso },
  };
}

/**
 * Compose a filename suffix that records the chosen range so a user
 * with multiple exports in their Downloads folder can tell them
 * apart at a glance. Returns "" for "all" / unbounded so the legacy
 * `glev-mahlzeiten_<today>.csv` filename stays untouched and any
 * downstream tooling that greps for the existing pattern keeps
 * matching.
 */
function rangeFilenameSuffix(display?: { from?: string; to?: string }): string {
  if (!display || (!display.from && !display.to)) return "";
  const fmt = (iso: string) => iso.slice(0, 10);
  const from = display.from ? fmt(display.from) : "anfang";
  const to   = display.to   ? fmt(display.to)   : "heute";
  return `_${from}_bis_${to}`;
}

interface RowSpec {
  kind: ExportRowKind;
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
  const bcp47 = localeToBcp47(useLocale());
  const { unit: carbUnit, label: carbUnitLabel } = useCarbUnit();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [email, setEmail] = useState<string>("");
  // Date-range picker state. Defaults to "all" so the panel still
  // produces a full-history export on a fresh visit (no behavioural
  // surprise for users who just want everything). Custom inputs hold
  // raw `YYYY-MM-DD` strings — the format the native <input type="date">
  // emits — and only get parsed into a window inside `resolveRange`.
  //
  // Lazy initializer rehydrates the user's last-used pick from
  // localStorage so a recurring-export flow (e.g. quarterly endo
  // appointments) becomes a one-click action instead of forcing the
  // user to re-pick "Last 90 days" every visit (Task #98). The panel
  // is mounted on the client (it lives inside a settings sheet that
  // opens on user click), so the lazy initializer can read storage
  // directly without risking a hydration mismatch.
  const [rangePreset, setRangePreset] = useState<RangePreset>(
    () => readStoredRange().preset,
  );
  const [customFrom, setCustomFrom] = useState<string>(
    () => readStoredRange().customFrom,
  );
  const [customTo, setCustomTo] = useState<string>(
    () => readStoredRange().customTo,
  );

  // Persist the picker state on every change so the next mount picks
  // up exactly where the user left off — including across reloads,
  // tabs, and browser sessions on the same device. Single effect
  // covers all three fields because they're stored together as one
  // JSON blob (atomic read/write — see StoredRange).
  useEffect(() => {
    writeStoredRange({ preset: rangePreset, customFrom, customTo });
  }, [rangePreset, customFrom, customTo]);

  // Live preview of how many rows the chosen range will pull. Drives
  // the count line under the picker so the user can confirm the slice
  // before clicking export — and avoid handing a doctor a blank PDF.
  // `null` = not yet loaded (initial render or in-flight refresh after
  // a picker change); a populated `RangeCounts` = latest result for
  // the currently chosen range.
  const [counts, setCounts] = useState<RangeCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState<boolean>(true);
  // Saved "last appointment" date from user_settings — drives the
  // optional 5th preset chip ("Seit letztem Arzttermin"). `null` means
  // either the user hasn't set one yet, or we haven't loaded it; in
  // both cases we hide the chip and behave exactly like the legacy
  // 4-preset panel. Loaded once on mount; the Settings page is the
  // only writer, and a user editing it triggers a full panel re-mount
  // (the Settings sheet re-opens this component), so we don't need
  // live invalidation here.
  const [lastAppointment, setLastAppointment] = useState<string | null>(null);
  // Tracks whether the async fetchLastAppointment() call has resolved
  // yet. We can't use `lastAppointment === null` for that — null is
  // also the legitimate "no date saved" value, and conflating the two
  // would let the auto-deselect effect below race the fetch and
  // silently downgrade a restored "lastAppointment" preset to "all"
  // before we know whether the user actually has a saved date (Task #98).
  const [lastAppointmentLoaded, setLastAppointmentLoaded] = useState<boolean>(false);
  // Snapshot the user's current ICR (g/IE) AND correction factor
  // (mg/dL drop per 1 IE) once on mount so we can annotate the
  // insulin CSV/PDF with the ratio in their chosen carb unit
  // (e.g. "2 BE/IE") and the matching CF (e.g. "50 mg/dL/IE"). Both
  // start null until the async fetch resolves; we omit each
  // annotation independently if it stays null (CSV column skipped,
  // PDF cover meta line dropped). Re-fetched once per panel mount —
  // fine because neither value can be changed from the export page,
  // so the snapshot captured here matches what the user had when
  // they pressed the export button.
  const [icrGperIE, setIcrGperIE] = useState<number | null>(null);
  const [cfMgdlPerIE, setCfMgdlPerIE] = useState<number | null>(null);

  // Pull the signed-in user's email so the PDF report can show it on
  // the cover page. Soft-fail: if supabase is unavailable we just
  // render an empty string and the report still generates.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
    });
  }, []);

  // Load the saved "last appointment" date so we can decide whether
  // to render the 5th preset chip. Failures (no row, signed out,
  // network) collapse to `null` → chip hidden, which is the same
  // behaviour as the user not having set a date yet, so there's no
  // separate error state to surface here.
  useEffect(() => {
    let cancelled = false;
    fetchLastAppointment()
      .then((value) => {
        if (cancelled) return;
        setLastAppointment(value);
        setLastAppointmentLoaded(true);
      })
      .catch(() => {
        // Leave value null — chip stays hidden — but still mark the
        // load as resolved so the auto-deselect effect below can
        // safely run (otherwise a transient fetch failure would pin
        // a restored "lastAppointment" preset on screen forever).
        if (!cancelled) setLastAppointmentLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Auto-deselect the lastAppointment chip if the underlying date
  // disappears (e.g. user clears it in another tab and re-opens the
  // panel, OR the user's last-used preset was restored from storage
  // but they've since cleared the date in Settings). Without this,
  // the chip would stay visually active but resolve to "no filter"
  // via the defensive fallback in `resolveRange` — which would
  // silently flip the user back to a full-history export. Snapping
  // the preset back to "all" keeps the visible state honest.
  //
  // Gated on `lastAppointmentLoaded` so we don't race the async
  // fetch on mount and downgrade a freshly-restored "lastAppointment"
  // preset before we even know whether the date is set (Task #98).
  useEffect(() => {
    if (!lastAppointmentLoaded) return;
    if (rangePreset === "lastAppointment" && !lastAppointment) {
      setRangePreset("all");
    }
  }, [rangePreset, lastAppointment, lastAppointmentLoaded]);

  // Read the user's ICR + CF directly from the user_settings row
  // instead of going through fetchInsulinSettings() — that helper
  // transparently substitutes DEFAULT_INSULIN_SETTINGS values (15
  // g/IE for ICR, 50 mg/dL/IE for CF) when the row or columns are
  // missing, which would surface default-derived values as "Aktueller
  // ICR" / "Korrekturfaktor" on the report and could mislead a
  // clinician reading the export. Querying the columns directly lets
  // us treat null/missing as "not configured" and suppress each
  // annotation independently.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_settings")
        .select("icr_g_per_unit, cf_mgdl_per_unit")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      // Only annotate when each value is explicitly set AND positive —
      // a missing row, null column, or non-positive value all collapse
      // to null so the export omits that field cleanly. ICR and CF are
      // independent: one can be configured while the other isn't.
      const rawIcr = data?.icr_g_per_unit;
      setIcrGperIE(
        typeof rawIcr === "number" && Number.isFinite(rawIcr) && rawIcr > 0
          ? rawIcr
          : null,
      );
      const rawCf = data?.cf_mgdl_per_unit;
      setCfMgdlPerIE(
        typeof rawCf === "number" && Number.isFinite(rawCf) && rawCf > 0
          ? rawCf
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-count whenever the picker changes. Uses the same `resolveRange`
  // helper as the export buttons, so the preview cannot drift from
  // what the export actually produces (same `from`/`to` window, same
  // per-table column bound). The `cancelled` guard drops stale
  // responses if the user clicks through several presets in quick
  // succession before the previous count finishes — only the most
  // recent picker state survives.
  //
  // Errors swallow to a 0/0/0/0 result via the count helpers themselves;
  // we don't surface a separate error state for the preview because a
  // missing count line is much less alarming than a red banner under
  // a perfectly working export panel. The actual export still throws
  // and flashes if it fails.
  useEffect(() => {
    let cancelled = false;
    setCountsLoading(true);
    // Thread `lastAppointment` into resolveRange so the live count
    // reflects the saved-appointment chip too — without it the chip
    // would silently fall through resolveRange's "lastAppointment"
    // branch with a `null` argument and degrade to "all", showing
    // an inflated count vs what the export would actually emit.
    const { window } = resolveRange(rangePreset, customFrom, customTo, lastAppointment);
    countAllInWindow(window)
      .then((next) => {
        if (cancelled) return;
        setCounts(next);
      })
      .catch(() => {
        // The count helpers already collapse Supabase errors to 0, so
        // a real throw here would be an unexpected runtime failure
        // (e.g. network rejection before reaching supabase). Fall back
        // to a zero-count snapshot so the UI shows the empty-state hint
        // rather than getting stuck on the "Zähle…" spinner forever.
        if (cancelled) return;
        setCounts({ meals: 0, insulin: 0, exercise: 0, fingersticks: 0 });
      })
      .finally(() => {
        if (cancelled) return;
        setCountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rangePreset, customFrom, customTo, lastAppointment]);

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function exportKind(kind: ExportRowKind) {
    setBusy(kind);
    setMsg(null);
    try {
      const stamp = todayStamp();
      // Resolve the picker once per export so a single user click
      // produces one consistent window across the fetch + filename.
      const { window } = resolveRange(rangePreset, customFrom, customTo, lastAppointment);
      const suffix = rangeFilenameSuffix(window);
      let count = 0;
      if (kind === "meals") {
        const rows = await fetchAllMeals(window);
        count = rows.length;
        downloadFile(`glev-mahlzeiten_${stamp}${suffix}.csv`, mealsToCSV(rows, carbUnit));
      } else if (kind === "insulin") {
        const rows = await fetchAllInsulinLogs(window);
        count = rows.length;
        downloadFile(
          `glev-insulin_${stamp}${suffix}.csv`,
          insulinToCSV(rows, { carbUnit, icrGperIE, cfMgdlPerIE }),
        );
      } else if (kind === "exercise") {
        const rows = await fetchAllExerciseLogs(window);
        count = rows.length;
        downloadFile(`glev-sport_${stamp}${suffix}.csv`, exerciseToCSV(rows));
      } else if (kind === "fingersticks") {
        const rows = await fetchAllFingersticks(window);
        count = rows.length;
        downloadFile(`glev-fingersticks_${stamp}${suffix}.csv`, fingersticksToCSV(rows));
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
      const { window } = resolveRange(rangePreset, customFrom, customTo, lastAppointment);
      const suffix = rangeFilenameSuffix(window);
      const [meals, insulin, exercise, fs] = await Promise.all([
        fetchAllMeals(window),
        fetchAllInsulinLogs(window),
        fetchAllExerciseLogs(window),
        fetchAllFingersticks(window),
      ]);
      // Defense-in-depth against the race window between the picker
      // changing and the count preview re-resolving: the disabled
      // attribute on the button blocks the common case, but a
      // programmatic trigger (test, devtools, screen-reader shortcut
      // bypassing visual state) could still slip through and produce
      // four empty CSVs. Re-check using the actual fetched data and
      // bail with a friendly message in that case.
      if (meals.length + insulin.length + exercise.length + fs.length === 0) {
        flash("err", t("count_empty"));
        return;
      }
      // Sequential downloads with small delay so browsers don't merge or
      // drop the rapid-fire save prompts.
      const files: Array<[string, string]> = [
        [`glev-mahlzeiten_${stamp}${suffix}.csv`,   mealsToCSV(meals, carbUnit)],
        [`glev-insulin_${stamp}${suffix}.csv`,      insulinToCSV(insulin, { carbUnit, icrGperIE, cfMgdlPerIE })],
        [`glev-sport_${stamp}${suffix}.csv`,        exerciseToCSV(exercise)],
        [`glev-fingersticks_${stamp}${suffix}.csv`, fingersticksToCSV(fs)],
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
      const { window, display } = resolveRange(rangePreset, customFrom, customTo, lastAppointment);
      const suffix = rangeFilenameSuffix(window);
      const [meals, insulin, exercise, fs] = await Promise.all([
        fetchAllMeals(window),
        fetchAllInsulinLogs(window),
        fetchAllExerciseLogs(window),
        fetchAllFingersticks(window),
      ]);
      // Defense-in-depth (see exportAll above): even with the disabled
      // button as the primary guard, a race between picker change and
      // count refresh — or a programmatic invocation that bypassed
      // visual state — could still trigger this handler with an empty
      // window. Bail before paying the ~400KB renderer import cost
      // and handing the user a one-page PDF with no content.
      if (meals.length + insulin.length + exercise.length + fs.length === 0) {
        flash("err", t("count_empty"));
        return;
      }
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
          cfMgdlPerIE={cfMgdlPerIE}
          range={display}
        />,
      ).toBlob();

      // Re-use the same download mechanism but skip the BOM (PDF is
      // binary). Use the Blob directly via object URL.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `glev-bericht_${todayStamp()}${suffix}.pdf`;
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

  // Whether the currently chosen range resolves to *zero* total entries
  // across all four kinds. We only treat the range as empty once the
  // count preview has actually loaded — otherwise a fresh page render
  // (counts === null while the first request is in flight) would briefly
  // disable the bulk buttons and look broken. The picker's count line
  // already tells the user the slice is empty; this flag closes the loop
  // by also disabling the bulk export actions so a user who ignores that
  // small note can't hand a doctor a one-page PDF (or four blank CSVs)
  // with no data. Per-kind rows stay enabled — exporting a single empty
  // CSV is a niche but valid action (e.g. "I want a header-only file as
  // a template"), and the count line right above already shows zero.
  const isEmptyRange =
    counts !== null &&
    !countsLoading &&
    counts.meals + counts.insulin + counts.exercise + counts.fingersticks === 0;
  // Tooltip text shown on the disabled bulk-export buttons. Reuses the
  // same translation as the count line above so the wording stays in
  // sync between the two empty-state surfaces.
  const emptyRangeTooltip = t("count_empty");

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

      {/* Date-range picker — controls which slice of the user's
          history all four fetchers (and the PDF cover) will use.
          Sits above the per-kind rows so it visually scopes them
          all, the same way "Filter" chips on a list scope the
          rows beneath. */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", marginBottom: 4 }}>
          {t("range_label")}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.5 }}>
          {t("range_help")}
        </div>
        {/* Preset chips. Render with the same chip pattern used
            elsewhere in the app (rounded pill, accent-on-active,
            quiet border-only otherwise) so the picker reads as a
            familiar control instead of a one-off.
            The "lastAppointment" chip only renders when the user has
            saved a date in Settings — keeps the chip row compact for
            the most common case (no appointment date set), and the
            chip's label reads "Seit letztem Arzttermin (12.01.2026)"
            so the user can see at a glance which date the export
            will start from. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(() => {
            const presets: Array<{ key: RangePreset; label: string }> = [
              { key: "all", label: t("range_all") },
              { key: "30d", label: t("range_30d") },
              { key: "90d", label: t("range_90d") },
            ];
            if (lastAppointment) {
              // Format the saved date in the user's UI locale so a
              // German user sees "12.01.2026" and an English user
              // sees "Jan 12, 2026" — same value, no time component.
              // Append (date) to the chip label so the user can
              // verify it before clicking.
              const formatted = new Date(`${lastAppointment}T00:00:00`).toLocaleDateString(
                bcp47,
                { year: "numeric", month: "2-digit", day: "2-digit" },
              );
              presets.push({
                key: "lastAppointment",
                label: t("range_last_appointment", { date: formatted }),
              });
            }
            presets.push({ key: "custom", label: t("range_custom") });
            return presets.map((p) => {
              const active = rangePreset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setRangePreset(p.key)}
                  disabled={busy !== null}
                  style={{
                    padding: "7px 13px",
                    borderRadius: 999,
                    border: `1px solid ${active ? ACCENT : BORDER}`,
                    background: active ? `${ACCENT}20` : "var(--surface-soft)",
                    color: active ? ACCENT : "var(--text-strong)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: busy !== null ? "not-allowed" : "pointer",
                    opacity: busy !== null ? 0.6 : 1,
                  }}
                >
                  {p.label}
                </button>
              );
            });
          })()}
        </div>

        {/* Custom from/to inputs — only shown when the picker is in
            "custom" mode so the panel stays compact for the common
            preset case. Either side may be left blank for an open
            window (e.g. "since X"). */}
        {rangePreset === "custom" && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 12,
            marginTop: 12, alignItems: "flex-end",
          }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-dim)" }}>
              {t("range_from")}
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                disabled={busy !== null}
                style={{
                  padding: "8px 10px", borderRadius: 8,
                  border: `1px solid ${BORDER}`,
                  background: "var(--surface-soft)",
                  color: "var(--text-strong)",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-dim)" }}>
              {t("range_to")}
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                disabled={busy !== null}
                style={{
                  padding: "8px 10px", borderRadius: 8,
                  border: `1px solid ${BORDER}`,
                  background: "var(--surface-soft)",
                  color: "var(--text-strong)",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
            </label>
          </div>
        )}

        {/* Live count preview — shows how many rows the chosen range
            will pull (per kind), so the user can confirm the slice
            before clicking export. Updates whenever the preset or
            custom dates change. Stays inside the picker card so it
            visually reads as a confirmation of the controls above
            rather than a separate widget. */}
        <div
          aria-live="polite"
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.5,
            minHeight: 16,
          }}
        >
          {countsLoading || counts === null ? (
            <span style={{ opacity: 0.7 }}>{t("count_loading")}</span>
          ) : counts.meals + counts.insulin + counts.exercise + counts.fingersticks === 0 ? (
            <span style={{ color: "var(--text-muted)" }}>{t("count_empty")}</span>
          ) : (
            <span>
              {[
                counts.meals        > 0 ? t("count_meals",        { n: counts.meals })        : null,
                counts.insulin      > 0 ? t("count_insulin",      { n: counts.insulin })      : null,
                counts.exercise     > 0 ? t("count_exercise",     { n: counts.exercise })     : null,
                counts.fingersticks > 0 ? t("count_fingersticks", { n: counts.fingersticks }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {t("count_summary_suffix")}
            </span>
          )}
        </div>
      </div>

      {/* Per-kind rows */}
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        {ROWS.map((row, i) => {
          // Per-row count from the same `counts` snapshot that drives
          // the summary line above. Treat both the initial-load case
          // (`counts === null`) AND any in-flight refresh after a
          // picker change (`countsLoading === true`) as "unknown" —
          // we keep the previous `counts` value around between
          // fetches so the summary line above doesn't blink, but
          // surfacing it down here as a button label/disabled state
          // would mean the row could briefly claim "(8)" / be
          // clickable while the *new* range is actually empty (or
          // vice-versa). Falling back to the bare "CSV" label until
          // the new count lands keeps the per-row UI honest.
          const rowCount = countsLoading || !counts ? null : counts[row.kind];
          const isBusy   = busy === row.kind;
          // Treat a known-zero count as "nothing to export" and lock
          // the button so a click can't produce an empty CSV. Rows
          // whose count is still loading stay enabled — same UX as
          // before the count was wired in.
          const isEmpty  = rowCount === 0;
          const disabled = busy !== null || isEmpty;
          // Dim the whole row (icon + label + button) when its count
          // is zero so the user can scan the list and immediately see
          // which kinds are worth a click. Skipped while any export
          // is running so the global busy-state styling on the button
          // stays the visually dominant signal.
          const rowDim   = isEmpty && busy === null;
          return (
            <div
              key={row.kind}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "16px 18px",
                borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
                opacity: rowDim ? 0.55 : 1,
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
                disabled={disabled}
                style={{
                  padding: "8px 14px", borderRadius: 9, border: `1px solid ${BORDER}`,
                  background: "var(--surface-soft)",
                  color: isBusy || isEmpty ? "var(--text-dim)" : "var(--text-strong)",
                  fontSize: 12, fontWeight: 600,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: busy !== null && !isBusy ? 0.45 : 1,
                  whiteSpace: "nowrap", flexShrink: 0,
                }}
              >
                {isBusy
                  ? t("csv_busy")
                  : rowCount !== null
                    ? `${t("csv_btn")} (${rowCount})`
                    : t("csv_btn")}
              </button>
            </div>
          );
        })}
      </div>

      {/* Bulk actions: CSV-all + PDF report side by side.
          Both buttons surface the *combined* total across all four
          kinds in parens (same `counts` snapshot the per-kind rows
          use), so the user can confirm bundle size before triggering
          four save-as prompts or building a multi-page PDF. We mirror
          the per-row behaviour: while a fresh count is in flight we
          drop the suffix instead of showing a stale number, and a
          known-zero total locks both buttons + dims them so an empty
          export can't be requested. The busy label keeps replacing
          the count during an in-flight export, same as the per-kind
          rows.

          The empty-range protection (disabled + tooltip + neutral
          styling) reuses the existing `isEmptyRange` / `emptyRangeTooltip`
          from above so wording and behaviour stay in sync with the
          count line. `isEmptyRange` already accounts for the loading
          state, so it serves the same role as a local `bulkEmpty`
          would. */}
      {(() => {
        const bulkTotal = countsLoading || !counts
          ? null
          : counts.meals + counts.insulin + counts.exercise + counts.fingersticks;
        const bulkDisabled = busy !== null || isEmptyRange;
        const bulkDim      = isEmptyRange && busy === null;
        const bulkTitle    = isEmptyRange ? emptyRangeTooltip : undefined;
        const allLabel = busy === "all"
          ? t("all_btn_busy")
          : bulkTotal !== null
            ? `${t("all_btn_idle")} (${bulkTotal})`
            : t("all_btn_idle");
        const pdfLabel = busy === "pdf"
          ? t("pdf_btn_busy")
          : bulkTotal !== null
            ? `${t("pdf_btn_idle")} (${bulkTotal})`
            : t("pdf_btn_idle");
        return (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={exportAll}
              disabled={bulkDisabled}
              title={bulkTitle}
              aria-disabled={bulkDisabled}
              style={{
                flex: "1 1 200px",
                padding: "14px", borderRadius: 12,
                border: `1px solid ${BORDER}`,
                background: "var(--surface-soft)",
                color: busy === "all" || isEmptyRange ? "var(--text-dim)" : "var(--text-strong)",
                fontSize: 13, fontWeight: 600,
                cursor: bulkDisabled ? "not-allowed" : "pointer",
                opacity: bulkDim ? 0.55 : (busy !== null && busy !== "all" ? 0.5 : 1),
              }}
            >
              {allLabel}
            </button>
            <button
              onClick={exportPdf}
              disabled={bulkDisabled}
              title={bulkTitle}
              aria-disabled={bulkDisabled}
              style={{
                flex: "1 1 200px",
                padding: "14px", borderRadius: 12,
                // When the range is empty, drop the gradient + accent
                // border-less look so the PDF button visually reads as
                // inactive (matches the "Alles als CSV" disabled state).
                // Without this the bright blue gradient would still
                // scream "press me" even though the click is a no-op.
                border: isEmptyRange ? `1px solid ${BORDER}` : "none",
                background: busy === "pdf"
                  ? `${ACCENT}40`
                  : isEmptyRange
                    ? "var(--surface-soft)"
                    : `linear-gradient(135deg, ${ACCENT}, #3B5BE0)`,
                color: isEmptyRange ? "var(--text-dim)" : "var(--text)",
                fontSize: 14, fontWeight: 700,
                cursor: bulkDisabled ? "not-allowed" : "pointer",
                boxShadow: busy === null && !isEmptyRange ? `0 4px 18px ${ACCENT}30` : "none",
                opacity: bulkDim ? 0.55 : (busy !== null && busy !== "pdf" ? 0.5 : 1),
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="9" y1="13" x2="15" y2="13"/>
                <line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
              {pdfLabel}
            </button>
          </div>
        );
      })()}

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

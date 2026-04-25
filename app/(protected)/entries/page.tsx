"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { fetchMeals, deleteMeal, updateMealReadings, type Meal } from "@/lib/meals";
import { fetchRecentInsulinLogs, deleteInsulinLog, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, deleteExerciseLog, type ExerciseLog } from "@/lib/exercise";
import { evaluateExercise, exerciseTypeLabel, patternNote, interimMessage, finalMessage, deltaColor } from "@/lib/exerciseEval";
import {
  evaluateBolus,
  bolusInterimMessage,
  bolusFinalMessage,
  bolusDeltaColor,
  bolusPendingLabel,
} from "@/lib/insulinEval";
import CgmSparkline, { type SparklinePoint } from "@/components/CgmSparkline";
import { TYPE_COLORS, TYPE_LABELS, TYPE_EXPLAIN, getEvalColor, getEvalLabel, getEvalExplain } from "@/lib/mealTypes";
import { lifecycleFor, STATE_LABELS, type OutcomeState } from "@/lib/engine/lifecycle";
import MealEntryCardCollapsed from "@/components/MealEntryCardCollapsed";
import ManualEntryModal from "@/components/ManualEntryModal";
import { parseDbDate, parseDbTs, parseLluTs } from "@/lib/time";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const PURPLE="#A78BFA", BLUE="#3B82F6";
const SURFACE="#111117", BORDER="rgba(255,255,255,0.08)";

function evC(ev: string|null) { return getEvalColor(ev); }
function evL(ev: string|null) { return getEvalLabel(ev); }

// Multi-select filter sections. Selections are AND-ed across sections; OR-ed
// within a section. Meal-kind / outcome implicitly restrict to meal rows;
// exercise-kind implicitly restricts to exercise rows.
type EntryTypeKey   = "meal" | "bolus" | "basal" | "exercise";
type MealKindKey    = "FAST_CARBS" | "HIGH_PROTEIN" | "HIGH_FAT" | "BALANCED";
type ExerciseKindKey = "cardio" | "hypertrophy";
type OutcomeKey     = "GOOD" | "UNDERDOSE" | "OVERDOSE" | "SPIKE";
type DateRangeKey   = "all" | "today" | "7d" | "30d" | "custom";

interface FilterState {
  entryType:    EntryTypeKey[];
  mealKind:     MealKindKey[];
  exerciseKind: ExerciseKindKey[];
  outcome:      OutcomeKey[];
  dateRange:    DateRangeKey;
  dateFrom:     string | null; // YYYY-MM-DD, only used when dateRange === "custom"
  dateTo:       string | null; // YYYY-MM-DD, only used when dateRange === "custom"
}

const EMPTY_FILTERS: FilterState = {
  entryType: [], mealKind: [], exerciseKind: [], outcome: [],
  dateRange: "all", dateFrom: null, dateTo: null,
};

const ENTRY_TYPE_OPTIONS: { value: EntryTypeKey; label: string }[] = [
  { value: "meal",     label: "Meal" },
  { value: "bolus",    label: "Bolus" },
  { value: "basal",    label: "Basal" },
  { value: "exercise", label: "Exercise" },
];
const MEAL_KIND_OPTIONS: { value: MealKindKey; label: string }[] = [
  { value: "FAST_CARBS",   label: "Fast Carbs" },
  { value: "HIGH_PROTEIN", label: "High Protein" },
  { value: "HIGH_FAT",     label: "High Fat" },
  { value: "BALANCED",     label: "Balanced" },
];
const EXERCISE_KIND_OPTIONS: { value: ExerciseKindKey; label: string }[] = [
  { value: "cardio",      label: "Cardio" },
  { value: "hypertrophy", label: "Hypertrophy" },
];
const OUTCOME_OPTIONS: { value: OutcomeKey; label: string }[] = [
  { value: "GOOD",      label: "Good" },
  { value: "UNDERDOSE", label: "Under Dose" },
  { value: "OVERDOSE",  label: "Over Dose" },
  { value: "SPIKE",     label: "Spike" },
];
const DATE_RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: "all",    label: "All time" },
  { value: "today",  label: "Today" },
  { value: "7d",     label: "Last 7 days" },
  { value: "30d",    label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];
const DATE_RANGE_VALUES: readonly DateRangeKey[] = DATE_RANGE_OPTIONS.map(o => o.value);

// Returns inclusive [startMs, endMs] for the chosen range relative to `now`.
// Returns null when no date filter applies (i.e. "all", or "custom" without a
// usable bound on either side).
function dateRangeBounds(
  range: DateRangeKey,
  from: string | null,
  to: string | null,
  now: Date = new Date(),
): { startMs: number; endMs: number } | null {
  if (range === "all") return null;
  if (range === "today") {
    const s = new Date(now); s.setHours(0,0,0,0);
    const e = new Date(now); e.setHours(23,59,59,999);
    return { startMs: s.getTime(), endMs: e.getTime() };
  }
  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    const e = new Date(now); e.setHours(23,59,59,999);
    const s = new Date(now); s.setHours(0,0,0,0);
    s.setDate(s.getDate() - (days - 1));
    return { startMs: s.getTime(), endMs: e.getTime() };
  }
  // custom
  const startMs = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const endMs   = to   ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
  if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

// Human-readable label for the active date range, used by the empty-state hint
// when the date filter is the likely cause of an empty result.
function dateRangeSummary(
  range: DateRangeKey,
  from: string | null,
  to: string | null,
): string {
  if (range === "today") return "Today";
  if (range === "7d")    return "Last 7 days";
  if (range === "30d")   return "Last 30 days";
  if (range === "custom") {
    const fmt = (s: string) => {
      const d = new Date(`${s}T00:00:00`);
      if (Number.isNaN(d.getTime())) return s;
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    if (from && to)  return `${fmt(from)} – ${fmt(to)}`;
    if (from)        return `from ${fmt(from)}`;
    if (to)          return `until ${fmt(to)}`;
    return "Custom range";
  }
  return "All time";
}

const FILTERS_STORAGE_KEY = "glev:entries-filters";
const LEGACY_FILTER_KEY   = "glev:entries-filter";

function totalActive(f: FilterState) {
  return f.entryType.length + f.mealKind.length + f.exerciseKind.length + f.outcome.length
    + (f.dateRange !== "all" ? 1 : 0);
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;
function pickDateStr(v: unknown): string | null {
  return typeof v === "string" && DATE_STR_RE.test(v) ? v : null;
}

function parseStoredFilters(raw: string | null): FilterState {
  if (!raw) return EMPTY_FILTERS;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_FILTERS;
    const pickArr = <T extends string>(input: unknown, allowed: readonly T[]): T[] => {
      if (!Array.isArray(input)) return [];
      const set = new Set(allowed as readonly string[]);
      return input.filter((v): v is T => typeof v === "string" && set.has(v));
    };
    const dateRange: DateRangeKey =
      typeof parsed.dateRange === "string" && (DATE_RANGE_VALUES as readonly string[]).includes(parsed.dateRange)
        ? parsed.dateRange as DateRangeKey
        : "all";
    return {
      entryType:    pickArr<EntryTypeKey>(parsed.entryType,       ENTRY_TYPE_OPTIONS.map(o => o.value)),
      mealKind:     pickArr<MealKindKey>(parsed.mealKind,         MEAL_KIND_OPTIONS.map(o => o.value)),
      exerciseKind: pickArr<ExerciseKindKey>(parsed.exerciseKind, EXERCISE_KIND_OPTIONS.map(o => o.value)),
      outcome:      pickArr<OutcomeKey>(parsed.outcome,           OUTCOME_OPTIONS.map(o => o.value)),
      dateRange,
      dateFrom:     dateRange === "custom" ? pickDateStr(parsed.dateFrom) : null,
      dateTo:       dateRange === "custom" ? pickDateStr(parsed.dateTo)   : null,
    };
  } catch {
    return EMPTY_FILTERS;
  }
}

type Row =
  | { kind: "meal"; id: string; ts: string; data: Meal }
  | { kind: "bolus"; id: string; ts: string; data: InsulinLog }
  | { kind: "basal"; id: string; ts: string; data: InsulinLog }
  | { kind: "exercise"; id: string; ts: string; data: ExerciseLog };

export default function EntriesPage() {
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [insulin, setInsulin] = useState<InsulinLog[]>([]);
  const [exercise, setExercise] = useState<ExerciseLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch]   = useState("");
  const [expanded, setExpanded] = useState<string|null>(null);
  const [deleting, setDeleting] = useState<string|null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const filtersWrapRef = useRef<HTMLDivElement>(null);

  // Restore filters from sessionStorage (per-tab persistence) on first mount.
  // Old single-string values from the previous chip-bar shape are discarded.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
    setFilters(parseStoredFilters(raw));
    // One-time cleanup of the legacy key so it doesn't linger forever.
    if (sessionStorage.getItem(LEGACY_FILTER_KEY) != null) {
      sessionStorage.removeItem(LEGACY_FILTER_KEY);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  // Close the filter panel on outside click or Escape.
  useEffect(() => {
    if (!filtersOpen) return;
    function onDown(e: MouseEvent) {
      if (!filtersWrapRef.current) return;
      if (!filtersWrapRef.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  type ListSection = "entryType" | "mealKind" | "exerciseKind" | "outcome";
  function toggleFilter<K extends ListSection>(section: K, value: FilterState[K][number]) {
    setFilters(prev => {
      const list = prev[section] as string[];
      const has = list.includes(value as string);
      const next = has ? list.filter(v => v !== value) : [...list, value as string];
      return { ...prev, [section]: next } as FilterState;
    });
  }
  function setDateRange(value: DateRangeKey) {
    setFilters(prev => {
      // Switching away from "custom" clears the custom bounds; switching to
      // "custom" keeps any previously-entered values so users don't lose them
      // when toggling back.
      if (value !== "custom") return { ...prev, dateRange: value, dateFrom: null, dateTo: null };
      return { ...prev, dateRange: value };
    });
  }
  function setDateBound(side: "from" | "to", value: string) {
    setFilters(prev => ({
      ...prev,
      dateRange: "custom",
      dateFrom: side === "from" ? (value || null) : prev.dateFrom,
      dateTo:   side === "to"   ? (value || null) : prev.dateTo,
    }));
  }
  function clearAllFilters() {
    setFilters(EMPTY_FILTERS);
  }
  const activeCount = totalActive(filters);

  // Meal rows expand directly into the full detail body (no intermediate
  // "light" summary). Bolus / basal / exercise rows have their own
  // collapsed→expanded body rendered by their respective row components.
  function expandRow(id: string | null) {
    setExpanded(id);
  }

  useEffect(() => {
    let cancelled = false;
    async function load(initial: boolean) {
      try {
        const [m, ins, ex] = await Promise.all([
          fetchMeals(),
          fetchRecentInsulinLogs(60).catch(() => []),
          fetchRecentExerciseLogs(60).catch(() => []),
        ]);
        if (!cancelled) {
          setMeals(m);
          setInsulin(ins);
          setExercise(ex);
        }
      } catch (e) { console.error(e); }
      finally { if (!cancelled && initial) setLoading(false); }
    }
    load(true);
    function onUpdated() { load(false); }
    window.addEventListener("glev:meals-updated", onUpdated);
    window.addEventListener("glev:insulin-updated", onUpdated);
    window.addEventListener("glev:exercise-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("glev:meals-updated", onUpdated);
      window.removeEventListener("glev:insulin-updated", onUpdated);
      window.removeEventListener("glev:exercise-updated", onUpdated);
    };
  }, []);

  // Deep-link via URL hash: /entries#<id> auto-expands to the full view so
  // "View full entry →" from the dashboard lands the user on the right row.
  useEffect(() => {
    const id = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!id || meals.length === 0) return;
    if (meals.some(m => m.id === id)) {
      setExpanded(id);
      requestAnimationFrame(() => {
        document.getElementById(`entry-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [meals]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteMeal(id);
      setMeals(ms => ms.filter(m => m.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteInsulin(id: string) {
    if (!confirm("Delete this insulin entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteInsulinLog(id);
      setInsulin(xs => xs.filter(x => x.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally { setDeleting(null); }
  }

  async function handleDeleteExercise(id: string) {
    if (!confirm("Delete this exercise entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteExerciseLog(id);
      setExercise(xs => xs.filter(x => x.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally { setDeleting(null); }
  }

  // Merge meal/bolus/basal/exercise into a single timeline (newest first).
  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      ...meals.map<Row>(m => ({ kind: "meal", id: m.id, ts: m.meal_time ?? m.created_at, data: m })),
      ...insulin.map<Row>(i => ({ kind: i.insulin_type, id: i.id, ts: i.created_at, data: i })),
      ...exercise.map<Row>(x => ({ kind: "exercise", id: x.id, ts: x.created_at, data: x })),
    ];
    all.sort((a, b) => parseDbTs(b.ts) - parseDbTs(a.ts));
    return all;
  }, [meals, insulin, exercise]);

  // Memoize to keep the bounds stable across re-renders within the same render
  // cycle and to recompute when the user changes the date filter.
  const dateBounds = useMemo(
    () => dateRangeBounds(filters.dateRange, filters.dateFrom, filters.dateTo),
    [filters.dateRange, filters.dateFrom, filters.dateTo],
  );

  const filtered = rows.filter(r => {
    // Date range — same AND-across-sections rule as the other filters.
    if (dateBounds) {
      const t = parseDbTs(r.ts);
      if (Number.isNaN(t)) return false;
      if (t < dateBounds.startMs || t > dateBounds.endMs) return false;
    }

    // Entry-type — restricts by row kind directly.
    if (filters.entryType.length > 0 && !filters.entryType.includes(r.kind as EntryTypeKey)) return false;

    // Meal-kind — implicitly restricts to meal rows.
    if (filters.mealKind.length > 0) {
      if (r.kind !== "meal") return false;
      const mt = r.data.meal_type as MealKindKey | null;
      if (!mt || !filters.mealKind.includes(mt)) return false;
    }

    // Exercise-kind — implicitly restricts to exercise rows.
    if (filters.exerciseKind.length > 0) {
      if (r.kind !== "exercise") return false;
      const ek = r.data.exercise_type as ExerciseKindKey;
      if (!filters.exerciseKind.includes(ek)) return false;
    }

    // Outcome — implicitly restricts to meal rows.
    if (filters.outcome.length > 0) {
      if (r.kind !== "meal") return false;
      const ev = r.data.evaluation;
      const matches = filters.outcome.some(o =>
        ev === o
        || (o === "OVERDOSE"  && ev === "HIGH")
        || (o === "UNDERDOSE" && ev === "LOW")
      );
      if (!matches) return false;
    }

    // Search across whatever text the row carries
    if (search) {
      const q = search.toLowerCase();
      let txt = "";
      if (r.kind === "meal") txt = r.data.input_text ?? "";
      else if (r.kind === "bolus" || r.kind === "basal") txt = `${r.data.insulin_name} ${r.data.notes ?? ""}`;
      else if (r.kind === "exercise") txt = `${r.data.exercise_type} ${r.data.notes ?? ""}`;
      if (!txt.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const inp: React.CSSProperties = { background:"#0D0D12", border:`1px solid ${BORDER}`, borderRadius:10, padding:"9px 14px", color:"#fff", fontSize:13, outline:"none" };

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh", gap:12, color:"rgba(255,255,255,0.3)" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width:20, height:20, border:`2px solid ${ACCENT}`, borderTopColor:"transparent", borderRadius:99, animation:"spin 0.8s linear infinite" }}/>
      Loading entries…
    </div>
  );

  return (
    <div style={{ maxWidth:960, margin:"0 auto" }}>
      <style>{``}</style>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>Entry Log</h1>
        <p style={{ color:"rgba(255,255,255,0.35)", fontSize:14 }}>{filtered.length} of {rows.length} logged entries. Click a row to expand.</p>
      </div>

      {/* MANUAL ENTRY CTA */}
      <div style={{ marginBottom:14 }}>
        <button
          onClick={() => setManualOpen(true)}
          style={{
            width:"100%",
            padding:"12px 16px",
            borderRadius:12,
            border:`1px dashed ${ACCENT}55`,
            background:`${ACCENT}10`,
            color:ACCENT,
            fontSize:13, fontWeight:700, letterSpacing:"-0.01em",
            cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            transition:"all 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${ACCENT}1f`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = `${ACCENT}10`; }}
        >
          <span style={{ fontSize:18, lineHeight:1, marginTop:-1 }}>+</span>
          Mahlzeit
        </button>
      </div>

      {/* FILTERS + SEARCH */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
        <div ref={filtersWrapRef} style={{ position:"relative" }}>
          <button
            onClick={() => setFiltersOpen(v => !v)}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            style={{
              padding:"7px 14px",
              borderRadius:99,
              border:`1px solid ${activeCount > 0 ? ACCENT+"60" : BORDER}`,
              background: activeCount > 0 ? `${ACCENT}18` : "transparent",
              color: activeCount > 0 ? ACCENT : "rgba(255,255,255,0.55)",
              fontSize:12,
              fontWeight: activeCount > 0 ? 600 : 500,
              cursor:"pointer",
              display:"inline-flex", alignItems:"center", gap:8,
              whiteSpace:"nowrap",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            <span>Filters{activeCount > 0 ? ` · ${activeCount}` : ""}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: filtersOpen ? "rotate(180deg)" : "rotate(0deg)", transition:"transform 0.15s" }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {filtersOpen && (
            <div
              role="dialog"
              aria-label="Filter entries"
              style={{
                position:"absolute",
                top:"calc(100% + 8px)",
                left:0,
                zIndex:30,
                width:"min(360px, calc(100vw - 32px))",
                maxHeight:"min(70vh, 520px)",
                overflowY:"auto",
                background:SURFACE,
                border:`1px solid ${BORDER}`,
                borderRadius:14,
                boxShadow:"0 12px 32px rgba(0,0,0,0.45)",
                padding:14,
                display:"flex", flexDirection:"column", gap:14,
              }}
            >
              <DateRangeSection
                value={filters.dateRange}
                from={filters.dateFrom}
                to={filters.dateTo}
                onChange={setDateRange}
                onBoundChange={setDateBound}
              />
              <FilterSection
                title="Entry type"
                options={ENTRY_TYPE_OPTIONS}
                selected={filters.entryType}
                onToggle={(v) => toggleFilter("entryType", v)}
              />
              <FilterSection
                title="Meal kind"
                options={MEAL_KIND_OPTIONS}
                selected={filters.mealKind}
                onToggle={(v) => toggleFilter("mealKind", v)}
              />
              <FilterSection
                title="Exercise kind"
                options={EXERCISE_KIND_OPTIONS}
                selected={filters.exerciseKind}
                onToggle={(v) => toggleFilter("exerciseKind", v)}
              />
              <FilterSection
                title="Outcome"
                options={OUTCOME_OPTIONS}
                selected={filters.outcome}
                onToggle={(v) => toggleFilter("outcome", v)}
              />

              {activeCount > 0 && (
                <div style={{ display:"flex", justifyContent:"flex-end", paddingTop:4, borderTop:`1px solid ${BORDER}` }}>
                  <button
                    onClick={clearAllFilters}
                    style={{
                      marginTop:8,
                      padding:"7px 14px",
                      borderRadius:99,
                      border:`1px solid ${PINK}40`,
                      background:`${PINK}10`,
                      color:PINK,
                      fontSize:12, fontWeight:600, cursor:"pointer",
                      display:"inline-flex", alignItems:"center", gap:6,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <input style={{ ...inp, width:"100%", boxSizing:"border-box" }} placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      {/* CARD STACK */}
      {filtered.length === 0 ? (
        <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"48px 24px", textAlign:"center", color:"rgba(255,255,255,0.2)", fontSize:14 }}>
          {filters.dateRange !== "all" ? (
            <>
              <div style={{ color:"rgba(255,255,255,0.55)", fontSize:14 }}>
                Showing <span style={{ color:"rgba(255,255,255,0.85)", fontWeight:600 }}>{dateRangeSummary(filters.dateRange, filters.dateFrom, filters.dateTo)}</span> · no entries match.
              </div>
              <button
                onClick={() => setDateRange("all")}
                style={{
                  marginTop:14,
                  padding:"7px 14px",
                  borderRadius:99,
                  border:`1px solid ${ACCENT}60`,
                  background:`${ACCENT}18`,
                  color:ACCENT,
                  fontSize:12, fontWeight:600, cursor:"pointer",
                  display:"inline-flex", alignItems:"center", gap:6,
                }}
              >
                Switch to All time
              </button>
            </>
          ) : (
            "No entries match this filter."
          )}
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {filtered.map(r => {
            // BOLUS row — insulin event with 5-state outcome badge.
            if (r.kind === "bolus") {
              const i = r.data;
              const isOpen = expanded === i.id;
              return (
                <BolusRowCard
                  key={i.id}
                  log={i}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : i.id)}
                  onDelete={() => handleDeleteInsulin(i.id)}
                  deleting={deleting === i.id}
                />
              );
            }
            // BASAL row — insulin event with 6h CGM trend, no outcome badge.
            if (r.kind === "basal") {
              const i = r.data;
              const isOpen = expanded === i.id;
              return (
                <BasalRowCard
                  key={i.id}
                  log={i}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : i.id)}
                  onDelete={() => handleDeleteInsulin(i.id)}
                  deleting={deleting === i.id}
                />
              );
            }
            // EXERCISE row.
            if (r.kind === "exercise") {
              const x = r.data;
              const isOpen = expanded === x.id;
              return (
                <ExerciseRowCard
                  key={x.id}
                  log={x}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : x.id)}
                  onDelete={() => handleDeleteExercise(x.id)}
                  deleting={deleting === x.id}
                />
              );
            }
            // MEAL row — original rendering preserved below.
            const m = r.data;
            const isOpen = expanded === m.id;
            const ev = m.evaluation;
            const date = parseDbDate(m.meal_time ?? m.created_at);
            const dateStr = date.toLocaleDateString("en", { month:"short", day:"numeric" }).replace(/^(\w+) (\d+)$/, "$2. $1.");
            const totalProt = m.protein_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.protein||0),0) : 0);
            const totalFat  = m.fat_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fat||0),0) : 0);
            const totalFiber = m.fiber_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fiber||0),0) : 0);
            const carbs = m.carbs_grams ?? 0;
            const netCarbs = Math.max(0, carbs - totalFiber);
            const icr = m.insulin_units && m.insulin_units > 0 ? netCarbs / m.insulin_units : null;
            const glucDelta = (m.glucose_after && m.glucose_before) ? m.glucose_after - m.glucose_before : null;
            const bgC = m.glucose_before ? (m.glucose_before > 140 ? ORANGE : m.glucose_before < 80 ? PINK : GREEN) : "rgba(255,255,255,0.7)";
            const afterC = m.glucose_after ? (m.glucose_after > 180 || m.glucose_after < 70 ? PINK : GREEN) : "rgba(255,255,255,0.3)";
            const deltaC = glucDelta !== null ? (Math.abs(glucDelta) < 50 ? GREEN : glucDelta > 0 ? ORANGE : PINK) : "rgba(255,255,255,0.3)";
            const evColor = evC(ev);

            const MiniCard = ({ l, v, c }: { l: string; v: string; c?: string }) => (
              <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:14, fontWeight:700, color:c || "rgba(255,255,255,0.9)", letterSpacing:"-0.01em" }}>{v}</div>
              </div>
            );

            const catColor = m.meal_type ? (TYPE_COLORS[m.meal_type] || GREEN) : null;
            const catLabel = m.meal_type ? (TYPE_LABELS[m.meal_type] || m.meal_type.replace("_"," ")) : null;
            const catExplain = m.meal_type ? (TYPE_EXPLAIN[m.meal_type] || "") : "";

            return (
              <div key={m.id} id={`entry-${m.id}`} className="entry-row" style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
                {/* Header — collapsed shows summary; expanded shows only date + time */}
                {!isOpen ? (
                  <MealEntryCardCollapsed meal={m} onClick={() => expandRow(m.id)}/>
                ) : (
                  <div onClick={() => expandRow(null)} style={{ padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", letterSpacing:"0.02em" }}>
                      {dateStr}
                      <span style={{ color:"rgba(255,255,255,0.25)", margin:"0 8px" }}>·</span>
                      {date.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" })}
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:"rotate(90deg)", transition:"transform 0.2s", flexShrink:0 }}>
                      <polyline points="9 6 15 12 9 18"/>
                    </svg>
                  </div>
                )}

                {/* Full entry body — shown directly on expand (no light intermediate). */}
                {isOpen && (
                  <div style={{ padding:"4px 16px 16px", borderTop:`1px solid rgba(255,255,255,0.04)`, display:"flex", flexDirection:"column", gap:14 }}>
                    {/* LIFECYCLE — pending / provisional / final */}
                    <LifecycleBlock
                      meal={m}
                      onUpdated={(patch) => setMeals(ms => ms.map(x => x.id === m.id ? { ...x, ...patch } : x))}
                    />
                    {/* OUTCOME — highlighted card */}
                    {ev && (
                      <div style={{ marginTop:14, background:`${evColor}10`, border:`1px solid ${evColor}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                          <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>OUTCOME</div>
                          <span style={{ padding:"6px 14px", borderRadius:99, fontSize:11, fontWeight:700, background:evColor, color:"#0A0A0F", whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                            {evL(ev)}
                          </span>
                        </div>
                        {getEvalExplain(ev) && (
                          <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.5 }}>{getEvalExplain(ev)}</div>
                        )}
                      </div>
                    )}

                    {/* CLASSIFICATION — highlighted card with explanation */}
                    {catLabel && catColor && (
                      <div style={{ background:`${catColor}10`, border:`1px solid ${catColor}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                          <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>MEAL CLASSIFICATION</div>
                          <span style={{ padding:"6px 14px", borderRadius:99, fontSize:11, fontWeight:700, background:catColor, color:"#0A0A0F", whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                            {catLabel}
                          </span>
                        </div>
                        {catExplain && (
                          <div style={{ fontSize:12, color:"rgba(255,255,255,0.6)", lineHeight:1.5 }}>{catExplain}</div>
                        )}
                      </div>
                    )}

                    {/* MEAL */}
                    {m.input_text && (
                      <div>
                        <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, margin:"4px 0 6px" }}>MEAL</div>
                        <div style={{ fontSize:13, color:"rgba(255,255,255,0.75)", lineHeight:1.55 }}>{m.input_text}</div>
                      </div>
                    )}

                    {/* MACROS & DOSING — 3-col grid of mini-cards */}
                    <div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>MACROS &amp; DOSING</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                        <MiniCard l="CARBS" v={`${carbs}g`} c={ORANGE}/>
                        <MiniCard l="PROTEIN" v={totalProt > 0 ? `${totalProt}g` : "—"} c="#3B82F6"/>
                        <MiniCard l="FAT" v={totalFat > 0 ? `${totalFat}g` : "—"} c="#A855F7"/>
                        <MiniCard l="FIBER" v={totalFiber > 0 ? `${totalFiber}g` : "—"}/>
                        <MiniCard l="NET CARBS" v={netCarbs > 0 ? `${netCarbs}g` : "—"} c={GREEN}/>
                        <MiniCard l="CALORIES" v={(() => { const cals = m.calories ?? Math.round(carbs*4 + totalProt*4 + totalFat*9); return cals > 0 ? `${cals} kcal` : "—"; })()} c="#A78BFA"/>
                        <MiniCard l="INSULIN" v={`${m.insulin_units ?? 0}u`} c={ACCENT}/>
                        <MiniCard l="RATIO" v={icr ? `1u/${icr.toFixed(0)}g` : "—"} c={ACCENT}/>
                        <MiniCard l="CATEGORY" v={m.meal_type ? m.meal_type.replace("_"," ").toLowerCase() : "—"} c={m.meal_type ? (TYPE_COLORS[m.meal_type] || GREEN) : undefined}/>
                      </div>
                    </div>

                    {/* GLUCOSE — 2-col grid of mini-cards */}
                    <div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>GLUCOSE</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
                        <MiniCard l="BG BEFORE" v={m.glucose_before ? `${m.glucose_before} mg/dL` : "—"} c={bgC}/>
                        <MiniCard l="BG AFTER" v={m.glucose_after ? `${m.glucose_after} mg/dL` : "—"} c={afterC}/>
                        <MiniCard l="DELTA" v={glucDelta !== null ? `${glucDelta > 0 ? "+" : ""}${glucDelta} mg/dL` : "—"} c={deltaC}/>
                        <MiniCard l="TIME GAP" v="—"/>
                      </div>
                    </div>

                    {/* DELETE */}
                    <button onClick={() => handleDelete(m.id)} disabled={deleting === m.id} style={{ marginTop:4, padding:"12px", borderRadius:10, border:`1px solid ${PINK}40`, background:`${PINK}08`, color:PINK, fontSize:13, fontWeight:600, cursor:deleting === m.id ? "wait" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, letterSpacing:"0.02em" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                      {deleting === m.id ? "Deleting…" : "Delete entry"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ManualEntryModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={(meal) => {
          // Insert into the visible list and respect the user's chosen meal
          // time when sorting (most recent first by created_at).
          setMeals((prev) => {
            const next = [meal, ...prev];
            next.sort((a, b) => parseDbTs(b.meal_time ?? b.created_at) - parseDbTs(a.meal_time ?? a.created_at));
            return next;
          });
        }}
      />
    </div>
  );
}

function Stat({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between" }}>
      <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>{label}</span>
      <span style={{ fontSize:12, fontWeight:500, color:color||"rgba(255,255,255,0.75)" }}>{val}</span>
    </div>
  );
}

function stateColor(s: OutcomeState) {
  if (s === "pending")     return "#A78BFA";
  if (s === "provisional") return ORANGE;
  return GREEN;
}

function LifecycleBlock({ meal, onUpdated }: { meal: Meal; onUpdated: (patch: Partial<Meal>) => void }) {
  const lc = lifecycleFor(meal);
  const c = stateColor(lc.state);
  const [bg1h, setBg1h] = useState<string>(meal.bg_1h?.toString() ?? "");
  const [bg2h, setBg2h] = useState<string>(meal.bg_2h?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  // Show 1h input from 30 min onwards (so user can record an early reading);
  // show 2h input from 90 min onwards.
  const show1h = lc.ageMinutes >= 30;
  const show2h = lc.ageMinutes >= 90;

  async function save(field: "bg1h" | "bg2h") {
    const raw = (field === "bg1h" ? bg1h : bg2h).trim();
    const n = raw === "" ? null : Number(raw);
    if (n != null && (!Number.isFinite(n) || n < 30 || n > 600)) {
      setErr("Enter a glucose value between 30 and 600 mg/dL.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const result = await updateMealReadings(meal.id, { [field]: n } as { bg1h?: number | null; bg2h?: number | null });
      const now = new Date().toISOString();
      // Optimistic local update — applies even when the column fell back to
      // glucose_after, so the UI reflects the new value immediately.
      if (field === "bg1h") {
        // Only persist locally if the new column was actually written.
        if (result.applied.includes("bg_1h")) {
          onUpdated({ bg_1h: n, bg_1h_at: n != null ? now : null });
        }
      } else {
        onUpdated(
          result.applied.includes("bg_2h")
            ? { bg_2h: n, bg_2h_at: n != null ? now : null }
            : { bg_2h: n, bg_2h_at: n != null ? now : null, glucose_after: n }
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save reading.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop:14, background:`${c}10`, border:`1px solid ${c}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:700 }}>OUTCOME STATE</div>
        <span style={{ padding:"6px 14px", borderRadius:99, fontSize:11, fontWeight:700, background:c, color:"#0A0A0F", letterSpacing:"0.04em", textTransform:"uppercase" }}>
          {STATE_LABELS[lc.state]}
        </span>
      </div>
      <div style={{ fontSize:12, color:"rgba(255,255,255,0.65)", lineHeight:1.5 }}>{lc.reasoning}</div>
      {(lc.delta1 != null || lc.delta2 != null) && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:2 }}>
          <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600 }}>Δ 1H</div>
            <div style={{ fontSize:13, fontWeight:700, color: lc.delta1 != null ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)" }}>
              {lc.delta1 != null ? `${lc.delta1 > 0 ? "+" : ""}${lc.delta1} mg/dL` : "—"}
              {lc.speed1 != null && <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>({lc.speed1.toFixed(2)}/min)</span>}
            </div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600 }}>Δ 2H</div>
            <div style={{ fontSize:13, fontWeight:700, color: lc.delta2 != null ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)" }}>
              {lc.delta2 != null ? `${lc.delta2 > 0 ? "+" : ""}${lc.delta2} mg/dL` : "—"}
              {lc.speed2 != null && <span style={{ fontSize:10, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>({lc.speed2.toFixed(2)}/min)</span>}
            </div>
          </div>
        </div>
      )}
      {(show1h || show2h) && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:4 }}>
          {show1h && (
            <ReadingInput label="1h reading" value={bg1h} onChange={setBg1h} onSave={() => save("bg1h")} busy={busy} placeholder={meal.bg_1h?.toString() ?? "mg/dL"} />
          )}
          {show2h && (
            <ReadingInput label="2h reading" value={bg2h} onChange={setBg2h} onSave={() => save("bg2h")} busy={busy} placeholder={meal.bg_2h?.toString() ?? "mg/dL"} />
          )}
        </div>
      )}
      {err && <div style={{ fontSize:11, color:PINK }}>{err}</div>}
    </div>
  );
}

function ReadingInput({ label, value, onChange, onSave, busy, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; onSave: () => void; busy: boolean; placeholder: string;
}) {
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", letterSpacing:"0.08em", fontWeight:600 }}>{label.toUpperCase()}</div>
      <div style={{ display:"flex", gap:6 }}>
        <input
          type="number" inputMode="numeric" min={30} max={600}
          value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSave(); } }}
          style={{ flex:1, minWidth:0, padding:"6px 8px", borderRadius:6, border:`1px solid ${BORDER}`, background:"rgba(0,0,0,0.3)", color:"rgba(255,255,255,0.9)", fontSize:13, fontWeight:600 }}
        />
        <button
          onClick={onSave} disabled={busy}
          style={{ padding:"6px 10px", borderRadius:6, border:`1px solid ${ACCENT}40`, background:`${ACCENT}18`, color:ACCENT, fontSize:11, fontWeight:700, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Non-meal row cards. Layout mirrors MealEntryCardCollapsed
// (When · Type · Dose|Duration · TypeName) but without an outcome pill,
// and with a small inline expansion showing notes + delete.
// ─────────────────────────────────────────────────────────────────────────

const INSULIN_ACCENT = ACCENT;
const BASAL_ACCENT   = "#A78BFA";
const EXERCISE_ACCENT = "#22C55E";

function NonMealRow({
  isOpen, onToggle, onDelete, deleting, accent, badge, dateStr, timeStr,
  primaryLabel, primaryValue, primaryColor,
  secondaryLabel, secondaryValue, secondaryColor, secondaryMono,
  expandedDetails,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  accent: string;
  badge: string;
  dateStr: string;
  timeStr: string;
  primaryLabel: string;
  primaryValue: string;
  primaryColor: string;
  secondaryLabel: string;
  secondaryValue: string;
  /** Optional override — defaults to neutral white. Used by the bolus/basal
   *  rows where the secondary column carries the DOSE and should keep its
   *  accent + mono treatment after the BRAND/DOSE swap. */
  secondaryColor?: string;
  secondaryMono?: boolean;
  expandedDetails: React.ReactNode;
}) {
  return (
    <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
      {!isOpen ? (
        <div onClick={onToggle} className="glev-mec" style={{
          padding:"14px 16px", cursor:"pointer", alignItems:"center",
          display:"grid", gap:14,
          gridTemplateColumns:"1fr 1fr 1fr 1fr 96px",
        }}>
          <style>{`
            @media (max-width: 720px) {
              .glev-mec { grid-template-columns: 1fr 1fr 1fr 1fr !important; gap: 10px !important; }
              .glev-mec .glev-mec-eval { display:none !important; }
            }
            @media (max-width: 380px) {
              .glev-mec { gap: 8px !important; }
            }
          `}</style>
          {/* Col 1: Date + Time */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>When</div>
            <div style={{ fontSize:13, fontWeight:600, color:"rgba(255,255,255,0.85)", letterSpacing:"-0.01em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", fontFamily:"var(--font-mono)" }}>
              {dateStr}
              <span style={{ color:"rgba(255,255,255,0.35)", fontWeight:400, marginLeft:6 }}>{timeStr}</span>
            </div>
          </div>
          {/* Col 2: Kind badge */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>Type</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
              <span style={{ width:7, height:7, borderRadius:99, background:accent, opacity:0.85, flexShrink:0 }}/>
              <span style={{ fontSize:12, fontWeight:700, color:accent, letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{badge}</span>
            </div>
          </div>
          {/* Col 3: Primary metric (Dose / Duration) */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{primaryLabel}</div>
            <div style={{ fontSize:14, fontWeight:700, color:primaryColor, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{primaryValue}</div>
          </div>
          {/* Col 4: Secondary — neutral by default; bolus/basal pass an
              accent + mono override so DOSE keeps its prominent styling. */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{secondaryLabel}</div>
            <div
              title={secondaryValue}
              style={{
                fontSize: secondaryMono ? 14 : 13,
                fontWeight: secondaryMono ? 700 : 600,
                color: secondaryColor || "rgba(255,255,255,0.8)",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontFamily: secondaryMono ? "var(--font-mono)" : undefined,
              }}
            >
              {secondaryValue}
            </div>
          </div>
          {/* Col 5: chevron */}
          <span className="glev-mec-eval" style={{
            justifySelf:"end", padding:"5px 10px", borderRadius:99, fontSize:10, fontWeight:700,
            background:`${accent}18`, color:accent, border:`1px solid ${accent}30`,
            whiteSpace:"nowrap", letterSpacing:"0.05em", textTransform:"uppercase",
          }}>{badge}</span>
        </div>
      ) : (
        <div onClick={onToggle} style={{ padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.55)", letterSpacing:"0.02em" }}>
            {dateStr}
            <span style={{ color:"rgba(255,255,255,0.25)", margin:"0 8px" }}>·</span>
            {timeStr}
            <span style={{ color:accent, fontWeight:700, marginLeft:10, letterSpacing:"0.04em" }}>{badge}</span>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:"rotate(90deg)", flexShrink:0 }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        </div>
      )}

      {isOpen && (
        <div style={{ padding:"4px 16px 16px", borderTop:`1px solid rgba(255,255,255,0.04)`, display:"flex", flexDirection:"column", gap:12 }}>
          {expandedDetails}
          <button onClick={onDelete} disabled={deleting} style={{
            marginTop:4, padding:"12px", borderRadius:10, border:`1px solid ${PINK}40`,
            background:`${PINK}08`, color:PINK, fontSize:13, fontWeight:600,
            cursor:deleting ? "wait" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, letterSpacing:"0.02em",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            {deleting ? "Deleting…" : "Delete entry"}
          </button>
        </div>
      )}
    </div>
  );
}

// ──────────────── BOLUS — full expanded view with badge ────────────────
function BolusRowCard({ log, isOpen, onToggle, onDelete, deleting }: {
  log: InsulinLog;
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
}) {
  const d = parseDbDate(log.created_at);
  const dateStr = d.toLocaleDateString("en", { month:"short", day:"numeric" });
  const timeStr = d.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });

  const accent  = INSULIN_ACCENT;
  const evalInfo = evaluateBolus(log);
  const badgeColor = evalInfo.color;

  // Glucose deltas vs the at-log baseline.
  const before = numOrNull(log.cgm_glucose_at_log);
  const at1h   = numOrNull(log.glucose_after_1h);
  const at2h   = numOrNull(log.glucose_after_2h);
  const d1h    = before != null && at1h != null ? Math.round(at1h - before) : null;
  const d2h    = before != null && at2h != null ? Math.round(at2h - before) : null;

  // Expected fetch times for "Pending · expected hh:mm".
  const expect1h = new Date(d.getTime() + 60 * 60_000);
  const expect2h = new Date(d.getTime() + 120 * 60_000);

  return (
    <NonMealRow
      isOpen={isOpen}
      onToggle={onToggle}
      onDelete={onDelete}
      deleting={deleting}
      accent={badgeColor}
      badge={evalInfo.label}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel="Brand"
      primaryValue={log.insulin_name || "rapid-acting"}
      primaryColor="rgba(255,255,255,0.85)"
      secondaryLabel="Dose"
      secondaryValue={`${log.units}u`}
      secondaryColor={accent}
      secondaryMono
      expandedDetails={
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* 1) Session details ------------------------------------ */}
          <ExPanel title="SESSION DETAILS">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label="DOSE" value={`${log.units} u`} color={accent}/>
              <Detail label="INSULIN" value={log.insulin_name || "—"}/>
              <Detail label="WHEN" value={`${dateStr} · ${timeStr}`}/>
              <Detail label="TYPE" value="Bolus"/>
            </div>
          </ExPanel>

          {/* 2) Glucose tracking ----------------------------------- */}
          <ExPanel title="GLUCOSE TRACKING">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              <Detail
                label="BG AT LOG"
                value={before != null ? `${Math.round(before)} mg/dL` : "—"}
              />
              <Detail
                label="BG +1H"
                value={at1h != null ? `${Math.round(at1h)} mg/dL` : bolusPendingLabel(expect1h)}
                color={at1h != null ? undefined : "rgba(255,255,255,0.4)"}
              />
              <Detail
                label="BG +2H"
                value={at2h != null ? `${Math.round(at2h)} mg/dL` : bolusPendingLabel(expect2h)}
                color={at2h != null ? undefined : "rgba(255,255,255,0.4)"}
              />
            </div>
            {(d1h != null || d2h != null) && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:8 }}>
                <BolusDeltaPill label="Δ AT LOG → +1H" delta={d1h}/>
                <BolusDeltaPill label="Δ AT LOG → +2H" delta={d2h}/>
              </div>
            )}
          </ExPanel>

          {/* 3) Evaluation panel ----------------------------------- */}
          <ExPanel title="EVALUATION">
            <EvalBlock
              heading="1H CHECK"
              unlocked={at1h != null}
              body={bolusInterimMessage(log) || "Waiting for the +1h glucose reading…"}
              color={evalInfo.color}
              outcomeLabel={null}
            />
            <div style={{ height:8 }}/>
            <EvalBlock
              heading="2H OUTCOME"
              unlocked={at2h != null}
              body={bolusFinalMessage(log) || "Waiting for the +2h glucose reading…"}
              color={evalInfo.color}
              outcomeLabel={at2h != null ? evalInfo.label : null}
            />
          </ExPanel>

          {log.notes && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>NOTES</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}

          <div style={{
            fontSize:11, color:"rgba(255,255,255,0.35)",
            textAlign:"center", letterSpacing:"0.02em", lineHeight:1.5,
            paddingTop:2,
          }}>
            For reference only — always consult your care team.
          </div>
        </div>
      }
    />
  );
}

// ──────────────── BASAL — expanded view + 6h CGM trend (no badge) ────────────────
function BasalRowCard({ log, isOpen, onToggle, onDelete, deleting }: {
  log: InsulinLog;
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
}) {
  const d = parseDbDate(log.created_at);
  const dateStr = d.toLocaleDateString("en", { month:"short", day:"numeric" });
  const timeStr = d.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });

  const accent = BASAL_ACCENT;
  const before = numOrNull(log.cgm_glucose_at_log);
  const at12h  = numOrNull(log.glucose_after_12h);
  const at24h  = numOrNull(log.glucose_after_24h);

  // Expected fetch times for "Pending · expected hh:mm" hints.
  const expect12h = new Date(d.getTime() + 12 * 60 * 60_000);
  const expect24h = new Date(d.getTime() + 24 * 60 * 60_000);

  // 6 h trend window — last 6 h leading up to the basal injection.
  const fromMs = d.getTime() - 6 * 60 * 60_000;
  const toMs   = d.getTime();

  // Lazy-fetch CGM history when the row first opens. LLU graph only
  // returns ~12 h of recent readings, so this only renders meaningful
  // data for basals logged within the last ~12 h.
  const [trend, setTrend] = useState<{
    state: "idle" | "loading" | "ready" | "error";
    points: SparklinePoint[];
    error?: string;
  }>({ state: "idle", points: [] });

  useEffect(() => {
    if (!isOpen || trend.state !== "idle") return;
    setTrend({ state: "loading", points: [] });
    let cancelled = false;
    fetch("/api/cgm/history", { cache: "no-store" })
      .then(async r => {
        if (!r.ok) throw new Error(`history ${r.status}`);
        const out = await r.json() as { history?: { timestamp?: string | null; value?: number | null }[] };
        const pts: SparklinePoint[] = (out.history || [])
          .map(h => {
            const t = h.timestamp ? (parseLluTs(h.timestamp) ?? NaN) : NaN;
            const v = typeof h.value === "number" ? h.value : NaN;
            return Number.isFinite(t) && Number.isFinite(v) ? { t, v } : null;
          })
          .filter((p): p is SparklinePoint => p !== null)
          .sort((a, b) => a.t - b.t);
        if (!cancelled) setTrend({ state: "ready", points: pts });
      })
      .catch(e => {
        if (!cancelled) setTrend({ state: "error", points: [], error: (e as Error)?.message || "fetch failed" });
      });
    return () => { cancelled = true; };
  }, [isOpen, trend.state]);

  // Stats for the 6 h pre-injection window.
  const inWindow = trend.points.filter(p => p.t >= fromMs && p.t <= toMs);
  const stats = inWindow.length >= 2 ? {
    min:   Math.round(Math.min(...inWindow.map(p => p.v))),
    max:   Math.round(Math.max(...inWindow.map(p => p.v))),
    avg:   Math.round(inWindow.reduce((s, p) => s + p.v, 0) / inWindow.length),
    count: inWindow.length,
  } : null;

  return (
    <NonMealRow
      isOpen={isOpen}
      onToggle={onToggle}
      onDelete={onDelete}
      deleting={deleting}
      accent={accent}
      badge="BASAL"
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel="Brand"
      primaryValue={log.insulin_name || "long-acting"}
      primaryColor="rgba(255,255,255,0.85)"
      secondaryLabel="Dose"
      secondaryValue={`${log.units}u`}
      secondaryColor={accent}
      secondaryMono
      expandedDetails={
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* 1) Session details ------------------------------------ */}
          <ExPanel title="SESSION DETAILS">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label="DOSE" value={`${log.units} u`} color={accent}/>
              <Detail label="INSULIN" value={log.insulin_name || "—"}/>
              <Detail label="WHEN" value={`${dateStr} · ${timeStr}`}/>
              <Detail label="TYPE" value="Basal"/>
            </div>
          </ExPanel>

          {/* 2) 6h CGM trend leading up to the injection ----------- */}
          <ExPanel title="6 H GLUCOSE TREND (pre-injection)">
            <div style={{
              background:"rgba(255,255,255,0.02)",
              border:`1px solid ${BORDER}`,
              borderRadius:10, padding:"10px 12px",
            }}>
              {trend.state === "loading" && (
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", textAlign:"center", padding:"24px 0" }}>
                  Loading CGM history…
                </div>
              )}
              {trend.state === "error" && (
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", textAlign:"center", padding:"24px 0" }}>
                  CGM not connected or history unavailable.
                </div>
              )}
              {trend.state === "ready" && (
                <CgmSparkline
                  points={trend.points}
                  fromMs={fromMs}
                  toMs={toMs}
                  markerMs={d.getTime()}
                  color={accent}
                />
              )}
              {/* Time-axis labels. */}
              <div style={{
                display:"flex", justifyContent:"space-between",
                fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em",
                marginTop:6,
              }}>
                <span>−6 h</span>
                <span>−4 h</span>
                <span>−2 h</span>
                <span>injection</span>
              </div>
            </div>
            {/* Window stats. */}
            {stats != null && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginTop:8 }}>
                <Detail label="MIN" value={`${stats.min} mg/dL`}/>
                <Detail label="MAX" value={`${stats.max} mg/dL`}/>
                <Detail label="AVG" value={`${stats.avg} mg/dL`}/>
                <Detail label="READINGS" value={`${stats.count}`}/>
              </div>
            )}
          </ExPanel>

          {/* 3) Stored post-fetches (12h / 24h) — context only ----- */}
          <ExPanel title="POST-INJECTION CHECKPOINTS">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              <Detail
                label="BG AT LOG"
                value={before != null ? `${Math.round(before)} mg/dL` : "—"}
              />
              <Detail
                label="BG +12H"
                value={at12h != null ? `${Math.round(at12h)} mg/dL` : pendingLabel(expect12h)}
                color={at12h != null ? undefined : "rgba(255,255,255,0.4)"}
              />
              <Detail
                label="BG +24H"
                value={at24h != null ? `${Math.round(at24h)} mg/dL` : pendingLabel(expect24h)}
                color={at24h != null ? undefined : "rgba(255,255,255,0.4)"}
              />
            </div>
          </ExPanel>

          {log.notes && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>NOTES</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}

          <div style={{
            fontSize:11, color:"rgba(255,255,255,0.35)",
            textAlign:"center", letterSpacing:"0.02em", lineHeight:1.5,
            paddingTop:2,
          }}>
            Basal is continuous — Glev does not score individual injections. For reference only.
          </div>
        </div>
      }
    />
  );
}

/** Δ-pill specifically for the bolus tracking panel — uses the bolus
 *  threshold colours so the visual matches the badge logic. */
function BolusDeltaPill({ label, delta }: { label: string; delta: number | null }) {
  const color = bolusDeltaColor(delta);
  const text  = delta == null
    ? "—"
    : delta === 0
      ? "0 mg/dL"
      : `${delta > 0 ? "+" : ""}${delta} mg/dL`;
  return (
    <div style={{
      background:"rgba(255,255,255,0.02)",
      border:`1px solid ${BORDER}`,
      borderRadius:10, padding:"10px 12px",
    }}>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{text}</div>
    </div>
  );
}

function ExerciseRowCard({ log, isOpen, onToggle, onDelete, deleting }: {
  log: ExerciseLog;
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
}) {
  const start = parseDbDate(log.created_at);
  const end   = new Date(start.getTime() + log.duration_minutes * 60_000);
  const dateStr = start.toLocaleDateString("en", { month:"short", day:"numeric" });
  const timeStr = start.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });
  // End-side date is computed independently so workouts that cross
  // midnight (e.g. start 23:50, run 30 min) display the next day's
  // date for ENDED instead of duplicating the start date.
  const endDateStr = end.toLocaleDateString("en", { month:"short", day:"numeric" });
  const endTimeStr = end.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });

  const accent  = EXERCISE_ACCENT;
  const typeLbl = exerciseTypeLabel(log.exercise_type);
  const evalInfo = evaluateExercise(log);
  const badgeColor = evalInfo.color;

  // Glucose deltas (Before → AtEnd, Before → +1h).
  const before  = numOrNull(log.cgm_glucose_at_log);
  const atEnd   = numOrNull(log.glucose_at_end);
  const after1h = numOrNull(log.glucose_after_1h);
  const dEnd    = before != null && atEnd   != null ? Math.round(atEnd   - before) : null;
  const d1h     = before != null && after1h != null ? Math.round(after1h - before) : null;

  // Expected fetch times for "Pending · expected hh:mm".
  const expectAtEnd = end;
  const expect1h    = new Date(end.getTime() + 60 * 60_000);

  return (
    <NonMealRow
      isOpen={isOpen}
      onToggle={onToggle}
      onDelete={onDelete}
      deleting={deleting}
      accent={badgeColor}
      badge={evalInfo.label}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel="Duration"
      primaryValue={`${log.duration_minutes}m`}
      primaryColor={accent}
      secondaryLabel="Type"
      secondaryValue={typeLbl}
      expandedDetails={
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* 1) Session details ------------------------------------ */}
          <ExPanel title="SESSION DETAILS">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label="TYPE" value={typeLbl}/>
              <Detail label="DURATION" value={`${log.duration_minutes} min`} color={accent}/>
              <Detail label="INTENSITY" value={intensityLabel(log.intensity)}/>
              <Detail label="STARTED" value={`${dateStr} · ${timeStr}`}/>
              <Detail label="ENDED" value={`${endDateStr} · ${endTimeStr}`}/>
            </div>
          </ExPanel>

          {/* 2) Glucose tracking ----------------------------------- */}
          <ExPanel title="GLUCOSE TRACKING">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
              <Detail
                label="BG BEFORE"
                value={before != null ? `${Math.round(before)} mg/dL` : "—"}
              />
              <Detail
                label="BG AT END"
                value={atEnd != null ? `${Math.round(atEnd)} mg/dL` : pendingLabel(expectAtEnd)}
                color={atEnd != null ? undefined : "rgba(255,255,255,0.4)"}
              />
              <Detail
                label="BG +1H"
                value={after1h != null ? `${Math.round(after1h)} mg/dL` : pendingLabel(expect1h)}
                color={after1h != null ? undefined : "rgba(255,255,255,0.4)"}
              />
            </div>
            {/* Coloured deltas — only show once both endpoints exist. */}
            {(dEnd != null || d1h != null) && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:8 }}>
                <DeltaPill label="Δ BEFORE → AT END" delta={dEnd}/>
                <DeltaPill label="Δ BEFORE → +1H"    delta={d1h}/>
              </div>
            )}
          </ExPanel>

          {/* 3) Evaluation panel ----------------------------------- */}
          <ExPanel title="EVALUATION">
            <EvalBlock
              heading="POST-WORKOUT CHECK"
              unlocked={atEnd != null}
              body={interimMessage(log) || "Waiting for the at-end glucose reading…"}
              color={evalInfo.color}
              outcomeLabel={atEnd != null ? evalInfo.label : null}
            />
            <div style={{ height:8 }}/>
            <EvalBlock
              heading="1H OUTCOME"
              unlocked={after1h != null}
              body={finalMessage(log) || "Waiting for the +1h glucose reading…"}
              color={evalInfo.color}
              outcomeLabel={after1h != null ? evalInfo.label : null}
            />
          </ExPanel>

          {/* 4) Pattern note --------------------------------------- */}
          <ExPanel title="PATTERN NOTE">
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.78)", lineHeight:1.55 }}>
              {patternNote(log.exercise_type)}
            </div>
          </ExPanel>

          {log.notes && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>NOTES</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}

          {/* Disclaimer — last item before the inherited Delete button. */}
          <div style={{
            fontSize:11, color:"rgba(255,255,255,0.35)",
            textAlign:"center", letterSpacing:"0.02em", lineHeight:1.5,
            paddingTop:2,
          }}>
            For reference only — always consult your care team.
          </div>
        </div>
      }
    />
  );
}

// ──────────────── helpers used by the exercise expanded view ────────────────

function numOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// 3 h matches EXERCISE_NO_DATA_AFTER_MS / EXERCISE_ABANDON_AFTER_MS.
const EXERCISE_NO_DATA_AFTER_MS = 3 * 60 * 60 * 1000;

/** Map the stored intensity token to the spec's display wording.
 *  DB column still stores "medium" (legacy CHECK constraint), but the
 *  spec calls for "moderate" in user-facing copy. */
function intensityLabel(v: string): string {
  if (v === "medium") return "Moderate";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function pendingLabel(expectedAt: Date): string {
  // Once the CGM job's 3 h window has elapsed, the job is finalised
  // as 'skipped' server-side. Mirror that exact wording in the UI
  // so the displayed state matches the backend job status.
  if (Date.now() - expectedAt.getTime() > EXERCISE_NO_DATA_AFTER_MS) {
    return "Skipped";
  }
  const hh = expectedAt.toLocaleTimeString("en", { hour:"numeric", minute:"2-digit" });
  return `Pending · expected ${hh}`;
}

/** Section wrapper used inside the exercise expanded view. */
function ExPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background:"rgba(255,255,255,0.015)",
      border:`1px solid ${BORDER}`,
      borderRadius:12,
      padding:"12px 14px",
    }}>
      <div style={{
        fontSize:10, fontWeight:700, letterSpacing:"0.1em",
        color:"rgba(255,255,255,0.45)", marginBottom:10,
      }}>{title}</div>
      {children}
    </div>
  );
}

function DeltaPill({ label, delta }: { label: string; delta: number | null }) {
  const color = deltaColor(delta);
  const text  = delta == null
    ? "—"
    : delta === 0
      ? "0 mg/dL"
      : `${delta > 0 ? "+" : ""}${delta} mg/dL`;
  return (
    <div style={{
      background:"rgba(255,255,255,0.02)",
      border:`1px solid ${BORDER}`,
      borderRadius:10, padding:"10px 12px",
    }}>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{text}</div>
    </div>
  );
}

function EvalBlock({ heading, unlocked, body, color, outcomeLabel }: {
  heading: string;
  unlocked: boolean;
  body: string;
  color: string;
  outcomeLabel: string | null;
}) {
  const border = unlocked ? `${color}40` : BORDER;
  const bg     = unlocked ? `${color}10` : "rgba(255,255,255,0.02)";
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: "10px 12px",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{
          fontSize:9, fontWeight:700, letterSpacing:"0.1em",
          color: unlocked ? color : "rgba(255,255,255,0.35)",
        }}>{heading}</span>
        {unlocked && outcomeLabel && (
          <span style={{
            fontSize:9, fontWeight:700, letterSpacing:"0.08em",
            color, padding:"2px 8px", borderRadius:99,
            border:`1px solid ${color}40`, background:`${color}15`,
          }}>{outcomeLabel}</span>
        )}
      </div>
      <div style={{
        fontSize:13, lineHeight:1.5,
        color: unlocked ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
      }}>{body}</div>
    </div>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color: color || "rgba(255,255,255,0.9)", letterSpacing:"-0.01em" }}>{value}</div>
    </div>
  );
}

function FilterSection<T extends string>({
  title, options, selected, onToggle,
}: {
  title: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>
        {title}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {options.map(opt => {
          const active = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={active}
              onClick={() => onToggle(opt.value)}
              style={{
                padding:"6px 12px",
                borderRadius:99,
                border:`1px solid ${active ? ACCENT+"60" : BORDER}`,
                background: active ? `${ACCENT}18` : "transparent",
                color: active ? ACCENT : "rgba(255,255,255,0.55)",
                fontSize:12,
                fontWeight: active ? 600 : 500,
                cursor:"pointer",
                whiteSpace:"nowrap",
                display:"inline-flex", alignItems:"center", gap:6,
                transition:"background 0.12s, color 0.12s, border-color 0.12s",
              }}
            >
              {active && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateRangeSection({
  value, from, to, onChange, onBoundChange,
}: {
  value: DateRangeKey;
  from: string | null;
  to: string | null;
  onChange: (value: DateRangeKey) => void;
  onBoundChange: (side: "from" | "to", value: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>
        Date range
      </div>
      <div role="radiogroup" aria-label="Date range" style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {DATE_RANGE_OPTIONS.map(opt => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              style={{
                padding:"6px 12px",
                borderRadius:99,
                border:`1px solid ${active ? ACCENT+"60" : BORDER}`,
                background: active ? `${ACCENT}18` : "transparent",
                color: active ? ACCENT : "rgba(255,255,255,0.55)",
                fontSize:12,
                fontWeight: active ? 600 : 500,
                cursor:"pointer",
                whiteSpace:"nowrap",
                display:"inline-flex", alignItems:"center", gap:6,
                transition:"background 0.12s, color 0.12s, border-color 0.12s",
              }}
            >
              {active && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
      {value === "custom" && (
        <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
          <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:10, color:"rgba(255,255,255,0.45)", letterSpacing:"0.06em", fontWeight:600, textTransform:"uppercase", flex:"1 1 140px" }}>
            From
            <input
              type="date"
              value={from ?? ""}
              max={to ?? undefined}
              onChange={(e) => onBoundChange("from", e.target.value)}
              style={{
                background:"#0D0D12",
                border:`1px solid ${BORDER}`,
                borderRadius:8,
                padding:"7px 10px",
                color:"#fff",
                fontSize:12,
                outline:"none",
                colorScheme:"dark",
              }}
            />
          </label>
          <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:10, color:"rgba(255,255,255,0.45)", letterSpacing:"0.06em", fontWeight:600, textTransform:"uppercase", flex:"1 1 140px" }}>
            To
            <input
              type="date"
              value={to ?? ""}
              min={from ?? undefined}
              onChange={(e) => onBoundChange("to", e.target.value)}
              style={{
                background:"#0D0D12",
                border:`1px solid ${BORDER}`,
                borderRadius:8,
                padding:"7px 10px",
                color:"#fff",
                fontSize:12,
                outline:"none",
                colorScheme:"dark",
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

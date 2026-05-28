"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import RefreshingBar from "@/components/RefreshingBar";
import { useTranslations, useLocale } from "next-intl";
import { fetchMeals, deleteMeal, updateMeal, FETCH_MEALS_DEFAULT_SINCE_DAYS, type Meal } from "@/lib/meals";
import { supabase } from "@/lib/supabase";
import { fetchRecentInsulinLogs, deleteInsulinLog, updateInsulinReadings, updateInsulinLogLink, updateInsulinEntry, type InsulinLog } from "@/lib/insulin";
import { fetchRecentExerciseLogs, deleteExerciseLog, updateExerciseLog, type ExerciseLog, type ExerciseType, type ExerciseIntensity } from "@/lib/exercise";
import SnapSlider from "@/components/log/SnapSlider";
import SegmentedChoice from "@/components/log/SegmentedChoice";
import CollapsibleField from "@/components/log/CollapsibleField";
import SaveButton from "@/components/log/SaveButton";
import DateTimeField, { isoToLocal, localToIso } from "@/components/log/DateTimeField";
import { fetchRecentMenstrualLogs, deleteMenstrualLog, updateMenstrualLog, type MenstrualLog, type FlowIntensity } from "@/lib/menstrual";
import { fetchRecentSymptomLogs, deleteSymptomLog, updateSymptomLog, SYMPTOM_TYPES, avgSeverity, type SymptomLog, type SymptomType, type SeveritiesMap, type SeverityValue } from "@/lib/symptoms";
import { fetchRecentInfluenceLogs, deleteInfluenceLog, updateInfluenceLog, INFLUENCE_TYPES, type InfluenceLog, type InfluenceType } from "@/lib/influences";
import { evaluateExercise, exerciseTypeLabelI18n, exercisePatternNoteKey, interimMessage, finalMessage, deltaColor, aggregateExerciseTypeStats, personalPatternHeadline, PATTERN_MIN_SESSIONS } from "@/lib/exerciseEval";
import {
  evaluateBolus,
  bolusInterimMessage,
  bolusFinalMessage,
  bolusDeltaColor,
  bolusPendingLabel,
} from "@/lib/insulinEval";
import CgmSparkline, { type SparklinePoint } from "@/components/CgmSparkline";
import GlucoseMiniSparkline from "@/components/GlucoseMiniSparkline";
import PostDoseCurveChart, { type PostDoseSample } from "@/components/PostDoseCurveChart";
import IosTapButton from "@/components/IosTapButton";
import { fetchFingersticks } from "@/lib/fingerstick";
import { TYPE_COLORS, TYPE_LABELS, TYPE_EXPLAIN, getEvalColor, getEvalLabel, chipLabelsFrom } from "@/lib/mealTypes";
import { lifecycleFor, STATE_LABELS, type OutcomeState } from "@/lib/engine/lifecycle";
import { resolveDisplayedOutcome } from "@/lib/engine/resolveDisplayedOutcome";
import { renderEngineMessages } from "@/lib/engineMessages";
import MealEntryCardCollapsed from "@/components/MealEntryCardCollapsed";
import MealTrendArrow from "@/components/MealTrendArrow";
import PendingGlucoseStrip from "@/components/PendingGlucoseStrip";
import ManualEntryModal from "@/components/ManualEntryModal";
import EntryAddCTA from "@/components/EntryAddCTA";
import { CgmCountdownPair } from "@/components/CgmCountdownChip";
import { calcSingleIOB, getDIAMinutes, type BolusDose, type InsulinType } from "@/lib/iob";
import { fetchInsulinType, getInsulinSettings } from "@/lib/userSettings";
import { parseDbDate, parseDbTs, parseLluTs } from "@/lib/time";
import { useCarbUnit } from "@/hooks/useCarbUnit";
import { useTimeFormat } from "@/hooks/useTimeFormat";
import { formatICR } from "@/lib/carbUnits";
import {
  readEntriesCache,
  writeEntriesCache,
  clearEntriesCache,
} from "./cache";

const ACCENT="#4F6EF7", GREEN="#22D3A0", PINK="#FF2D78", ORANGE="#FF9500";
const PURPLE="#A78BFA", BLUE="#3B82F6";
const SURFACE="var(--surface)", BORDER="var(--border)";

function evC(ev: string|null) { return getEvalColor(ev); }
function evL(ev: string|null) { return getEvalLabel(ev); }

/** Small "Apple Health" pill rendered next to exercise rows whose
 *  `source = 'apple_health'`. Mirrors the existing chip rhythm used by
 *  the entries timeline (translucent fill + accent text + uppercase
 *  tracking). The heart glyph is inline SVG so it inherits `currentColor`
 *  and doesn't drag in an icon library. */
function AppleHealthBadge({ label, compact = false }: { label: string; compact?: boolean }) {
  const COLOR = "#FF2D55"; // Apple Health red — matches the system app icon
  return (
    <span
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: compact ? "2px 6px" : "3px 8px",
        borderRadius: 99,
        fontSize: compact ? 10 : 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: `${COLOR}1a`,
        color: COLOR,
        border: `1px solid ${COLOR}40`,
        whiteSpace: "nowrap",
        lineHeight: 1.1,
      }}
    >
      <svg width={compact ? 9 : 10} height={compact ? 9 : 10} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 21s-7-4.5-9.5-9C.8 8.5 2.6 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4.4 0 6.2 4.5 4.5 8-2.5 4.5-9.5 9-9.5 9z"/>
      </svg>
      {label}
    </span>
  );
}

// Multi-select filter sections. Selections are AND-ed across sections; OR-ed
// within a section. Meal-kind / outcome implicitly restrict to meal rows;
// exercise-kind implicitly restricts to exercise rows.
type EntryTypeKey   = "meal" | "bolus" | "basal" | "exercise" | "cycle" | "symptoms" | "influences";
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
  { value: "cycle",    label: "Cycle" },
  { value: "symptoms", label: "Symptoms" },
  { value: "influences", label: "Influences" },
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
  | { kind: "exercise"; id: string; ts: string; data: ExerciseLog }
  | { kind: "cycle"; id: string; ts: string; data: MenstrualLog }
  | { kind: "symptoms"; id: string; ts: string; data: SymptomLog }
  | { kind: "influences"; id: string; ts: string; data: InfluenceLog };

export default function EntriesPage() {
  // Carb-unit selector — converts the stored grams value into the
  // user's chosen display unit (g/BE/KE) for the MiniCard CARBS / NET
  // CARBS rows below. The MealEditor edit form is intentionally NOT
  // converted (out of scope for the rollout).
  const carbUnit = useCarbUnit();
  const locale = useLocale();
  // Per-user clock format (auto → DE 24h / EN AM-PM, user-overridable in
  // Settings → Zeitformat). One hook call shared by every collapsed-meal
  // header via the module cache in `useTimeFormat`.
  const { format: fmtTime } = useTimeFormat();
  const tNav = useTranslations("nav");
  const tHistory = useTranslations("history");
  // i18n for the meal-expanded view (section labels, mini-card labels,
  // type/eval pills, lifecycle state). Keys live in messages/{de,en}.json
  // under "entriesExpand". Helpers below fall back to the lib/mealTypes
  // hardcoded English when a key is unknown so legacy outcomes (e.g. an
  // unexpected eval string) still render something readable.
  const tx = useTranslations("entriesExpand");
  const txSafe = (key: string, fallback: string): string => {
    try { return tx(key); } catch { return fallback; }
  };
  const txEvalLabel   = (ev: string | null): string => ev ? txSafe(`eval_${ev}`, getEvalLabel(ev)) : "—";
  // Task #250 — every `eval_explain_*` string in messages/{de,en}.json
  // is phrased around the bolus ("Insulin-Dosis hat …", "Insulin
  // exceeded …"). When the meal had no insulin attached, none of those
  // explanations are truthful. Suppress the explainer entirely and let
  // the generic eval label (e.g. "Gut" / "Good") stand on its own.
  const txEvalExplain = (ev: string | null, insulinUnits?: number | null): string => {
    if (!ev) return "";
    if (!insulinUnits || insulinUnits <= 0) return "";
    return txSafe(`eval_explain_${ev}`, "");
  };
  const txTypeLabel   = (t: string | null): string | null => t ? txSafe(`type_${t}`, TYPE_LABELS[t] || t.replace("_"," ")) : null;
  const txTypeExplain = (t: string | null): string => t ? txSafe(`type_explain_${t}`, TYPE_EXPLAIN[t] || "") : "";
  // Localized labels for the filter dropdowns + active filter chips. The
  // option *values* (FAST_CARBS, GOOD, ...) stay as the canonical English
  // keys; only the displayed label switches per locale via the shared
  // `chips` namespace.
  const tChips = useTranslations("chips");
  const chipLabels = chipLabelsFrom(tChips);
  const mealKindOptions = useMemo(
    () => MEAL_KIND_OPTIONS.map(o => ({ value: o.value, label: chipLabels.typeLabel(o.value) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const outcomeOptions = useMemo(
    () => OUTCOME_OPTIONS.map(o => ({ value: o.value, label: chipLabels.evalLabel(o.value) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const entryTypeOptions = useMemo(
    () => ENTRY_TYPE_OPTIONS.map(o => ({
      value: o.value,
      label: tChips(`entry_type_${o.value}` as Parameters<typeof tChips>[0]) ?? o.label,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const exerciseKindOptions = useMemo(
    () => EXERCISE_KIND_OPTIONS.map(o => ({
      value: o.value,
      label: tChips(`exercise_kind_${o.value}` as Parameters<typeof tChips>[0]) ?? o.label,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const dateRangeOptions = useMemo(
    () => DATE_RANGE_OPTIONS.map(o => ({
      value: o.value,
      label: tChips(`date_range_${o.value}` as Parameters<typeof tChips>[0]) ?? o.label,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const tDateRangeSummary = useCallback(
    (range: DateRangeKey, from: string | null, to: string | null): string => {
      if (range === "today") return tChips("date_range_today");
      if (range === "7d")    return tChips("date_range_7d");
      if (range === "30d")   return tChips("date_range_30d");
      if (range === "custom") {
        const fmt = (s: string) => {
          const d = new Date(`${s}T00:00:00`);
          if (Number.isNaN(d.getTime())) return s;
          return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        };
        if (from && to)  return `${fmt(from)} – ${fmt(to)}`;
        if (from)        return tChips("date_range_from", { date: fmt(from) });
        if (to)          return tChips("date_range_until", { date: fmt(to) });
        return tChips("date_range_custom");
      }
      return tChips("date_range_all");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );
  const [meals, setMeals]     = useState<Meal[]>([]);
  const [insulin, setInsulin] = useState<InsulinLog[]>([]);
  const [exercise, setExercise] = useState<ExerciseLog[]>([]);
  const [cycle, setCycle]       = useState<MenstrualLog[]>([]);
  const [symptoms, setSymptoms] = useState<SymptomLog[]>([]);
  const [influences, setInfluences] = useState<InfluenceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch]   = useState("");
  const [expanded, setExpanded] = useState<string|null>(null);
  const [deleting, setDeleting] = useState<string|null>(null);
  // Editor mode for the expanded meal panel — when set to a meal id, the
  // read-only body is replaced by an inline editor (macros + bolus) so the
  // user can correct values after the fact. Only one entry at a time can be
  // in edit mode; collapsing or switching expansion clears it.
  const [editingId, setEditingId] = useState<string|null>(null);
  const [insulinType, setInsType]  = useState<InsulinType>("rapid");
  const [manualOpen, setManualOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const _anchoredRef = useRef(false);
  const filtersWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchInsulinType().then(setInsType).catch(() => {}); }, []);

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

  // Flatten the FilterState into a list of removable chips rendered next to
  // the Filters trigger. Each chip carries a stable key, a human label, and a
  // single-filter removal callback so users can dismiss one selection at a
  // time without opening the panel.
  type ActiveChip = { key: string; label: string; remove: () => void };
  const activeChips: ActiveChip[] = useMemo(() => {
    const chips: ActiveChip[] = [];
    if (filters.dateRange !== "all") {
      chips.push({
        key: "dateRange",
        label: tDateRangeSummary(filters.dateRange, filters.dateFrom, filters.dateTo),
        remove: () => setDateRange("all"),
      });
    }
    for (const v of filters.entryType) {
      const opt = entryTypeOptions.find(o => o.value === v);
      if (opt) chips.push({ key: `entryType:${v}`, label: opt.label, remove: () => toggleFilter("entryType", v) });
    }
    for (const v of filters.mealKind) {
      const opt = mealKindOptions.find(o => o.value === v);
      if (opt) chips.push({ key: `mealKind:${v}`, label: opt.label, remove: () => toggleFilter("mealKind", v) });
    }
    for (const v of filters.exerciseKind) {
      const opt = exerciseKindOptions.find(o => o.value === v);
      if (opt) chips.push({ key: `exerciseKind:${v}`, label: opt.label, remove: () => toggleFilter("exerciseKind", v) });
    }
    for (const v of filters.outcome) {
      const opt = outcomeOptions.find(o => o.value === v);
      if (opt) chips.push({ key: `outcome:${v}`, label: opt.label, remove: () => toggleFilter("outcome", v) });
    }
    return chips;
  }, [filters]);

  // Meal rows expand directly into the full detail body (no intermediate
  // "light" summary). Bolus / basal / exercise rows have their own
  // collapsed→expanded body rendered by their respective row components.
  function expandRow(id: string | null) {
    setExpanded(id);
  }

  // Stale-while-revalidate: on first mount, read the last known
  // full dataset from localStorage so repeat visits show real data
  // instantly instead of a blank list + spinner — including after a
  // native-app restart or TestFlight force-quit (sessionStorage would
  // not survive those). Cache key includes the user ID to prevent
  // cross-account data leakage on shared devices. The cache is
  // written after every successful full fetch and carries a `cachedAt`
  // timestamp; entries older than ENTRIES_CACHE_TTL_MS are discarded.
  useEffect(() => {
    if (typeof window === "undefined" || !supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id;
      if (!uid) return;
      const cached = readEntriesCache(uid, localStorage);
      if (!cached) return;
      setMeals(prev => prev.length > 0 ? prev : cached.meals as Meal[]);
      if (Array.isArray(cached.insulin))    setInsulin(prev => prev.length > 0 ? prev : cached.insulin as InsulinLog[]);
      if (Array.isArray(cached.exercise))   setExercise(prev => prev.length > 0 ? prev : cached.exercise as ExerciseLog[]);
      if (Array.isArray(cached.cycle))      setCycle(prev => prev.length > 0 ? prev : cached.cycle as MenstrualLog[]);
      if (Array.isArray(cached.symptoms))   setSymptoms(prev => prev.length > 0 ? prev : cached.symptoms as SymptomLog[]);
      if (Array.isArray(cached.influences)) setInfluences(prev => prev.length > 0 ? prev : cached.influences as InfluenceLog[]);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear this user's entries cache immediately on sign-out so a subsequent
  // sign-in with a different account on the same device never sees stale data
  // from the previous session (even within the 10-minute TTL window).
  useEffect(() => {
    if (typeof window === "undefined" || !supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        // `session` is null on SIGNED_OUT; use the previous session's user ID
        // if available, otherwise fall back to getUser() — but since we have no
        // uid at this point, we iterate known cache keys via the prefix instead.
        // Supabase fires SIGNED_OUT before nulling the session in some versions,
        // so we read the uid directly from the event's previous session arg when
        // available, otherwise clear any key that matches our prefix pattern.
        const uid = session?.user?.id;
        if (uid) {
          clearEntriesCache(uid, localStorage);
        } else {
          // Defensive fallback: scan localStorage for all keys matching our
          // cache prefix and remove them. This covers the case where the session
          // is already null when the event fires.
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("glev:entries-cache:")) keysToRemove.push(k);
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
        }
      }
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 2026-05-18 perceived-perf split (user: "die ersten 5 sollen
    // gecached werden, rest im hintergrund"): on initial mount we
    // kick off TWO fetches in parallel —
    //   1. fast: just the newest 5 meals (single PostgREST call,
    //      typically <150 ms) → unblocks the page so the user sees
    //      a filled list immediately when no SWR cache is available.
    //   2. full: every event type for the last 90 days → replaces
    //      the placeholder list quickly, then a background fetch
    //      pulls in older data (up to FETCH_MEALS_DEFAULT_SINCE_DAYS).
    // The full-fetch result always wins because it dispatches AFTER
    // the fast one resolves. For "load(false)" calls (triggered by
    // the cross-screen update events) we skip the fast path and go
    // straight to the full refresh — no need to flash a 5-row
    // placeholder when the user already has the list rendered.
    async function loadFast() {
      try {
        const top5 = await fetchMeals({ limit: 5 });
        if (cancelled) return;
        // Only seed the placeholder when the user hasn't already
        // received the full payload (race: full fetch may resolve
        // first on a warm Supabase connection — don't clobber it).
        setMeals(prev => (prev.length > 0 ? prev : top5));
        setLoading(false);
      } catch (e) { console.error(e); }
    }
    async function loadFull(initial: boolean) {
      setIsRefreshing(true);
      try {
        // Initial fetch covers the last 90 days — fast enough to
        // unblock the list. Older rows are pulled in background below.
        const [m, ins, ex, cy, sy, inf] = await Promise.all([
          fetchMeals({ sinceDays: 90, limit: Infinity }),
          fetchRecentInsulinLogs(60).catch(() => []),
          fetchRecentExerciseLogs(60).catch(() => []),
          fetchRecentMenstrualLogs(120).catch(() => [] as MenstrualLog[]),
          fetchRecentSymptomLogs(120).catch(() => [] as SymptomLog[]),
          fetchRecentInfluenceLogs(120).catch(() => [] as InfluenceLog[]),
        ]);
        if (!cancelled) {
          setMeals(m);
          setInsulin(ins);
          setExercise(ex);
          setCycle(cy);
          setSymptoms(sy);
          setInfluences(inf);
        }
        // Persist to localStorage (with TTL) so the next visit is instant,
        // including after a native-app restart or TestFlight force-quit.
        if (!cancelled && supabase) {
          supabase.auth.getUser().then(({ data }) => {
            const uid = data?.user?.id;
            if (!uid) return;
            writeEntriesCache(uid, localStorage, {
              meals: m,
              insulin: ins,
              exercise: ex,
              cycle: cy,
              symptoms: sy,
              influences: inf,
            });
          });
        }
        // Background: pull older meals (90–FETCH_MEALS_DEFAULT_SINCE_DAYS
        // days) so historical filters & counts are complete.
        if (!cancelled && FETCH_MEALS_DEFAULT_SINCE_DAYS > 90) {
          fetchMeals({ sinceDays: FETCH_MEALS_DEFAULT_SINCE_DAYS, limit: Infinity }).then(all => {
            if (!cancelled && all.length > m.length) {
              setMeals(all);
            }
          }).catch(() => { /* best-effort */ });
        }
      } catch (e) { console.error(e); }
      finally {
        if (!cancelled && initial) setLoading(false);
        if (!cancelled) setIsRefreshing(false);
      }
    }
    function load(initial: boolean) {
      if (initial) loadFast();
      loadFull(initial);
    }
    load(true);
    function onUpdated() { load(false); }
    window.addEventListener("glev:meals-updated", onUpdated);
    window.addEventListener("glev:insulin-updated", onUpdated);
    window.addEventListener("glev:exercise-updated", onUpdated);
    window.addEventListener("glev:menstrual-updated", onUpdated);
    window.addEventListener("glev:symptom-updated", onUpdated);
    window.addEventListener("glev:influence-updated", onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("glev:meals-updated", onUpdated);
      window.removeEventListener("glev:insulin-updated", onUpdated);
      window.removeEventListener("glev:exercise-updated", onUpdated);
      window.removeEventListener("glev:menstrual-updated", onUpdated);
      window.removeEventListener("glev:symptom-updated", onUpdated);
      window.removeEventListener("glev:influence-updated", onUpdated);
    };
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteMeal(id);
      setMeals(ms => ms.filter(m => m.id !== id));
      setExpanded(null);
      window.dispatchEvent(new CustomEvent("glev:meals-updated"));
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
      window.dispatchEvent(new CustomEvent("glev:insulin-updated"));
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

  async function handleDeleteCycle(id: string) {
    if (!confirm("Delete this cycle entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteMenstrualLog(id);
      setCycle(xs => xs.filter(x => x.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally { setDeleting(null); }
  }

  async function handleDeleteSymptom(id: string) {
    if (!confirm("Delete this symptom entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteSymptomLog(id);
      setSymptoms(xs => xs.filter(x => x.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally { setDeleting(null); }
  }

  async function handleDeleteInfluence(id: string) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await deleteInfluenceLog(id);
      setInfluences(xs => xs.filter(x => x.id !== id));
      setExpanded(null);
    } catch (e) {
      console.error(e);
      alert("Could not delete entry.");
    } finally { setDeleting(null); }
  }

  // Merge meal/bolus/basal/exercise/cycle/symptoms into a single timeline.
  // Cycle rows sort by start_date (00:00 local) since they don't carry a
  // wall-clock time; symptom rows sort by their explicit occurred_at.
  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      ...meals.map<Row>(m => ({ kind: "meal", id: m.id, ts: m.meal_time ?? m.created_at, data: m })),
      ...insulin.map<Row>(i => ({ kind: i.insulin_type, id: i.id, ts: i.created_at, data: i })),
      ...exercise.map<Row>(x => ({ kind: "exercise", id: x.id, ts: x.created_at, data: x })),
      ...cycle.map<Row>(c => ({ kind: "cycle", id: c.id, ts: `${c.start_date}T00:00:00`, data: c })),
      ...symptoms.map<Row>(s => ({ kind: "symptoms", id: s.id, ts: s.occurred_at, data: s })),
      ...influences.map<Row>(i => ({ kind: "influences", id: i.id, ts: i.occurred_at, data: i })),
    ];
    all.sort((a, b) => parseDbTs(b.ts) - parseDbTs(a.ts));
    return all;
  }, [meals, insulin, exercise, cycle, symptoms, influences]);

  // Memoize to keep the bounds stable across re-renders within the same render
  // cycle and to recompute when the user changes the date filter.
  const dateBounds = useMemo(
    () => dateRangeBounds(filters.dateRange, filters.dateFrom, filters.dateTo),
    [filters.dateRange, filters.dateFrom, filters.dateTo],
  );

  const filtered = useMemo(() => rows.filter(r => {
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
        // Task #251: SPIKE_STRONG falls under the user-facing SPIKE filter.
        || (o === "SPIKE"     && ev === "SPIKE_STRONG")
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
      else if (r.kind === "cycle") txt = `${r.data.flow_intensity ?? ""} ${r.data.phase_marker ?? ""} ${r.data.cycle_phase ?? ""} ${r.data.notes ?? ""}`;
      else if (r.kind === "symptoms") txt = `${(r.data.symptom_types || []).join(" ")} ${r.data.notes ?? ""}`;
      else if (r.kind === "influences") txt = `${r.data.influence_type} ${r.data.details ?? ""} ${r.data.amount ?? ""} ${r.data.notes ?? ""}`;
      if (!txt.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, filters, search, dateBounds]);

  // Reset card navigation index to 0 whenever the filtered list changes
  // (filter change, search change, or underlying data refresh).
  useEffect(() => {
    setCurrentIndex(0);
    setExpanded(null);
    setEditingId(null);
  }, [filters, search, rows]);

  // Anchor to the newest entry (last index) on first load only.
  // Skipped when a deep-link hash is present — the hash useEffect handles that.
  useEffect(() => {
    if (!_anchoredRef.current && filtered.length > 0) {
      _anchoredRef.current = true;
      if (typeof window !== "undefined" && !window.location.hash) {
        setCurrentIndex(filtered.length - 1);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length]);

  // Deep-link via URL hash: /entries#<id> auto-expands to the full view so
  // "View full entry →" from the dashboard lands the user on the right row.
  // Also handles /entries#insulin-<id> for insulin log rows (navigated from
  // the IOB peak popover — Task #501).
  // With single-card navigation (Task #516), we also set currentIndex so the
  // linked card becomes the visible one.
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!hash) return;

    // Insulin log deep-link: #insulin-<uuid>
    if (hash.startsWith("insulin-")) {
      const insulinId = hash.slice("insulin-".length);
      if (!insulinId || insulin.length === 0) return;
      if (insulin.some(l => l.id === insulinId)) {
        setExpanded(insulinId);
        const idx = filtered.findIndex(r => r.id === insulinId);
        if (idx >= 0) setCurrentIndex(idx);
      }
      return;
    }

    // Meal deep-link: #<uuid>
    if (meals.length === 0) return;
    if (meals.some(m => m.id === hash)) {
      setExpanded(hash);
      const idx = filtered.findIndex(r => r.id === hash);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [meals, insulin, filtered]);

  // Render-time clamp: safeIndex never exceeds filtered.length-1 so the
  // card render and counter are crash-safe even before the reset-useEffect
  // fires (useEffect runs after render, so a filter change that shrinks the
  // list causes ONE render with the stale index before it is reset to 0).

  const inp: React.CSSProperties = { background:"var(--input-bg)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"9px 14px", color:"var(--text)", fontSize:14, outline:"none" };

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}>
      <style>{`@keyframes glevPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <svg width={48} height={48} viewBox="0 0 32 32" fill="none" aria-label="Glev" style={{ animation:"glevPulse 1.4s ease-in-out infinite" }}>
        <rect width="32" height="32" rx="9" fill="var(--surface)"/>
        {([
          [0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[0,6],[1,6],[2,6],[3,6],
        ] as [number,number][]).map(([a,b],i) => {
          const ns=[{cx:16,cy:7},{cx:25,cy:12},{cx:25,cy:20},{cx:18,cy:26},{cx:9,cy:22},{cx:7,cy:14},{cx:16,cy:16}];
          return <line key={i} x1={ns[a].cx} y1={ns[a].cy} x2={ns[b].cx} y2={ns[b].cy} stroke="#4F6EF7" strokeWidth="0.9" strokeOpacity="0.55"/>;
        })}
        {[{cx:16,cy:7},{cx:25,cy:12},{cx:25,cy:20},{cx:18,cy:26},{cx:9,cy:22},{cx:7,cy:14},{cx:16,cy:16}].map((n,i) => (
          <circle key={i} cx={n.cx} cy={n.cy} r={i===6?3.5:2} fill={i===6?"#4F6EF7":"#4F6EF740"} stroke="#4F6EF7" strokeWidth={i===6?0:0.8}/>
        ))}
      </svg>
    </div>
  );

  return (
    <div style={{ maxWidth:960, margin:"0 auto" }}>
      <style>{``}</style>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:"-0.03em", marginBottom:4 }}>{tNav("entries")}</h1>
        <p style={{ color:"var(--text-faint)", fontSize:14 }}>{tHistory("entries_subline", { shown: filtered.length, total: rows.length })}</p>
      </div>

      <RefreshingBar visible={isRefreshing} />
      {/* "+ Eintrag" CTA — popup mirrors the header "+" dropdown.
          Manual meal entry is preserved as the first item so the old
          "+ Mahlzeit" sheet stays reachable from this screen. */}
      <EntryAddCTA onManualMeal={() => setManualOpen(true)} />

      {/* FILTERS + SEARCH */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:20 }}>
        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:6, minWidth:0 }}>
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
              color: activeCount > 0 ? ACCENT : "var(--text-muted)",
              fontSize:13,
              fontWeight: activeCount > 0 ? 600 : 500,
              cursor:"pointer",
              display:"inline-flex", alignItems:"center", gap:8,
              whiteSpace:"nowrap",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            <span>Filters</span>
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
                options={dateRangeOptions}
                title={tChips("filter_section_date_range")}
              />
              <FilterSection
                title={tChips("filter_section_entry_type")}
                options={entryTypeOptions}
                selected={filters.entryType}
                onToggle={(v) => toggleFilter("entryType", v)}
              />
              <FilterSection
                title={tChips("filter_section_meal_kind")}
                options={mealKindOptions}
                selected={filters.mealKind}
                onToggle={(v) => toggleFilter("mealKind", v)}
              />
              <FilterSection
                title={tChips("filter_section_exercise_kind")}
                options={exerciseKindOptions}
                selected={filters.exerciseKind}
                onToggle={(v) => toggleFilter("exerciseKind", v)}
              />
              <FilterSection
                title={tChips("filter_section_outcome")}
                options={outcomeOptions}
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
                      fontSize:13, fontWeight:600, cursor:"pointer",
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
        {activeChips.map(chip => (
          <button
            key={chip.key}
            onClick={chip.remove}
            aria-label={`Remove filter: ${chip.label}`}
            title={`Remove filter: ${chip.label}`}
            style={{
              padding:"4px 6px 4px 10px",
              borderRadius:99,
              border:`1px solid ${ACCENT}40`,
              background:`${ACCENT}10`,
              color:ACCENT,
              fontSize:13,
              fontWeight:600,
              cursor:"pointer",
              display:"inline-flex", alignItems:"center", gap:4,
              maxWidth:"100%",
              minWidth:0,
            }}
          >
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>{chip.label}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink:0 }}>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        ))}
        </div>
        <input style={{ ...inp, width:"100%", boxSizing:"border-box" }} placeholder={tx("search_placeholder")} value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      {/* CARD STACK */}
      {filtered.length === 0 ? (
        <div style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:16, padding:"48px 24px", textAlign:"center", color:"var(--text-ghost)", fontSize:14 }}>
          {filters.dateRange !== "all" || search !== "" ? (
            // Show the date-range hint first when both apply — the date filter
            // is usually the bigger reason for an empty list — followed by the
            // search hint, each with its own one-click reset.
            <div style={{ display:"flex", flexDirection:"column", gap:18, alignItems:"center" }}>
              {filters.dateRange !== "all" && (
                <div style={{ display:"flex", flexDirection:"column", gap:10, alignItems:"center" }}>
                  <div style={{ color:"var(--text-muted)", fontSize:14 }}>
                    {tChips("entries_empty_date", { range: tDateRangeSummary(filters.dateRange, filters.dateFrom, filters.dateTo) })}
                  </div>
                  <button
                    onClick={() => setDateRange("all")}
                    style={{
                      padding:"7px 14px",
                      borderRadius:99,
                      border:`1px solid ${ACCENT}60`,
                      background:`${ACCENT}18`,
                      color:ACCENT,
                      fontSize:13, fontWeight:600, cursor:"pointer",
                      display:"inline-flex", alignItems:"center", gap:6,
                    }}
                  >
                    Switch to All time
                  </button>
                </div>
              )}
              {search !== "" && (
                <div style={{ display:"flex", flexDirection:"column", gap:10, alignItems:"center" }}>
                  <div style={{ color:"var(--text-muted)", fontSize:14, maxWidth:480, overflowWrap:"anywhere" }}>
                    No entries match <span style={{ color:"var(--text-strong)", fontWeight:600 }}>&ldquo;{search}&rdquo;</span>.
                  </div>
                  <button
                    onClick={() => setSearch("")}
                    style={{
                      padding:"7px 14px",
                      borderRadius:99,
                      border:`1px solid ${ACCENT}60`,
                      background:`${ACCENT}18`,
                      color:ACCENT,
                      fontSize:13, fontWeight:600, cursor:"pointer",
                      display:"inline-flex", alignItems:"center", gap:6,
                    }}
                  >
                    Clear search
                  </button>
                </div>
              )}
            </div>
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
                  meals={meals}
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
            // CYCLE row — single-line summary card. No expandable body.
            if (r.kind === "cycle") {
              const c = r.data;
              return (
                <CycleRowCard
                  key={c.id}
                  log={c}
                  onDelete={() => handleDeleteCycle(c.id)}
                  deleting={deleting === c.id}
                  onUpdated={(updated) => {
                    setCycle(xs => xs.map(prev => prev.id === updated.id ? updated : prev));
                  }}
                />
              );
            }
            // SYMPTOM row — collapsible NonMealRow with inline editor.
            // Collapsed view shows date + time on the left (matching
            // meal entries), expanded view exposes severity + types
            // and an Edit button (Task: symptom/influence collapsible).
            if (r.kind === "symptoms") {
              const s = r.data;
              const isOpen = expanded === s.id;
              return (
                <SymptomRowCard
                  key={s.id}
                  log={s}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : s.id)}
                  onDelete={() => handleDeleteSymptom(s.id)}
                  deleting={deleting === s.id}
                  onUpdated={(updated) => {
                    setSymptoms(xs => xs.map(prev => prev.id === updated.id ? updated : prev));
                  }}
                />
              );
            }
            // INFLUENCES row — collapsible NonMealRow with inline editor.
            if (r.kind === "influences") {
              const i = r.data;
              const isOpen = expanded === i.id;
              return (
                <InfluenceRowCard
                  key={i.id}
                  log={i}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : i.id)}
                  onDelete={() => handleDeleteInfluence(i.id)}
                  deleting={deleting === i.id}
                  onUpdated={(updated) => {
                    setInfluences(xs => xs.map(prev => prev.id === updated.id ? updated : prev));
                  }}
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
                  allLogs={exercise}
                  isOpen={isOpen}
                  onToggle={() => expandRow(isOpen ? null : x.id)}
                  onDelete={() => handleDeleteExercise(x.id)}
                  deleting={deleting === x.id}
                  onUpdated={(updated) => {
                    setExercise(xs => xs.map(prev => prev.id === updated.id ? updated : prev));
                  }}
                />
              );
            }
            // MEAL row — original rendering preserved below.
            const m = r.data;
            const isOpen = expanded === m.id;
            // Outcome shown in the OUTCOME card (label + "Insulin-Dosis hat …"
            // explanation) MUST come from the same source as the lifecycle
            // chip (chipState.ts:83) — otherwise the chip can show
            // HYPO_DURING while the explanation directly under it still
            // says "Gut, Insulin passte". `meal.evaluation` is a write-time
            // DB cache and can lag behind curve-backfill or sparse-hypo
            // recomputation (Task #253); trust the live `lifecycleFor`
            // outcome and fall back to the cache only when the lifecycle
            // has nothing to say (pending / outside-window / pre-curve).
            const mLc = lifecycleFor(m);
            const ev = resolveDisplayedOutcome(m);
            const date = parseDbDate(m.meal_time ?? m.created_at);
            const dateStr = date.toLocaleDateString(locale, { month:"short", day:"numeric" });
            const totalProt = m.protein_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.protein||0),0) : 0);
            const totalFat  = m.fat_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fat||0),0) : 0);
            const totalFiber = m.fiber_grams ?? (Array.isArray(m.parsed_json) ? m.parsed_json.reduce((s,f)=>s+(f.fiber||0),0) : 0);
            const carbs = m.carbs_grams ?? 0;
            const netCarbs = Math.max(0, carbs - totalFiber);
            const icr = m.insulin_units && m.insulin_units > 0 ? netCarbs / m.insulin_units : null;
            // BG AFTER picks the freshest post-meal reading: prefer 2h (more
            // authoritative, captures peak settling), fall back to 1h, then to
            // any manually-recorded glucose_after. Tag and timestamp track in
            // lock-step so DELTA + TIME GAP describe the same data point.
            const afterValue: number | null =
              m.bg_2h ?? m.bg_1h ?? m.glucose_after ?? null;
            const afterAtIso: string | null =
              m.bg_2h != null ? (m.bg_2h_at ?? null)
              : m.bg_1h != null ? (m.bg_1h_at ?? null)
              : null;
            const afterTag: "1H" | "2H" | null =
              m.bg_2h != null ? "2H"
              : m.bg_1h != null ? "1H"
              : null;
            const glucDelta = (afterValue != null && m.glucose_before)
              ? afterValue - m.glucose_before
              : null;
            // Time gap: minutes between meal_time and the chosen reading's
            // recorded-at. Formatted "1h 02m" or "47m" depending on size.
            const timeGapStr: string | null = (() => {
              if (!afterAtIso || !m.meal_time) return null;
              const diffMs = parseDbTs(afterAtIso) - parseDbTs(m.meal_time);
              if (!Number.isFinite(diffMs) || diffMs <= 0) return null;
              const totalMin = Math.round(diffMs / 60_000);
              const h = Math.floor(totalMin / 60);
              const mm = totalMin % 60;
              return h > 0 ? `${h}h ${String(mm).padStart(2, "0")}m` : `${mm}m`;
            })();
            const bgC = m.glucose_before ? (m.glucose_before > 140 ? ORANGE : m.glucose_before < 80 ? PINK : GREEN) : "var(--text-body)";
            const afterC = afterValue != null ? (afterValue > 180 || afterValue < 70 ? PINK : GREEN) : "var(--text-faint)";
            const deltaC = glucDelta !== null ? (Math.abs(glucDelta) < 50 ? GREEN : glucDelta > 0 ? ORANGE : PINK) : "var(--text-faint)";
            const evColor = evC(ev);

            // MiniCard — eine Kachel im 3-Spalten-Makros-Grid. `minWidth:0`
            // damit das Grid `minmax(0,1fr)` greift und lange Werte wie
            // "Schnelle Kohlenhydrate" (KATEGORIE-Tile) nicht über den
            // Kartenrand rutschen. `wordBreak:"break-word"` lässt mehr-
            // wörtige Werte umbrechen statt zu clippen.
            const MiniCard = ({ l, v, c, icon }: { l: string; v: string; c?: string; icon?: React.ReactNode }) => (
              <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px", minWidth:0, overflow:"hidden" }}>
                <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:14, fontWeight:700, color:c || "var(--text-strong)", letterSpacing:"-0.01em", wordBreak:"break-word", lineHeight:1.3, display:"flex", alignItems:"center", gap:5 }}>
                  <span>{v}</span>
                  {icon}
                </div>
              </div>
            );

            const catColor = m.meal_type ? (TYPE_COLORS[m.meal_type] || GREEN) : null;
            const catLabel = txTypeLabel(m.meal_type ?? null);
            const catExplain = txTypeExplain(m.meal_type ?? null);

            return (
              <div key={m.id} id={`entry-${m.id}`} className="entry-row" style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
                {/* Pending post-meal BG strip — only renders when this
                    meal is currently inside a 30min/1h/90min/2h/3h
                    window AND the matching glucose_* column is still
                    null. Replaces the old global floating PostMealPrompt
                    banner with a dezent inline badge directly on the
                    affected meal card. Patches local state on save so
                    the strip disappears without refetching the list. */}
                <PendingGlucoseStrip
                  meal={m}
                  onSaved={(patch) => setMeals(ms => ms.map(x => x.id === m.id ? { ...x, ...patch } : x))}
                />
                {/* Header — collapsed shows summary; expanded shows only date + time */}
                {!isOpen ? (
                  <MealEntryCardCollapsed meal={m} onClick={() => expandRow(m.id)}/>
                ) : (
                  <div onClick={() => expandRow(null)} style={{ padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
                    <div style={{ fontSize:13, color:"var(--text-muted)", letterSpacing:"0.02em" }}>
                      {dateStr}
                      <span style={{ color:"var(--text-ghost)", margin:"0 8px" }}>·</span>
                      {fmtTime(date)}
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:"rotate(90deg)", transition:"transform 0.2s", flexShrink:0 }}>
                      <polyline points="9 6 15 12 9 18"/>
                    </svg>
                  </div>
                )}

                {/* Full entry body — shown directly on expand (no light intermediate).
                    When editingId === m.id, the read-only blocks are swapped
                    out for an inline editor so the user can correct macros +
                    bolus after the fact. */}
                {isOpen && editingId === m.id && (
                  <div style={{ padding:"4px 16px 16px", borderTop:`1px solid var(--surface-soft)` }}>
                    <MealEditor
                      meal={m}
                      onSaved={(updated) => {
                        setMeals(ms => ms.map(x => x.id === m.id ? updated : x));
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                )}
                {isOpen && editingId !== m.id && (
                  <div style={{ padding:"4px 16px 16px", borderTop:`1px solid var(--surface-soft)`, display:"flex", flexDirection:"column", gap:14 }}>
                    {/* CGM POST-FETCH COUNTDOWN — visual 1h/2h auto-fetch state */}
                    <CgmCountdownPair
                      logId={m.id}
                      baseline={m.glucose_before}
                      themeColor={GREEN}
                      slots={[
                        {
                          label: tx("post_label_1h"),
                          fetchType: "bg_1h",
                          fetchedValue: m.bg_1h,
                          fetchedAtIso: m.bg_1h_at,
                          windowStartIso: parseDbDate(m.meal_time ?? m.created_at).toISOString(),
                          expectedFetchAtIso: new Date(parseDbDate(m.meal_time ?? m.created_at).getTime() + 60 * 60_000).toISOString(),
                        },
                        {
                          label: tx("post_label_2h"),
                          fetchType: "bg_2h",
                          fetchedValue: m.bg_2h,
                          fetchedAtIso: m.bg_2h_at,
                          windowStartIso: parseDbDate(m.meal_time ?? m.created_at).toISOString(),
                          expectedFetchAtIso: new Date(parseDbDate(m.meal_time ?? m.created_at).getTime() + 120 * 60_000).toISOString(),
                        },
                      ]}
                    />
                    {/* LIFECYCLE — pending / provisional / final */}
                    <LifecycleBlock
                      meal={m}
                      onUpdated={(patch) => setMeals(ms => ms.map(x => x.id === m.id ? { ...x, ...patch } : x))}
                    />
                    {/* OUTCOME — highlighted card. Hidden whenever LifecycleBlock
                        already has an outcome to show (final OR provisional with
                        1h reading) — in those cases the chip + explanation are
                        already rendered above and showing this block too would
                        be a duplicate. Only shown when lifecycle has no outcome
                        yet (pending / outside-window) so ev comes from the
                        DB-cached m.evaluation as a fallback. */}
                    {ev && mLc.outcome == null && (
                      <div style={{ marginTop:14, background:`${evColor}10`, border:`1px solid ${evColor}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
                          <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>{tx("outcome_section").toUpperCase()}</div>
                          <span style={{ padding:"6px 14px", borderRadius:99, fontSize:13, fontWeight:700, background:evColor, color:"var(--on-accent)", whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase" }}>
                            {txEvalLabel(ev)}
                          </span>
                        </div>
                        {txEvalExplain(ev, m.insulin_units) && (
                          <div style={{ fontSize:13, color:"var(--text-muted)", lineHeight:1.5 }}>{txEvalExplain(ev, m.insulin_units)}</div>
                        )}
                      </div>
                    )}

                    {/* CLASSIFICATION — highlighted card with explanation */}
                    {catLabel && catColor && (
                      <div style={{ background:`${catColor}10`, border:`1px solid ${catColor}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 }}>
                        {/* `flexWrap:"wrap"` + `minWidth:0` auf dem Label
                            sorgen dafür, dass die "SCHNELLE KOHLEN-
                            HYDRATE"-Pill (länger als der englische
                            "FAST CARBS") auf engen Phones in die
                            nächste Zeile rutscht statt den orangen
                            Kartenrand zu sprengen. Pill bleibt mit
                            `flexShrink:0` zusammen, damit der Text
                            innen nicht unschön bricht. */}
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
                          <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700, minWidth:0 }}>{tx("meal_classification").toUpperCase()}</div>
                          <span style={{ padding:"6px 14px", borderRadius:99, fontSize:13, fontWeight:700, background:catColor, color:"var(--on-accent)", whiteSpace:"nowrap", letterSpacing:"0.04em", textTransform:"uppercase", flexShrink:0, maxWidth:"100%" }}>
                            {catLabel}
                          </span>
                        </div>
                        {catExplain && (
                          <div style={{ fontSize:13, color:"var(--text-muted)", lineHeight:1.5 }}>{catExplain}</div>
                        )}
                      </div>
                    )}

                    {/* IOB SPARKLINE — shows bolus decay profile for this meal */}
                    {(m.insulin_units ?? 0) > 0 && (() => {
                      const dose     = m.insulin_units!;
                      const adminAt  = m.meal_time ?? m.created_at;
                      const nowMs    = Date.now();
                      const diaMin   = getDIAMinutes(insulinType, getInsulinSettings().diaMinutes);
                      const elapsedMin = Math.max(0, (nowMs - new Date(adminAt).getTime()) / 60_000);
                      const iobNow   = calcSingleIOB({ units: dose, administeredAt: adminAt } as BolusDose, nowMs, diaMin);
                      const cleared  = iobNow < 0.05 || elapsedMin >= diaMin;
                      const STEPS    = 60;
                      const W = 220, H = 52, PAD = 4;
                      const pts = Array.from({ length: STEPS + 1 }, (_, i) => {
                        const t     = (i / STEPS) * diaMin;
                        const ratio = Math.pow(1 - Math.min(t, diaMin) / diaMin, 2);
                        const x     = (i / STEPS) * W;
                        const y     = PAD + (1 - ratio) * (H - PAD * 2);
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      }).join(" ");
                      const elapsedX = Math.min((elapsedMin / diaMin) * W, W);
                      const chipColor = iobNow < 1 ? GREEN : iobNow < 3 ? "#F59E0B" : ORANGE;
                      return (
                        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                          <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.1em", fontWeight:700 }}>
                            {tx("iob_profile").toUpperCase()}
                          </div>
                          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display:"block", overflow:"visible" }}>
                            <defs>
                              <clipPath id={`iob-future-${m.id}`}>
                                <rect x={elapsedX} y="0" width={W - elapsedX} height={H}/>
                              </clipPath>
                            </defs>
                            {/* full gray curve */}
                            <polyline points={pts} fill="none" stroke="var(--text-ghost)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.35"/>
                            {/* colored remaining curve */}
                            {!cleared && (
                              <polyline points={pts} fill="none" stroke={chipColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#iob-future-${m.id})`}/>
                            )}
                            {/* current-time marker */}
                            {!cleared && (
                              <line x1={elapsedX} y1={PAD - 2} x2={elapsedX} y2={H - PAD + 2} stroke={chipColor} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8"/>
                            )}
                          </svg>
                          <div>
                            {cleared ? (
                              <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:"var(--surface-soft)", color:"var(--text-ghost)", letterSpacing:"0.04em" }}>
                                {tx("iob_fully_cleared")}
                              </span>
                            ) : (
                              <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:700, background:`${chipColor}22`, color:chipColor, letterSpacing:"0.04em" }}>
                                {tx("iob_still_active", { units: iobNow.toFixed(1) })}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* MEAL */}
                    {m.input_text && (
                      <div>
                        <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.1em", fontWeight:700, margin:"4px 0 6px" }}>{tx("meal_section").toUpperCase()}</div>
                        <div style={{ fontSize:14, color:"var(--text-body)", lineHeight:1.55 }}>{m.input_text}</div>
                      </div>
                    )}

                    {/* RELATED MEAL — this entry is itself a correction bolus */}
                    {m.related_meal_id && (() => {
                      const parent = meals.find(x => x.id === m.related_meal_id);
                      return (
                        <div style={{ background:`${ACCENT}10`, border:`1px solid ${ACCENT}40`, borderRadius:12, padding:"10px 12px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                          <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0 }}>
                            <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>{tx("korrektur_bolus").toUpperCase()}</div>
                            <div style={{ fontSize:13, color:"var(--text-body)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {parent ? tx("korrektur_for", { text: parent.input_text.length > 50 ? parent.input_text.slice(0, 50) + "…" : parent.input_text }) : tx("original_deleted")}
                            </div>
                          </div>
                          <span style={{ padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700, background:ACCENT, color:"var(--on-accent)", whiteSpace:"nowrap", letterSpacing:"0.04em" }}>K</span>
                        </div>
                      );
                    })()}

                    {/* CORRECTION BOLI — other entries that reference this meal */}
                    {(() => {
                      const corrections = meals.filter(x => x.related_meal_id === m.id);
                      if (corrections.length === 0) return null;
                      const totalCorrInsulin = corrections.reduce((s, c) => s + (c.insulin_units || 0), 0);
                      return (
                        <div style={{ background:`${ACCENT}08`, border:`1px solid ${ACCENT}30`, borderRadius:12, padding:"10px 12px", display:"flex", flexDirection:"column", gap:8 }}>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                            <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
                              {tx("korrekturen", { n: corrections.length }).toUpperCase()}
                            </div>
                            <span style={{ padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700, background:`${ACCENT}25`, color:ACCENT, border:`1px solid ${ACCENT}50`, whiteSpace:"nowrap" }}>
                              {tx("total_suffix", { total: totalCorrInsulin.toFixed(1) })}
                            </span>
                          </div>
                          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                            {corrections.map(c => {
                              const t = parseDbDate(c.meal_time ?? c.created_at);
                              const timeStr = fmtTime(t);
                              return (
                                <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, fontSize:13.5, color:"var(--text-muted)" }}>
                                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{timeStr}</span>
                                  <span style={{ color:ACCENT, fontWeight:700, flexShrink:0 }}>{c.insulin_units ?? 0}u</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* MACROS & DOSING — 3-col grid of mini-cards */}
                    <div>
                      <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>{tx("macros_dosing").toUpperCase()}</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0, 1fr))", gap:8 }}>
                        {/* CARBS / NET CARBS render in the user's chosen
                            unit (g/BE/KE). Other macros stay in grams —
                            the BE/KE convention is carb-specific. */}
                        <MiniCard l={tx("mini_carbs")} v={carbUnit.display(carbs)} c={ORANGE}/>
                        <MiniCard l={tx("mini_protein")} v={totalProt > 0 ? `${totalProt}g` : "—"} c="#3B82F6"/>
                        <MiniCard l={tx("mini_fat")} v={totalFat > 0 ? `${totalFat}g` : "—"} c="#A855F7"/>
                        <MiniCard l={tx("mini_fiber")} v={totalFiber > 0 ? `${totalFiber}g` : "—"}/>
                        <MiniCard l={tx("mini_net_carbs")} v={netCarbs > 0 ? carbUnit.display(netCarbs) : "—"} c={GREEN}/>
                        <MiniCard l={tx("mini_calories")} v={(() => { const cals = m.calories ?? Math.round(carbs*4 + totalProt*4 + totalFat*9); return cals > 0 ? `${cals} kcal` : "—"; })()} c="#A78BFA"/>
                        <MiniCard l={tx("mini_insulin")} v={`${m.insulin_units ?? 0}u`} c={ACCENT}/>
                        {/* Per-meal carb-to-insulin ratio. icr is computed
                            in g/IE; displayICR converts it to the user's
                            unit (e.g. "2 BE/IE" / "2.4 KE/IE" / "24 g KH/IE"). */}
                        <MiniCard l={tx("mini_ratio")} v={icr ? carbUnit.displayICR(icr) : "—"} c={ACCENT}/>
                        <MiniCard l={tx("mini_category")} v={catLabel ?? "—"} c={m.meal_type ? (TYPE_COLORS[m.meal_type] || GREEN) : undefined}/>
                      </div>
                    </div>

                    {/* GLUCOSE — 2-col grid of mini-cards */}
                    <div>
                      <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8 }}>{tx("glucose_section").toUpperCase()}</div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
                        <MiniCard l={tx("mini_bg_before")} v={m.glucose_before ? `${m.glucose_before} mg/dL` : "—"} c={bgC} icon={m.pre_meal_trend ? <MealTrendArrow trend={m.pre_meal_trend} size="sm"/> : undefined}/>
                        <MiniCard l={afterTag ? `${tx("mini_bg_after")} (${afterTag})` : tx("mini_bg_after")} v={afterValue != null ? `${afterValue} mg/dL` : "—"} c={afterC}/>
                        <MiniCard l={afterTag ? `${tx("mini_delta")} (${afterTag})` : tx("mini_delta")} v={glucDelta !== null ? `${glucDelta > 0 ? "+" : ""}${glucDelta} mg/dL` : "—"} c={deltaC}/>
                        <MiniCard l={tx("mini_time_gap")} v={timeGapStr ?? "—"} c={timeGapStr ? "var(--text-strong)" : undefined}/>
                      </div>
                    </div>

                    {/* EDIT + DELETE — side by side. Edit swaps the body for
                        an inline editor (handled at the panel root above).
                        2026-05-18: IosTapButton fixes the same iOS WKWebView
                        click-race that bit Exercise rows — tapping Edit
                        flipped to setEditingId(m.id), which synchronously
                        replaced this whole block with the editor, and the
                        synthesised click sometimes retargeted onto the
                        parent row header (collapsing the row instead). */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:4 }}>
                      <IosTapButton
                        onAct={() => setEditingId(m.id)}
                        ariaLabel={tx("edit")}
                        style={{ padding:"12px", borderRadius:10, border:`1px solid ${ACCENT}40`, background:`${ACCENT}08`, color:ACCENT, fontSize:14, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, letterSpacing:"0.02em" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                        {tx("edit")}
                      </IosTapButton>
                      <IosTapButton
                        onAct={() => handleDelete(m.id)}
                        disabled={deleting === m.id}
                        ariaLabel={deleting === m.id ? tx("deleting") : tx("delete")}
                        style={{ padding:"12px", borderRadius:10, border:`1px solid ${PINK}40`, background:`${PINK}08`, color:PINK, fontSize:14, fontWeight:600, cursor:deleting === m.id ? "wait" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, letterSpacing:"0.02em" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                        {deleting === m.id ? tx("deleting") : tx("delete")}
                      </IosTapButton>
                    </div>
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
      <span style={{ fontSize:13, color:"var(--text-faint)" }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:500, color:color||"var(--text-body)" }}>{val}</span>
    </div>
  );
}

// Lifecycle chip palette aligned with lib/engine/chipState — pending stays
// neutral (no premature outcome signal), provisional uses muted purple, and
// final hands off to the per-outcome color via getEvalColor in callers.
function stateColor(s: OutcomeState) {
  if (s === "pending")     return "#0EA5E9"; // teal = active monitoring
  if (s === "provisional") return "#7C3AED";
  return GREEN;
}

function LifecycleBlock({ meal, onUpdated }: { meal: Meal; onUpdated: (patch: Partial<Meal>) => void }) {
  const lc = lifecycleFor(meal);
  // i18n for the lifecycle chip label + section heading. Falls back to
  // the lib's hardcoded English strings when a key is missing so a future
  // outcome value still renders something readable.
  const tx = useTranslations("entriesExpand");
  const tEngine = useTranslations("engine");
  const txSafe = (key: string, fallback: string): string => {
    try { return tx(key); } catch { return fallback; }
  };
  // When the lifecycle has reached "final" with a real outcome, swap the
  // generic "Final outcome" chip for the actual evaluation result (Good /
  // Spike / Over Dose / …) and color-code it via the outcome palette so
  // the user sees the verdict at a glance instead of a meta-state label.
  const showOutcomeChip = lc.state === "final" && lc.outcome != null;
  const chipLabel = showOutcomeChip
    ? txSafe(`eval_${lc.outcome}`, getEvalLabel(lc.outcome))
    : lc.state === "pending"
      ? txSafe("state_monitoring", "Aktive Überwachung")
      : txSafe(`state_${lc.state}`, STATE_LABELS[lc.state]);
  const c = showOutcomeChip ? getEvalColor(lc.outcome) : stateColor(lc.state);
  // Minutes until the 3h final evaluation closes.
  const minsUntilFinal = lc.state !== "final"
    ? Math.max(0, Math.round(180 - lc.ageMinutes))
    : 0;

  return (
    <div style={{ marginTop:14, background:`${c}10`, border:`1px solid ${c}40`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>{tx("outcome_state").toUpperCase()}</div>
          {lc.state === "pending" && minsUntilFinal > 0 && (
            <div style={{ fontSize:11, color:c, fontWeight:600 }}>
              {txSafe("state_monitoring_countdown", `Finale Bewertung in ${minsUntilFinal} min`).replace("{min}", String(minsUntilFinal))}
            </div>
          )}
        </div>
        <span style={{ padding:"6px 14px", borderRadius:99, fontSize:13, fontWeight:700, background:c, color:"var(--on-accent)", letterSpacing:"0.04em", textTransform:"uppercase" }}>
          {chipLabel}
        </span>
      </div>
      {lc.state !== "pending" && (
        <div style={{ fontSize:13, color:"var(--text-muted)", lineHeight:1.5 }}>{renderEngineMessages(tEngine, lc.messages)}</div>
      )}
      {(lc.delta1 != null || lc.delta2 != null) && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:2 }}>
          <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.08em", fontWeight:600 }}>Δ 1H</div>
            <div style={{ fontSize:14, fontWeight:700, color: lc.delta1 != null ? "var(--text-strong)" : "var(--text-faint)" }}>
              {lc.delta1 != null ? `${lc.delta1 > 0 ? "+" : ""}${lc.delta1} mg/dL` : "—"}
              {lc.speed1 != null && <span style={{ fontSize:12, color:"var(--text-dim)", marginLeft:6 }}>({lc.speed1.toFixed(2)}/min)</span>}
            </div>
          </div>
          <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px" }}>
            <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.08em", fontWeight:600 }}>Δ 2H</div>
            <div style={{ fontSize:14, fontWeight:700, color: lc.delta2 != null ? "var(--text-strong)" : "var(--text-faint)" }}>
              {lc.delta2 != null ? `${lc.delta2 > 0 ? "+" : ""}${lc.delta2} mg/dL` : "—"}
              {lc.speed2 != null && <span style={{ fontSize:12, color:"var(--text-dim)", marginLeft:6 }}>({lc.speed2.toFixed(2)}/min)</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadingInput({ label, value, onChange, onSave, busy, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; onSave: () => void; busy: boolean; placeholder: string;
}) {
  return (
    <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:8, padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.08em", fontWeight:600 }}>{label.toUpperCase()}</div>
      <div style={{ display:"flex", gap:6 }}>
        <input
          type="number" inputMode="numeric" min={30} max={600}
          value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSave(); } }}
          style={{ flex:1, minWidth:0, padding:"6px 8px", borderRadius:6, border:`1px solid ${BORDER}`, background:"var(--surface-soft)", color:"var(--text-strong)", fontSize:14, fontWeight:600 }}
        />
        <button
          onClick={onSave} disabled={busy}
          style={{ padding:"6px 10px", borderRadius:6, border:`1px solid ${ACCENT}40`, background:`${ACCENT}18`, color:ACCENT, fontSize:13, fontWeight:700, cursor: busy ? "wait" : "pointer" }}
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
  id,
  isOpen, onToggle, onDelete, deleting, onEdit, accent, badge, dateStr, timeStr,
  primaryLabel, primaryValue, primaryColor, primaryMono,
  secondaryLabel, secondaryValue, secondaryColor, secondaryMono,
  secondarySubtitle,
  sourceBadge,
  expandedDetails,
  suppressActions,
}: {
  /** Optional DOM id — used for hash deep-link scroll targeting (e.g. id="entry-insulin-<uuid>"). */
  id?: string;
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  /** Optional Edit affordance — when provided, an Edit button is
   *  rendered next to Delete in the expanded action row. Used by
   *  ExerciseRowCard to surface the inline ExerciseEditor. */
  onEdit?: () => void;
  /** When true, the bottom Edit/Delete action row is hidden entirely.
   *  Set by RowCards while their inline editor is open so the editor's
   *  own Save/Cancel buttons can't be misrouted to Delete on iOS via
   *  the WKWebView click-race (user-report 2026-05-18: tapping
   *  Speichern opened the Delete confirm). The editor still has its
   *  own Cancel; Delete is reachable again after Save/Cancel. */
  suppressActions?: boolean;
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
  /** Optional override — defaults to false. Mono should only be used
   *  on numeric primary values (e.g. exercise duration "30m"); brand
   *  names ("Fiasp", "Tresiba") render in the default font so the
   *  card matches the chip typography. */
  primaryMono?: boolean;
  /** Optional second line under the secondary value — used by bolus rows
   *  to surface the historic ICR snapshot (e.g. "@ 2 BE/IE"). Rendered
   *  in muted text and elided on small screens to avoid layout shifts. */
  secondarySubtitle?: string;
  /** Optional small chip rendered under the kind badge on the collapsed
   *  row — used by the exercise row to surface the "Apple Health"
   *  provenance pill for `source = 'apple_health'`. */
  sourceBadge?: React.ReactNode;
  expandedDetails: React.ReactNode;
}) {
  const tx = useTranslations("entriesExpand");
  return (
    <div id={id} style={{ background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden" }}>
      {!isOpen ? (
        <div onClick={onToggle} className="glev-mec" style={{
          padding:"14px 16px", cursor:"pointer", alignItems:"start",
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
          {/* Col 1: Date over time — matches the MealEntryCardCollapsed
              two-line "When" cell so every entry in the stream (meal,
              bolus, basal, exercise, …) has a consistent timestamp
              format. Before this the bolus/basal/exercise rows hid the
              clock time on the collapsed view, which was confusing
              when the row directly above (a meal) did show it. */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{tx("row_when")}</div>
            <div style={{ fontSize:14, fontWeight:600, color:"var(--text-strong)", letterSpacing:"-0.01em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {dateStr}
            </div>
            <div style={{ fontSize:12, fontWeight:500, color:"var(--text-dim)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {timeStr}
            </div>
          </div>
          {/* Col 2: Kind badge */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{tx("row_type")}</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, minWidth:0 }}>
              <span style={{ width:7, height:7, borderRadius:99, background:accent, opacity:0.85, flexShrink:0 }}/>
              <span style={{ fontSize:13, fontWeight:700, color:accent, letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{badge}</span>
            </div>
            {sourceBadge && (
              <div style={{ marginTop:4 }}>{sourceBadge}</div>
            )}
          </div>
          {/* Col 3: Primary metric (Dose / Duration) */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{primaryLabel}</div>
            <div style={{ fontSize:14, fontWeight:700, color:primaryColor, letterSpacing:"-0.01em", fontFamily: primaryMono ? "var(--font-mono)" : undefined }}>{primaryValue}</div>
          </div>
          {/* Col 4: Secondary — neutral by default; bolus/basal pass an
              accent + mono override so DOSE keeps its prominent styling.
              Optional `secondarySubtitle` adds a muted second line (used
              by bolus rows for the historic ICR snapshot). */}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:3, textTransform:"uppercase" }}>{secondaryLabel}</div>
            <div
              title={secondarySubtitle ? `${secondaryValue} ${secondarySubtitle}` : secondaryValue}
              style={{
                fontSize: secondaryMono ? 14 : 13,
                fontWeight: secondaryMono ? 700 : 600,
                color: secondaryColor || "var(--text-strong)",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontFamily: secondaryMono ? "var(--font-mono)" : undefined,
              }}
            >
              {secondaryValue}
            </div>
            {secondarySubtitle && (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-muted)",
                  letterSpacing: "0.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginTop: 2,
                }}
              >
                {secondarySubtitle}
              </div>
            )}
          </div>
          {/* Col 5: chevron */}
          <span className="glev-mec-eval" style={{
            justifySelf:"end", padding:"5px 10px", borderRadius:99, fontSize:12, fontWeight:700,
            background:`${accent}18`, color:accent, border:`1px solid ${accent}30`,
            whiteSpace:"nowrap", letterSpacing:"0.05em", textTransform:"uppercase",
          }}>{badge}</span>
        </div>
      ) : (
        <div onClick={onToggle} style={{ padding:"14px 16px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
          <div style={{ fontSize:13, color:"var(--text-muted)", letterSpacing:"0.02em" }}>
            {dateStr}
            <span style={{ color:accent, fontWeight:700, marginLeft:10, letterSpacing:"0.04em" }}>{badge}</span>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" style={{ transform:"rotate(90deg)", flexShrink:0 }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        </div>
      )}

      {isOpen && (
        <div style={{ padding:"4px 16px 16px", borderTop:`1px solid var(--surface-soft)`, display:"flex", flexDirection:"column", gap:12 }}>
          {expandedDetails}
          {!suppressActions && (
          <div style={{
            marginTop:4,
            display:"grid",
            gridTemplateColumns: onEdit ? "1fr 1fr" : "1fr",
            gap:8,
          }}>
            {/* 2026-05-18: User-Report "edit entry auf expanded exercise
                log springt nicht in edit mode sondern collapsed alle
                entries". Root cause = gleiche iOS-WKWebView Click-Race
                wie Task #356 (Footer-Nav): `setEditing(true)` rendert
                den Button-DOM-Knoten neu, und der synthetisierte Click
                wird auf WKWebView unzuverlässig auf den neuen Node
                gemapped — manchmal landet er stattdessen auf dem
                darunterliegenden Card-Body oder triggert das parent
                onToggle. Fix mirrors MobileTab: feuere onEdit/onDelete
                auf pointerup mit stopPropagation, `onClick` bleibt nur
                Tastatur-Fallback (gated via pointerHandledRef). */}
            {onEdit && (
              <IosTapButton
                onAct={onEdit}
                disabled={deleting}
                ariaLabel="Edit entry"
                style={{
                  padding:"12px", borderRadius:10, border:`1px solid ${BORDER}`,
                  background:"var(--surface-soft)", color:"var(--text-body)",
                  fontSize:14, fontWeight:600,
                  cursor:deleting ? "not-allowed" : "pointer",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  letterSpacing:"0.02em",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                Edit entry
              </IosTapButton>
            )}
            <IosTapButton
              onAct={onDelete}
              disabled={deleting}
              ariaLabel={deleting ? "Deleting" : "Delete entry"}
              style={{
                padding:"12px", borderRadius:10, border:`1px solid ${PINK}40`,
                background:`${PINK}08`, color:PINK, fontSize:14, fontWeight:600,
                cursor:deleting ? "wait" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, letterSpacing:"0.02em",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
              {deleting ? "Deleting…" : "Delete entry"}
            </IosTapButton>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────── Manual backfill for Bolus / Basal post-checkpoints ────────────────
// Lets the user enter a meter reading when the auto-fetch worker either
// never had data (CGM disconnected, history older than ~12h) or the job
// timed out before the user opened the app. Shows one input per slot
// where the current value is null AND we're within 30 min of the
// expected time or past it. Mirrors LifecycleBlock for meals.
type BackfillField = "after_1h" | "after_2h" | "after_12h" | "after_24h";
function InsulinReadingsBackfill({ logId, slots }: {
  logId: string;
  slots: Array<{
    label: string;        // e.g. "1H reading"
    field: BackfillField;
    expectedAt: Date;
    currentValue: number | null;
  }>;
}) {
  const txBf = useTranslations("entriesExpand");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<BackfillField | null>(null);
  const [err,  setErr]  = useState<string | null>(null);

  // Surface inputs once we're within 30 min of the expected time —
  // matches the meal LifecycleBlock grace window.
  const GRACE_MS = 30 * 60_000;
  const visible = slots.filter(s =>
    s.currentValue == null && Date.now() >= s.expectedAt.getTime() - GRACE_MS
  );
  if (visible.length === 0) return null;

  async function save(s: typeof slots[number]) {
    const raw = (inputs[s.field] ?? "").trim();
    const n = raw === "" ? null : Number(raw);
    if (n != null && (!Number.isFinite(n) || n < 30 || n > 600)) {
      setErr(txBf("ex_backfill_err_range"));
      return;
    }
    setBusy(s.field); setErr(null);
    try {
      await updateInsulinReadings(logId, { [s.field]: n });
      // Trigger the entry-page refresh so the new value flows into the
      // expanded view, evaluation copy, and outcome badge.
      window.dispatchEvent(new CustomEvent("glev:insulin-updated"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : txBf("ex_backfill_err_save"));
    } finally { setBusy(null); }
  }

  return (
    <div style={{
      background: "var(--surface-soft)",
      border: `1px solid ${BORDER}`,
      borderRadius: 10,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.08em", fontWeight:600 }}>
        {txBf("ex_manual_override")}
      </div>
      <div style={{ fontSize:13, color:"var(--text-muted)", lineHeight:1.5 }}>
        {txBf("ex_backfill_hint")}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: visible.length > 1 ? "repeat(2,1fr)" : "1fr",
        gap: 8,
      }}>
        {visible.map(s => (
          <ReadingInput
            key={s.field}
            label={s.label}
            value={inputs[s.field] ?? ""}
            onChange={(v) => setInputs(prev => ({ ...prev, [s.field]: v }))}
            onSave={() => save(s)}
            busy={busy === s.field}
            placeholder="mg/dL"
          />
        ))}
      </div>
      {err && <div style={{ fontSize:13, color:PINK }}>{err}</div>}
    </div>
  );
}

// ──────────────── BOLUS ↔ MEAL retroactive link panel ────────────────
// Sits inside the expanded BolusRowCard. Three states:
//   1. linked    → shows the meal's snippet + time, "Andere wählen" / "Lösen"
//   2. unlinked  → single "Mit Mahlzeit verknüpfen…" button
//   3. picker    → searchable list of meals within ±14 days of the bolus,
//                  closest in time first (most likely candidate at the top)
// Writes via PATCH /api/insulin/[id] → `updateInsulinLogLink`, then
// dispatches `glev:insulin-updated` so the entries page reloads its rows
// and the new link is reflected immediately without a manual refresh.
function BolusMealLinkPanel({ log, meals }: { log: InsulinLog; meals: Meal[] }) {
  const tx = useTranslations("entriesExpand");
  const locale = useLocale();
  const { format: fmtTime } = useTimeFormat();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const bolusMs = parseDbDate(log.created_at).getTime();
  const linked = useMemo(
    () => meals.find(m => m.id === log.related_entry_id) ?? null,
    [meals, log.related_entry_id],
  );

  // Candidate meals: ±14 days around the bolus, sorted by absolute
  // distance to the bolus timestamp (closest first). 14d is a wide net
  // for the rare "I forgot for a week" case but keeps the list small
  // enough to scroll on a phone.
  const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return meals
      .map(m => {
        const refIso = m.meal_time ?? (m as unknown as { created_at?: string }).created_at;
        const ms = refIso ? parseDbDate(refIso).getTime() : NaN;
        return { m, ms, dist: Number.isFinite(ms) ? Math.abs(ms - bolusMs) : Infinity };
      })
      .filter(({ m, dist }) => {
        if (dist > WINDOW_MS) return false;
        if (m.id === log.related_entry_id) return false;
        if (!q) return true;
        return (m.input_text ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 30);
  }, [meals, query, bolusMs, log.related_entry_id, WINDOW_MS]);

  async function setLink(newId: string | null) {
    setBusy(newId ?? "__unlink__");
    setErr(null);
    try {
      await updateInsulinLogLink(log.id, newId);
      setPicking(false);
      setQuery("");
      window.dispatchEvent(new CustomEvent("glev:insulin-updated"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function fmtMealLine(m: Meal): { title: string; sub: string } {
    const raw = (m.input_text ?? "").trim();
    const title = raw.length > 0 ? (raw.length > 60 ? raw.slice(0, 60) + "…" : raw) : "—";
    const refIso = m.meal_time ?? (m as unknown as { created_at?: string }).created_at;
    if (!refIso) return { title, sub: "" };
    const d = parseDbDate(refIso);
    const date = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    const time = fmtTime(d);
    return { title, sub: `${date} · ${time}` };
  }

  return (
    <ExPanel title={tx("panel_meal_link")}>
      {linked && (
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          gap:8, padding:"8px 0",
        }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:14, color:"var(--text-strong)", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {fmtMealLine(linked).title}
            </div>
            <div style={{ fontSize:12, color:"var(--text-faint)", marginTop:2 }}>
              {fmtMealLine(linked).sub}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLink(null)}
            disabled={busy != null}
            style={{
              padding:"6px 10px", borderRadius:8, fontSize:12, fontWeight:600,
              background:"transparent", color:PINK,
              border:`1px solid ${PINK}40`, cursor:"pointer",
              opacity: busy != null ? 0.5 : 1,
            }}
          >
            {busy === "__unlink__" ? tx("link_unlinking") : tx("link_unlink")}
          </button>
        </div>
      )}

      {!picking && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          style={{
            width:"100%", padding:"10px 12px", marginTop: linked ? 8 : 0,
            borderRadius:10, fontSize:13, fontWeight:600,
            background:`${ACCENT}14`, color:ACCENT,
            border:`1px solid ${ACCENT}40`, cursor:"pointer",
          }}
        >
          {linked ? tx("link_change") : tx("link_attach")}
        </button>
      )}

      {picking && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tx("link_search_placeholder")}
            autoFocus
            style={{
              width:"100%", padding:"10px 12px", borderRadius:10,
              background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
              color:"var(--text-strong)", fontSize:14, outline:"none",
            }}
          />
          <div style={{ maxHeight:260, overflowY:"auto", display:"flex", flexDirection:"column", gap:6 }}>
            {candidates.length === 0 ? (
              <div style={{ fontSize:13, color:"var(--text-faint)", textAlign:"center", padding:"16px 8px" }}>
                {tx("link_empty")}
              </div>
            ) : candidates.map(({ m }) => {
              const { title, sub } = fmtMealLine(m);
              const isBusy = busy === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setLink(m.id)}
                  disabled={busy != null}
                  style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    gap:8, width:"100%", padding:"10px 12px",
                    background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
                    borderRadius:10, cursor: busy != null ? "default" : "pointer",
                    opacity: busy != null && !isBusy ? 0.4 : 1,
                    textAlign:"left",
                  }}
                >
                  <div style={{ minWidth:0, flex:1 }}>
                    <div style={{ fontSize:14, color:"var(--text-strong)", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {title}
                    </div>
                    <div style={{ fontSize:12, color:"var(--text-faint)", marginTop:2 }}>
                      {sub}
                    </div>
                  </div>
                  <span style={{ fontSize:12, color:isBusy ? "var(--text-faint)" : ACCENT, fontWeight:600, flexShrink:0 }}>
                    {isBusy ? tx("link_saving") : tx("link_select")}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { setPicking(false); setQuery(""); setErr(null); }}
            disabled={busy != null}
            style={{
              padding:"8px 12px", borderRadius:8, fontSize:13,
              background:"transparent", color:"var(--text-faint)",
              border:`1px solid ${BORDER}`, cursor:"pointer",
            }}
          >
            {tx("link_cancel")}
          </button>
        </div>
      )}

      {err && <div style={{ fontSize:12, color:PINK, marginTop:6 }}>{err}</div>}
    </ExPanel>
  );
}

// ──────────────── BOLUS — full expanded view with badge ────────────────
function BolusRowCard({ log, meals, isOpen, onToggle, onDelete, deleting }: {
  log: InsulinLog;
  meals: Meal[];
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!isOpen) setEditing(false); }, [isOpen]);
  const tx = useTranslations("entriesExpand");
  const locale = useLocale();
  const { format: fmtTime } = useTimeFormat();
  const d = parseDbDate(log.created_at);
  const dateStr = d.toLocaleDateString(locale, { month:"short", day:"numeric" });
  const timeStr = fmtTime(d);

  // Dense 0-180 min CGM curve from bolus_glucose_samples. Fetched
  // lazily on first expand; stays cached in local state for the
  // lifetime of this card mount so re-opens don't re-fetch.
  const [bolusCurve, setBolusCurve] = useState<{
    state: "idle" | "loading" | "ready";
    samples: PostDoseSample[];
  }>({ state: "idle", samples: [] });

  useEffect(() => {
    if (!isOpen || log.insulin_type !== "bolus") return;
    if (bolusCurve.state !== "idle") return;
    setBolusCurve({ state: "loading", samples: [] });
    fetch(`/api/insulin/${encodeURIComponent(log.id)}/curve`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const j = await r.json() as { samples?: PostDoseSample[] };
        setBolusCurve({ state: "ready", samples: j.samples ?? [] });
      })
      .catch(() => setBolusCurve({ state: "ready", samples: [] }));
  }, [isOpen, log.id, log.insulin_type, bolusCurve.state]);

  const accent  = INSULIN_ACCENT;
  const evalInfo = evaluateBolus(log);
  const badgeColor = evalInfo.color;

  // Historic ICR snapshot (frozen at the moment the dose was logged).
  // Shown alongside the dose so a later "U vs carbs" review uses the
  // ratio that actually applied — current settings may have drifted
  // since. Falls back to no annotation when the snapshot is missing
  // (legacy rows pre-dating the snapshot column, or entries logged
  // before the user configured an ICR).
  const { unit: carbUnit } = useCarbUnit();
  const icrSnapshot =
    typeof log.icr_g_per_ie_at_log === "number" &&
    Number.isFinite(log.icr_g_per_ie_at_log) &&
    log.icr_g_per_ie_at_log > 0
      ? log.icr_g_per_ie_at_log
      : null;
  const icrLabel = icrSnapshot != null ? formatICR(icrSnapshot, carbUnit) : null;
  const icrSubtitle = icrLabel != null ? `@ ${icrLabel}` : undefined;

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
      id={`entry-insulin-${log.id}`}
      isOpen={isOpen}
      onToggle={editing ? () => {} : onToggle}
      onDelete={onDelete}
      deleting={deleting}
      onEdit={editing ? undefined : () => setEditing(true)}
      suppressActions={editing}
      accent={badgeColor}
      badge={evalInfo.label}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel={tx("row_brand")}
      primaryValue={log.insulin_name || tx("row_default_rapid")}
      primaryColor="var(--text-strong)"
      secondaryLabel={tx("row_dose")}
      secondaryValue={log.insulin_name ? `${log.units}u ${log.insulin_name}` : `${log.units}u`}
      secondaryColor={accent}
      secondaryMono={!log.insulin_name}
      secondarySubtitle={icrSubtitle}
      expandedDetails={editing ? (
        <InsulinEntryEditor
          log={log}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* 1) Session details ------------------------------------ */}
          <ExPanel title={tx("panel_session_details")}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label={tx("detail_dose")} value={`${log.units} u`} color={accent}/>
              <Detail label={tx("detail_insulin")} value={log.insulin_name || "—"}/>
              <Detail label={tx("detail_when")} value={`${dateStr} · ${timeStr}`}/>
              <Detail label={tx("detail_type")} value={tx("type_bolus")}/>
              {/* Historic ICR snapshot (frozen at log time). Shows "—"
                  for legacy rows or pre-ICR-config entries so a doctor
                  reviewing the log can tell "no snapshot" from "0". */}
              <Detail label={tx("detail_icr_at_log")} value={icrLabel ?? "—"}/>
            </div>
          </ExPanel>

          {/* 1b) Meal link — retroactive bolus↔meal pairing.
                 Lets the user attach any meal from the last ~14 days
                 to this bolus, change the existing link, or detach it
                 entirely. Writes via PATCH /api/insulin/[id]; the
                 `glev:insulin-updated` event triggers a reload. */}
          <BolusMealLinkPanel log={log} meals={meals} />

          {/* 2) Glucose tracking ----------------------------------- */}
          <ExPanel title={tx("panel_glucose_tracking")}>
            <Detail
              label={tx("detail_bg_at_log")}
              value={before != null ? `${Math.round(before)} mg/dL` : "—"}
            />
            <div style={{ height:8 }}/>
            <CgmCountdownPair
              logId={log.id}
              baseline={before}
              themeColor={INSULIN_ACCENT}
              slots={[
                {
                  label: tx("post_label_1h"),
                  fetchType: "after_1h",
                  fetchedValue: at1h,
                  windowStartIso: log.created_at,
                  expectedFetchAtIso: expect1h.toISOString(),
                },
                {
                  label: tx("post_label_2h"),
                  fetchType: "after_2h",
                  fetchedValue: at2h,
                  windowStartIso: log.created_at,
                  expectedFetchAtIso: expect2h.toISOString(),
                },
              ]}
            />
            {(d1h != null || d2h != null) && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:8 }}>
                <BolusDeltaPill label={tx("ex_delta_at_log_1h")} delta={d1h}/>
                <BolusDeltaPill label={tx("ex_delta_at_log_2h")} delta={d2h}/>
              </div>
            )}
            {/* Dense 3-h glucose curve from bolus_glucose_samples.
                Falls back to the legacy 2-point mini sparkline when the
                dense curve hasn't been populated yet (CGM not connected,
                or the job is still pending). */}
            {bolusCurve.samples.length >= 2 ? (
              <div style={{ marginTop:8, background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", color:"var(--text-dim)", marginBottom:8 }}>
                  3-H GLUCOSE CURVE
                </div>
                <PostDoseCurveChart
                  samples={bolusCurve.samples}
                  hadHypo={log.had_hypo_window}
                  color={accent}
                />
              </div>
            ) : (() => {
              const pts = [
                before != null ? { t: d.getTime(),        v: before, label: tx("ex_label_at_log") } : null,
                at1h   != null ? { t: expect1h.getTime(), v: at1h,   label: tx("ex_label_plus_1h") } : null,
                at2h   != null ? { t: expect2h.getTime(), v: at2h,   label: tx("ex_label_plus_2h") } : null,
              ].filter((p): p is { t: number; v: number; label: string } => p !== null);
              if (pts.length < 2) return null;
              return (
                <div style={{ marginTop:8, background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                  <GlucoseMiniSparkline points={pts} color={accent} locale={locale}/>
                </div>
              );
            })()}
            {/* Manual backfill — appears once expected time has passed
                and the auto-fetch hasn't filled in the value yet. */}
            <div style={{ marginTop:8 }}>
              <InsulinReadingsBackfill
                logId={log.id}
                slots={[
                  { label:tx("ex_backfill_1h"), field:"after_1h", expectedAt:expect1h, currentValue:at1h },
                  { label:tx("ex_backfill_2h"), field:"after_2h", expectedAt:expect2h, currentValue:at2h },
                ]}
              />
            </div>
          </ExPanel>

          {/* 3) Evaluation panel ----------------------------------- */}
          <ExPanel title={tx("panel_evaluation")}>
            <EvalBlock
              heading={tx("ex_1h_check")}
              unlocked={at1h != null}
              body={bolusInterimMessage(log, locale) || tx("ex_waiting_1h")}
              color={evalInfo.color}
              outcomeLabel={null}
            />
            <div style={{ height:8 }}/>
            <EvalBlock
              heading={tx("ex_2h_outcome")}
              unlocked={at2h != null}
              body={bolusFinalMessage(log, locale) || tx("ex_waiting_2h")}
              color={evalInfo.color}
              outcomeLabel={at2h != null ? evalInfo.label : null}
            />
          </ExPanel>

          {log.notes && (
            <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{tx("ex_notes_label")}</div>
              <div style={{ fontSize:14, color:"var(--text-strong)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}

          <div style={{
            fontSize:13, color:"var(--text-faint)",
            textAlign:"center", letterSpacing:"0.02em", lineHeight:1.5,
            paddingTop:2,
          }}>
            {tx("ex_disclaimer")}
          </div>
        </div>
      )}
    />
  );
}

// ──────────────── BASAL — expanded view + 6h CGM trend (no badge) ────────────────
function BasalRowCard({ log, isOpen, onToggle, onDelete, deleting }: {
  log: InsulinLog;
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!isOpen) setEditing(false); }, [isOpen]);
  const tx = useTranslations("entriesExpand");
  const locale = useLocale();
  const { format: fmtTime } = useTimeFormat();
  const d = parseDbDate(log.created_at);
  const dateStr = d.toLocaleDateString(locale, { month:"short", day:"numeric" });
  const timeStr = fmtTime(d);

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
  // data for basals logged within the last ~12 h. Manual fingersticks
  // for the same window are fetched in parallel so they overlay as
  // colored dots on the sparkline (Task #273).
  const [trend, setTrend] = useState<{
    state: "idle" | "loading" | "ready" | "error";
    points: SparklinePoint[];
    fingersticks: SparklinePoint[];
    error?: string;
  }>({ state: "idle", points: [], fingersticks: [] });

  useEffect(() => {
    if (!isOpen || trend.state !== "idle") return;
    setTrend({ state: "loading", points: [], fingersticks: [] });
    const ctrl = new AbortController();
    // Abort automatically after 10 s so the card never hangs in
    // "Loading CGM history…" when LLU / Nightscout is slow or down.
    const timer = setTimeout(() => ctrl.abort(new Error("CGM history timeout")), 10_000);
    let cancelled = false;
    Promise.all([
      fetch("/api/cgm/history", { cache: "no-store", signal: ctrl.signal }).then(async r => {
        if (!r.ok) throw new Error(`history ${r.status}`);
        const out = await r.json() as { history?: { timestamp?: string | null; value?: number | null }[] };
        return (out.history || [])
          .map(h => {
            const t = h.timestamp ? (parseLluTs(h.timestamp) ?? NaN) : NaN;
            const v = typeof h.value === "number" ? h.value : NaN;
            return Number.isFinite(t) && Number.isFinite(v) ? { t, v } : null;
          })
          .filter((p): p is SparklinePoint => p !== null)
          .sort((a, b) => a.t - b.t);
      }),
      // Fingersticks within the 6 h pre-injection window. Failure is
      // non-fatal — we degrade to CGM-only rather than block the chart.
      fetchFingersticks(new Date(fromMs).toISOString(), new Date(toMs).toISOString())
        .then(rows => rows
          .map(r => ({ t: new Date(r.measured_at).getTime(), v: Number(r.value_mg_dl) }))
          .filter((p): p is SparklinePoint => Number.isFinite(p.t) && Number.isFinite(p.v))
          .sort((a, b) => a.t - b.t))
        .catch(() => [] as SparklinePoint[]),
    ])
      .then(([pts, fs]) => {
        if (!cancelled) setTrend({ state: "ready", points: pts, fingersticks: fs });
      })
      .catch(e => {
        if (!cancelled) setTrend({ state: "error", points: [], fingersticks: [], error: (e as Error)?.message || "fetch failed" });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timer);
      // Reset to idle so the next open can start a fresh fetch.
      // Without this, an aborted in-flight request leaves state="loading"
      // forever because the guard `trend.state !== "idle"` blocks the retry.
      setTrend({ state: "idle", points: [], fingersticks: [] });
    };
  }, [isOpen, fromMs, toMs]);

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
      onToggle={editing ? () => {} : onToggle}
      onDelete={onDelete}
      deleting={deleting}
      onEdit={editing ? undefined : () => setEditing(true)}
      suppressActions={editing}
      accent={accent}
      badge={tx("type_basal").toUpperCase()}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel={tx("row_brand")}
      primaryValue={log.insulin_name || tx("row_default_long")}
      primaryColor="var(--text-strong)"
      secondaryLabel={tx("row_dose")}
      secondaryValue={log.insulin_name ? `${log.units}u ${log.insulin_name}` : `${log.units}u`}
      secondaryColor={accent}
      secondaryMono={!log.insulin_name}
      expandedDetails={editing ? (
        <InsulinEntryEditor
          log={log}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* 1) Session details ------------------------------------ */}
          <ExPanel title={tx("panel_session_details")}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label={tx("detail_dose")} value={`${log.units} u`} color={accent}/>
              <Detail label={tx("detail_insulin")} value={log.insulin_name || "—"}/>
              <Detail label={tx("detail_when")} value={`${dateStr} · ${timeStr}`}/>
              <Detail label={tx("detail_type")} value={tx("type_basal")}/>
            </div>
          </ExPanel>

          {/* 2) 6h CGM trend leading up to the injection ----------- */}
          <ExPanel title={tx("panel_6h_pre")}>
            <div style={{
              background:"var(--surface-soft)",
              border:`1px solid ${BORDER}`,
              borderRadius:10, padding:"10px 12px",
            }}>
              {trend.state === "loading" && (
                <div style={{ fontSize:13, color:"var(--text-dim)", textAlign:"center", padding:"24px 0" }}>
                  {tx("basal_cgm_loading")}
                </div>
              )}
              {trend.state === "error" && (
                <div style={{ fontSize:13, color:"var(--text-dim)", textAlign:"center", padding:"24px 0" }}>
                  {tx("basal_cgm_unavailable")}
                </div>
              )}
              {trend.state === "ready" && (
                <CgmSparkline
                  points={trend.points}
                  fingersticks={trend.fingersticks}
                  fromMs={fromMs}
                  toMs={toMs}
                  markerMs={d.getTime()}
                  color={accent}
                  manualLabel={tx("basal_manual_label")}
                  locale={locale}
                />
              )}
              {/* Time-axis labels. */}
              <div style={{
                display:"flex", justifyContent:"space-between",
                fontSize:11, color:"var(--text-faint)", letterSpacing:"0.06em",
                marginTop:6,
              }}>
                <span>−6 h</span>
                <span>−4 h</span>
                <span>−2 h</span>
                <span>{tx("basal_injection_label")}</span>
              </div>
            </div>
            {/* Window stats. */}
            {stats != null && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:8, marginTop:8 }}>
                <Detail label={tx("detail_min")} value={`${stats.min} mg/dL`}/>
                <Detail label={tx("detail_max")} value={`${stats.max} mg/dL`}/>
                <Detail label={tx("detail_avg")} value={`${stats.avg} mg/dL`}/>
                <Detail label={tx("detail_readings")} value={`${stats.count}`}/>
              </div>
            )}
          </ExPanel>

          {/* 3) Stored post-fetches (12h / 24h) — context only ----- */}
          <ExPanel title={tx("panel_post_checkpoints")}>
            <Detail
              label={tx("detail_bg_at_log")}
              value={before != null ? `${Math.round(before)} mg/dL` : "—"}
            />
            <div style={{ height:8 }}/>
            <CgmCountdownPair
              logId={log.id}
              baseline={before}
              themeColor={BASAL_ACCENT}
              slots={[
                {
                  label: tx("post_label_12h"),
                  fetchType: "after_12h",
                  fetchedValue: at12h,
                  windowStartIso: log.created_at,
                  expectedFetchAtIso: expect12h.toISOString(),
                },
                {
                  label: tx("post_label_24h"),
                  fetchType: "after_24h",
                  fetchedValue: at24h,
                  windowStartIso: log.created_at,
                  expectedFetchAtIso: expect24h.toISOString(),
                },
              ]}
            />
            {/* Manual backfill — appears once expected time has passed
                and the auto-fetch hasn't filled in the value yet. */}
            <div style={{ marginTop:8 }}>
              <InsulinReadingsBackfill
                logId={log.id}
                slots={[
                  { label:tx("ex_backfill_12h"), field:"after_12h", expectedAt:expect12h, currentValue:at12h },
                  { label:tx("ex_backfill_24h"), field:"after_24h", expectedAt:expect24h, currentValue:at24h },
                ]}
              />
            </div>
          </ExPanel>

          {log.notes && (
            <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{tx("ex_notes_label")}</div>
              <div style={{ fontSize:14, color:"var(--text-strong)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}

          <div style={{
            fontSize:13, color:"var(--text-faint)",
            textAlign:"center", letterSpacing:"0.02em", lineHeight:1.5,
            paddingTop:2, paddingBottom:8,
          }}>
            {tx("basal_disclaimer")}
          </div>
        </div>
      )}
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
      background:"var(--surface-soft)",
      border:`1px solid ${BORDER}`,
      borderRadius:10, padding:"10px 12px",
    }}>
      <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{text}</div>
    </div>
  );
}

function ExerciseRowCard({ log, allLogs, isOpen, onToggle, onDelete, deleting, onUpdated }: {
  log: ExerciseLog;
  /** Full pool of recently fetched exercise logs. Powers the
   *  PERSONAL PATTERN panel — needs cross-row context, not just the
   *  current row. */
  allLogs: ExerciseLog[];
  isOpen: boolean; onToggle: () => void; onDelete: () => void; deleting: boolean;
  /** Replace this row in the parent list after a successful PATCH. */
  onUpdated: (updated: ExerciseLog) => void;
}) {
  // Local "in-place editor open?" state. Kept inside the row (not the
  // page) so a parent refetch (e.g. another listener firing) cannot
  // collapse the editor mid-edit. We also auto-close it whenever the
  // row itself collapses so reopening the row starts in read-only mode.
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!isOpen) setEditing(false); }, [isOpen]);
  const tIns = useTranslations("insights");
  const tx = useTranslations("entriesExpand");
  const locale = useLocale();
  const { format: fmtTime } = useTimeFormat();

  // Dense 0-180 min CGM curve from exercise_glucose_samples (anchored
  // at workout END). Fetched lazily on first expand.
  const [exerciseCurve, setExerciseCurve] = useState<{
    state: "idle" | "loading" | "ready";
    samples: PostDoseSample[];
  }>({ state: "idle", samples: [] });

  useEffect(() => {
    if (!isOpen) return;
    if (exerciseCurve.state !== "idle") return;
    setExerciseCurve({ state: "loading", samples: [] });
    fetch(`/api/exercise/${encodeURIComponent(log.id)}/curve`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const j = await r.json() as { samples?: PostDoseSample[] };
        setExerciseCurve({ state: "ready", samples: j.samples ?? [] });
      })
      .catch(() => setExerciseCurve({ state: "ready", samples: [] }));
  }, [isOpen, log.id, exerciseCurve.state]);

  // Apple-Health-synced rows carry the real workout window in
  // started_at / ended_at — prefer those when present so the displayed
  // STARTED / ENDED reflect what the watch recorded, not the
  // created_at + duration approximation used for manual rows.
  const start = log.started_at ? parseDbDate(log.started_at) : parseDbDate(log.created_at);
  const end   = log.ended_at
    ? parseDbDate(log.ended_at)
    : new Date(start.getTime() + log.duration_minutes * 60_000);
  const dateStr = start.toLocaleDateString(locale, { month:"short", day:"numeric" });
  const timeStr = fmtTime(start);
  // End-side date is computed independently so workouts that cross
  // midnight (e.g. start 23:50, run 30 min) display the next day's
  // date for ENDED instead of duplicating the start date.
  const endDateStr = end.toLocaleDateString(locale, { month:"short", day:"numeric" });
  const endTimeStr = fmtTime(end);

  const accent  = EXERCISE_ACCENT;
  const typeLbl = exerciseTypeLabelI18n(tIns, log.exercise_type);
  const evalInfo = evaluateExercise(log);
  const badgeColor = evalInfo.color;
  const isSynced = log.source === "apple_health";
  const ahLabel = tx("source_apple_health");
  const ahSyncedLabel = tx("source_apple_health_synced");
  const ahLockedHint = tx("source_apple_health_locked_hint");

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
      // While the editor is open we ignore header taps so a stray click
      // doesn't collapse the row mid-edit and discard the user's draft.
      onToggle={editing ? () => {} : onToggle}
      onDelete={onDelete}
      deleting={deleting}
      onEdit={editing ? undefined : () => setEditing(true)}
      suppressActions={editing}
      accent={badgeColor}
      badge={evalInfo.label}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel={tx("row_duration")}
      primaryValue={`${log.duration_minutes}m`}
      primaryColor={accent}
      primaryMono
      secondaryLabel={tx("row_type")}
      secondaryValue={typeLbl}
      sourceBadge={isSynced ? <AppleHealthBadge label={ahLabel} compact/> : undefined}
      expandedDetails={editing ? (
        <ExerciseEditor
          log={log}
          onSaved={(updated) => {
            setEditing(false);
            onUpdated(updated);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {/* Apple Health provenance banner — shown only for synced rows.
              Surfaces WHERE the data came from + WHY some fields are
              read-only, per the migration's UI policy (notes + intensity
              stay editable, type/duration/HR/time-window are locked). */}
          {isSynced && (
            <div style={{
              display:"flex", alignItems:"flex-start", gap:10,
              background:"#FF2D5510",
              border:"1px solid #FF2D5540",
              borderRadius:12, padding:"10px 12px",
            }}>
              <div style={{ flexShrink:0, marginTop:1 }}>
                <AppleHealthBadge label={ahLabel}/>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"var(--text-strong)" }}>
                  {ahSyncedLabel}
                </div>
                <div style={{ fontSize:12, color:"var(--text-dim)", lineHeight:1.5 }}>
                  {ahLockedHint}
                </div>
              </div>
            </div>
          )}

          {/* 1) Session details ------------------------------------ */}
          <ExPanel title={tx("panel_session_details")}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label={tx("detail_type")} value={typeLbl} locked={isSynced} lockedHint={ahLockedHint}/>
              <Detail label={tx("detail_duration")} value={`${log.duration_minutes} min`} color={accent} locked={isSynced} lockedHint={ahLockedHint}/>
              <Detail label={tx("detail_intensity")} value={intensityLabel(log.intensity)}/>
              <Detail label={tx("detail_started")} value={`${dateStr} · ${timeStr}`} locked={isSynced} lockedHint={ahLockedHint}/>
              <Detail label={tx("detail_ended")} value={`${endDateStr} · ${endTimeStr}`} locked={isSynced} lockedHint={ahLockedHint}/>
              {log.avg_heart_rate != null && (
                <Detail label={tx("detail_avg_hr")} value={`${log.avg_heart_rate} bpm`} locked={isSynced} lockedHint={ahLockedHint}/>
              )}
              {log.max_heart_rate != null && (
                <Detail label={tx("detail_max_hr")} value={`${log.max_heart_rate} bpm`} locked={isSynced} lockedHint={ahLockedHint}/>
              )}
            </div>
          </ExPanel>

          {/* 2) Glucose tracking ----------------------------------- */}
          <ExPanel title={tx("panel_glucose_tracking")}>
            <Detail
              label={tx("mini_bg_before")}
              value={before != null ? `${Math.round(before)} mg/dL` : "—"}
            />
            <div style={{ height:8 }}/>
            <CgmCountdownPair
              logId={log.id}
              baseline={before}
              themeColor={EXERCISE_ACCENT}
              slots={[
                {
                  label: tx("ex_slot_workout_end"),
                  fetchType: "at_end",
                  fetchedValue: atEnd ?? null,
                  windowStartIso: log.created_at,
                  expectedFetchAtIso: expectAtEnd.toISOString(),
                },
                {
                  label: tx("ex_slot_1h_post_end"),
                  fetchType: "exer_after_1h",
                  fetchedValue: after1h ?? null,
                  windowStartIso: end.toISOString(),
                  expectedFetchAtIso: expect1h.toISOString(),
                },
              ]}
            />
            {/* Coloured deltas — only show once both endpoints exist. */}
            {(dEnd != null || d1h != null) && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8, marginTop:8 }}>
                <DeltaPill label={tx("ex_delta_before_at_end")} delta={dEnd}/>
                <DeltaPill label={tx("ex_delta_before_1h")}    delta={d1h}/>
              </div>
            )}
            {/* Dense 3-h glucose curve from exercise_glucose_samples
                (anchored at workout END). Falls back to the legacy
                2-point mini sparkline when the job is still pending. */}
            {exerciseCurve.samples.length >= 2 ? (
              <div style={{ marginTop:8, background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", color:"var(--text-dim)", marginBottom:8 }}>
                  3-H GLUCOSE CURVE (POST-WORKOUT)
                </div>
                <PostDoseCurveChart
                  samples={exerciseCurve.samples}
                  hadHypo={log.had_hypo_window}
                  color={accent}
                />
              </div>
            ) : (() => {
              const pts = [
                before  != null ? { t: start.getTime(),       v: before,  label: tx("ex_label_before") } : null,
                atEnd   != null ? { t: end.getTime(),         v: atEnd,   label: tx("ex_label_at_end") } : null,
                after1h != null ? { t: expect1h.getTime(),    v: after1h, label: tx("ex_label_plus_1h") } : null,
              ].filter((p): p is { t: number; v: number; label: string } => p !== null);
              if (pts.length < 2) return null;
              return (
                <div style={{ marginTop:8, background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
                  <GlucoseMiniSparkline points={pts} color={accent} locale={locale}/>
                </div>
              );
            })()}
          </ExPanel>

          {/* 3) Evaluation panel ----------------------------------- */}
          <ExPanel title={tx("panel_evaluation")}>
            <EvalBlock
              heading={tx("ex_post_workout_check")}
              unlocked={atEnd != null}
              body={interimMessage(log, locale) || tx("ex_waiting_at_end")}
              color={evalInfo.color}
              outcomeLabel={atEnd != null ? evalInfo.label : null}
            />
            <div style={{ height:8 }}/>
            <EvalBlock
              heading={tx("ex_1h_outcome")}
              unlocked={after1h != null}
              body={finalMessage(log, locale) || tx("ex_waiting_1h")}
              color={evalInfo.color}
              outcomeLabel={after1h != null ? evalInfo.label : null}
            />
          </ExPanel>

          {/* 4) Pattern note --------------------------------------- */}
          <ExPanel title={tx("panel_pattern_note")}>
            <div style={{ fontSize:14, color:"var(--text-body)", lineHeight:1.55 }}>
              {tIns(exercisePatternNoteKey(log.exercise_type))}
            </div>
          </ExPanel>

          {/* 4b) Personal pattern — cross-entry stats for THIS user
                  on the same exercise type. Sits visually under the
                  static PATTERN NOTE so the educational copy and the
                  observed reality are read together. */}
          <PersonalPatternPanel log={log} allLogs={allLogs}/>

          {log.notes && (
            <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{tx("ex_notes_label")}</div>
              <div style={{ fontSize:14, color:"var(--text-strong)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}

          {/* Disclaimer — last item before the inherited Delete button. */}
          <div style={{
            fontSize:13, color:"var(--text-faint)",
            textAlign:"center", letterSpacing:"0.02em", lineHeight:1.5,
            paddingTop:2,
          }}>
            {tx("ex_disclaimer")}
          </div>
        </div>
      )}
    />
  );
}

/**
 * Inline editor for a single ExerciseLog. Mirrors the shape of the
 * Engine log form (ExerciseForm in components/EngineLogTab.tsx) but
 * scoped to the four user-facing fields that the PATCH route accepts:
 * exercise_type, duration_minutes, intensity, notes. CGM-derived
 * columns are intentionally not exposed.
 *
 * Local-only state — the parent ExerciseRowCard only learns about the
 * new row via `onSaved(updated)` AFTER the PATCH resolves, so a partial
 * save can't half-update the list. While saving the form locks the
 * Save button and keeps the editor mounted (the parent row also
 * suppresses its collapse toggle).
 */
function ExerciseEditor({ log, onSaved, onCancel }: {
  log: ExerciseLog;
  onSaved: (updated: ExerciseLog) => void;
  onCancel: () => void;
}) {
  // Legacy `hypertrophy` rows keep their stored type — we surface it in
  // the picker as a hidden-by-default option so an old row can be saved
  // back unchanged. The new form would emit `strength` instead.
  const initialType: ExerciseType = log.exercise_type;
  const [type, setType] = useState<ExerciseType>(initialType);
  const [duration, setDuration] = useState<number>(log.duration_minutes);
  const [intensity, setIntensity] = useState<ExerciseIntensity>(log.intensity);
  const [notes, setNotes] = useState<string>(log.notes ?? "");
  // Editable start time. Manual rows use started_at when present
  // (newer column added 2026-05-18) and fall back to created_at for
  // legacy rows that pre-date it. Apple-Health rows always have
  // started_at populated from the workout — and the field is locked
  // there anyway, so the fallback is harmless.
  const initialStartedIso = log.started_at ?? log.created_at;
  const [startedAtLocal, setStartedAtLocal] = useState<string>(() => isoToLocal(initialStartedIso));
  const [startedAtSeed] = useState<string>(() => isoToLocal(initialStartedIso));
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState<number>(0);

  const tIns = useTranslations("insights");
  const tx = useTranslations("entriesExpand");
  // Apple-Health-synced rows lock type/duration (and HR/time-window —
  // not edited here anyway). Intensity + notes stay editable per the
  // migration's agreed UI policy. Time is also locked for synced rows
  // because the watch's wallclock is authoritative.
  const isSynced = log.source === "apple_health";
  const lockedHint = tx("field_locked_synced");

  // Editor type options: the new taxonomy, plus the row's current
  // value if it's a legacy `hypertrophy` row, so we never silently
  // change the type on save.
  const EDIT_TYPE_OPTIONS: ExerciseType[] = useMemo(() => {
    const base: ExerciseType[] = [
      "cardio", "strength", "hiit", "yoga", "cycling", "run", "swimming",
      "football", "tennis", "volleyball", "basketball",
      "breathwork", "hot_shower", "cold_shower",
    ];
    if (initialType === "hypertrophy" && !base.includes("hypertrophy")) {
      return ["hypertrophy", ...base];
    }
    return base;
  }, [initialType]);

  async function handleSave() {
    if (busy) return;
    setErr(null);
    if (!Number.isFinite(duration) || !Number.isInteger(duration) || duration <= 0 || duration > 600) {
      setErr(tx("ex_err_duration"));
      return;
    }
    setBusy(true);
    try {
      // Build a diff so we only PATCH fields that actually changed.
      // Notes is normalised the same way the API does (trim → null on
      // empty) so a no-op notes edit isn't sent.
      const patch: {
        exercise_type?: ExerciseType;
        duration_minutes?: number;
        intensity?: ExerciseIntensity;
        notes?: string | null;
        started_at?: string;
      } = {};
      // Synced rows: type/duration/time are read-only in the UI, so
      // never include them in the PATCH even if local state somehow
      // diverged.
      if (!isSynced && type !== log.exercise_type) patch.exercise_type = type;
      if (!isSynced && duration !== log.duration_minutes) patch.duration_minutes = duration;
      if (intensity !== log.intensity) patch.intensity = intensity;
      const trimmedNotes = notes.trim();
      const normalizedNotes = trimmedNotes.length > 0 ? trimmedNotes : null;
      if (normalizedNotes !== (log.notes ?? null)) patch.notes = normalizedNotes;
      // Time diff — manual rows only. When the user picks a new
      // wallclock the server re-anchors `cgm_glucose_at_log` to the
      // CGM history within ±15 min of the new time.
      if (!isSynced && startedAtLocal.trim() !== startedAtSeed.trim() && startedAtLocal.trim() !== "") {
        const iso = localToIso(startedAtLocal);
        if (!iso) { setErr(tx("ex_err_time")); setBusy(false); return; }
        patch.started_at = iso;
      }

      if (Object.keys(patch).length === 0) {
        // No changes — just close the editor without hitting the API.
        setBusy(false);
        onCancel();
        return;
      }

      const updated = await updateExerciseLog(log.id, patch);
      setSavedTick(n => n + 1);
      // Notify other tabs / panels (engine, insights) AFTER the parent
      // has had a chance to swap in the fresh row. We dispatch from a
      // microtask so the parent state update isn't immediately
      // clobbered by a refetch racing with our local replace.
      queueMicrotask(() => {
        window.dispatchEvent(new Event("glev:exercise-updated"));
      });
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx("ex_err_save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {tx("ex_editor_title")}
        </div>
        <span style={{
          padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700,
          background:`${EXERCISE_ACCENT}20`, color:EXERCISE_ACCENT,
          border:`1px solid ${EXERCISE_ACCENT}40`,
          letterSpacing:"0.04em", textTransform:"uppercase",
        }}>
          Editor
        </span>
      </div>

      <div style={{ fontSize:13, color:"var(--text-dim)", lineHeight:1.5 }}>
        Korrigiert Sportart, Dauer, Intensität, Start-Zeit und Notizen.
        Wenn du die Zeit änderst, wird der Glukose-Wert beim Logging
        aus der CGM-Historie der neuen Uhrzeit nachgezogen (sofern
        verfügbar — sonst leer).
      </div>

      {/* Synced-from-Apple-Health hint banner — locks type/duration. */}
      {isSynced && (
        <div style={{
          display:"flex", alignItems:"flex-start", gap:10,
          background:"#FF2D5510",
          border:"1px solid #FF2D5540",
          borderRadius:10, padding:"8px 10px",
        }}>
          <div style={{ flexShrink:0, marginTop:1 }}>
            <AppleHealthBadge label={tx("source_apple_health")} compact/>
          </div>
          <div style={{ fontSize:12, color:"var(--text-dim)", lineHeight:1.5 }}>
            {tx("source_apple_health_locked_hint")}
          </div>
        </div>
      )}

      {/* Sportart — simple native select keeps the editor compact and
          accessible without re-implementing the engine dropdown. */}
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <label style={{ fontSize:13, color:"var(--text-dim)", display:"flex", alignItems:"center", gap:6 }}>
          <span>Sportart</span>
          {isSynced && <LockGlyph hint={lockedHint}/>}
        </label>
        <select
          value={type}
          onChange={e => setType(e.target.value as ExerciseType)}
          disabled={isSynced}
          title={isSynced ? lockedHint : undefined}
          style={{
            background:"var(--input-bg)",
            border:`1px solid ${BORDER}`,
            borderRadius:12,
            padding:"12px 14px",
            fontSize:14,
            fontWeight:600,
            color:"var(--text-strong)",
            outline:"none",
            opacity: isSynced ? 0.6 : 1,
            cursor: isSynced ? "not-allowed" : undefined,
          }}
        >
          {EDIT_TYPE_OPTIONS.map(opt => (
            <option key={opt} value={opt}>{exerciseTypeLabelI18n(tIns, opt)}</option>
          ))}
        </select>
      </div>

      {/* Dauer (1–600 min) */}
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <label style={{ fontSize:13, color:"var(--text-dim)", display:"flex", alignItems:"center", gap:6 }}>
          <span>Dauer</span>
          {isSynced && <LockGlyph hint={lockedHint}/>}
        </label>
        {isSynced ? (
          <div
            title={lockedHint}
            style={{
              background:"var(--input-bg)",
              border:`1px solid ${BORDER}`,
              borderRadius:12,
              padding:"12px 14px",
              fontSize:14,
              fontWeight:700,
              color:"var(--text-strong)",
              opacity:0.7,
              fontFamily:"var(--font-mono)",
            }}
          >
            {duration} min
          </div>
        ) : (
          <SnapSlider
            value={duration}
            onChange={(n) => setDuration(Math.round(n))}
            min={1}
            max={600}
            step={1}
            unit="min"
            accent={EXERCISE_ACCENT}
            ariaLabel="Dauer"
          />
        )}
      </div>

      {/* Start-Zeit — datetime-local. Apple-Health-Rows sind gesperrt
          (die Watch-Wallclock ist authoritative). Beim Save dreht der
          Server eine CGM-Historie-Abfrage für die neue Uhrzeit. */}
      <DateTimeField
        label="Start-Zeit"
        value={startedAtLocal}
        onChange={setStartedAtLocal}
        accent={EXERCISE_ACCENT}
        disabled={isSynced}
        disabledHint={lockedHint}
        hint={
          !isSynced && startedAtLocal.trim() !== startedAtSeed.trim()
            ? "Glukose-Wert wird beim Speichern für die neue Zeit aus der CGM-Historie nachgezogen."
            : undefined
        }
      />

      {/* Intensität — segmented 3-button control. Vorher: 3-stop
          SnapSlider, der auf iOS WKWebView mit native range input
          beim Drag „zurücksprang" (User-Report 2026-05-18). */}
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <label style={{ fontSize:13, color:"var(--text-dim)" }}>
          Intensität —{" "}
          <span style={{ color:EXERCISE_ACCENT, fontWeight:700 }}>
            {intensityLabel(intensity)}
          </span>
        </label>
        <SegmentedChoice<ExerciseIntensity>
          value={intensity}
          onChange={setIntensity}
          accent={EXERCISE_ACCENT}
          ariaLabel="Intensität"
          options={[
            { value: "low",    label: intensityLabel("low") },
            { value: "medium", label: intensityLabel("medium") },
            { value: "high",   label: intensityLabel("high") },
          ]}
        />
      </div>

      <CollapsibleField
        label={tx("ins_editor_notes")}
        accent={EXERCISE_ACCENT}
        hasValue={notes.trim().length > 0}
      >
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="z.B. Intervalle, Outdoor, …"
          style={{
            width:"100%",
            background:"var(--input-bg)",
            border:`1px solid ${BORDER}`,
            borderRadius:12,
            padding:"12px 14px",
            fontSize:14,
            color:"var(--text-strong)",
            outline:"none",
          }}
        />
      </CollapsibleField>

      {err && (
        <div style={{
          fontSize:13, color:PINK,
          padding:"8px 10px",
          background:`${PINK}10`,
          border:`1px solid ${PINK}30`,
          borderRadius:8,
        }}>
          {err}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, alignItems:"end" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding:"13px",
            borderRadius:12,
            border:`1px solid ${BORDER}`,
            background:"var(--surface-soft)",
            color:"var(--text-body)",
            fontSize:14,
            fontWeight:600,
            cursor:busy ? "not-allowed" : "pointer",
            letterSpacing:"0.02em",
            marginTop:18, // align with SaveButton's marginTop
          }}
        >
          {tx("ex_cancel")}
        </button>
        <SaveButton
          onClick={handleSave}
          disabled={busy}
          busy={busy}
          accent={EXERCISE_ACCENT}
          label={tx("ex_save")}
          successKey={savedTick || null}
        />
      </div>
    </div>
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
  // Currently unused (kept for the future "Pending CGM data" hint on
  // exercise rows). Falls back to 24h since there is no React hook
  // context here and the label is dev-facing today.
  if (Date.now() - expectedAt.getTime() > EXERCISE_NO_DATA_AFTER_MS) {
    return "Skipped";
  }
  const hh = expectedAt.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit", hour12:false });
  return `Pending · expected ${hh}`;
}

/** Section wrapper used inside the exercise expanded view. */
function ExPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background:"var(--surface-soft)",
      border:`1px solid ${BORDER}`,
      borderRadius:12,
      padding:"12px 14px",
    }}>
      <div style={{
        fontSize:12, fontWeight:700, letterSpacing:"0.1em",
        color:"var(--text-dim)", marginBottom:10,
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
      background:"var(--surface-soft)",
      border:`1px solid ${BORDER}`,
      borderRadius:10, padding:"10px 12px",
    }}>
      <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
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
  const bg     = unlocked ? `${color}10` : "var(--surface-soft)";
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: "10px 12px",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{
          fontSize:11, fontWeight:700, letterSpacing:"0.1em",
          color: unlocked ? color : "var(--text-faint)",
        }}>{heading}</span>
        {unlocked && outcomeLabel && (
          <span style={{
            fontSize:11, fontWeight:700, letterSpacing:"0.08em",
            color, padding:"2px 8px", borderRadius:99,
            border:`1px solid ${color}40`, background:`${color}15`,
          }}>{outcomeLabel}</span>
        )}
      </div>
      <div style={{
        fontSize:14, lineHeight:1.5,
        color: unlocked ? "var(--text-strong)" : "var(--text-faint)",
      }}>{body}</div>
    </div>
  );
}

/** Tiny padlock glyph used by editor labels and read-only Detail tiles
 *  to signal "synced from Apple Health → locked here". Renders inline
 *  inside a label, inherits color/opacity from its parent. */
function LockGlyph({ hint }: { hint?: string }) {
  return (
    <span title={hint} style={{ display:"inline-flex", alignItems:"center", color:"var(--text-faint)" }} aria-label={hint}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </span>
  );
}

function Detail({ label, value, color, locked, lockedHint }: { label: string; value: string; color?: string; locked?: boolean; lockedHint?: string }) {
  return (
    <div
      title={locked && lockedHint ? lockedHint : undefined}
      style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px", minWidth:0, overflow:"hidden" }}
    >
      <div style={{ fontSize:"clamp(9px, 2.8vw, 11px)", color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4, display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
        <span style={{ whiteSpace:"normal", overflowWrap:"break-word", wordBreak:"break-word", minWidth:0 }}>{label}</span>
        {locked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity:0.75 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        )}
      </div>
      <div style={{ fontSize:14, fontWeight:700, color: color || "var(--text-strong)", letterSpacing:"-0.01em" }}>{value}</div>
    </div>
  );
}

/**
 * Cross-entry summary tile rendered under PATTERN NOTE in the
 * exercise expanded view. Shows THIS user's median glucose response
 * (before → at-end and before → +1 h) plus the share of sessions
 * that triggered HYPO RISK, all scoped to the same exercise type as
 * the row being viewed. Hidden entirely when the type doesn't have
 * `PATTERN_MIN_SESSIONS` rows in the recent window — there's nothing
 * useful to say with one or two data points.
 *
 * Copy stays neutral and observational ("usually drop ~40 mg/dL"),
 * never prescriptive — matches the static `patternNote()` tone.
 */
function PersonalPatternPanel({ log, allLogs }: { log: ExerciseLog; allLogs: ExerciseLog[] }) {
  const tx     = useTranslations("entriesExpand");
  const tIns2  = useTranslations("insights");
  const locale = useLocale();
  const stats  = aggregateExerciseTypeStats(allLogs, log.exercise_type);
  if (!stats || stats.count < PATTERN_MIN_SESSIONS) return null;

  const headline = personalPatternHeadline(stats, locale);
  const typeLbl  = exerciseTypeLabelI18n(tIns2, stats.type);
  const basedOn  = stats.count === 1
    ? tx("ex_based_on_last_one", { type: typeLbl.toLowerCase() })
    : tx("ex_based_on_last_many", { n: stats.count, type: typeLbl.toLowerCase() });

  return (
    <ExPanel title={tx("panel_personal_pattern")}>
      <div style={{ fontSize:13, color:"var(--text-dim)", letterSpacing:"0.06em", fontWeight:600, marginBottom:8 }}>
        {basedOn}
      </div>
      {headline && (
        <div style={{ fontSize:14, color:"var(--text-body)", lineHeight:1.55, marginBottom:10 }}>
          {headline}
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
        <PatternStatTile
          label={tx("ex_median_before_at_end")}
          delta={stats.medianDeltaAtEnd}
          sample={stats.atEndSampleSize}
        />
        <PatternStatTile
          label={tx("ex_median_before_1h")}
          delta={stats.medianDelta1h}
          sample={stats.oneHourSampleSize}
        />
      </div>
      <div style={{ marginTop:8 }}>
        <HypoShareTile
          hypoCount={stats.hypoRiskCount}
          classifiedCount={stats.classifiedCount}
          share={stats.hypoRiskShare}
        />
      </div>
    </ExPanel>
  );
}

function PatternStatTile({ label, delta, sample }: { label: string; delta: number | null; sample: number }) {
  const tx = useTranslations("entriesExpand");
  const enough = delta != null && sample >= PATTERN_MIN_SESSIONS;
  const color = enough ? deltaColor(delta) : "var(--text-faint)";
  const text = !enough
    ? "—"
    : delta === 0
      ? "0 mg/dL"
      : `${delta! > 0 ? "+" : ""}${delta} mg/dL`;
  return (
    <div style={{
      background:"var(--surface-soft)",
      border:`1px solid ${BORDER}`,
      borderRadius:10, padding:"10px 12px",
    }}>
      <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{text}</div>
      <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:3 }}>
        {enough ? `n = ${sample}` : tx("ex_n_need", { n: sample, min: PATTERN_MIN_SESSIONS })}
      </div>
    </div>
  );
}

function HypoShareTile({ hypoCount, classifiedCount, share }: {
  hypoCount: number; classifiedCount: number; share: number | null;
}) {
  const tx = useTranslations("entriesExpand");
  const enough = share != null && classifiedCount >= PATTERN_MIN_SESSIONS;
  // Pink (HYPO_RISK colour from exerciseEval) once any hypo turned up,
  // muted faint text otherwise. Pure observation — no thresholding
  // language like "high risk" / "safe".
  const color = !enough
    ? "var(--text-faint)"
    : hypoCount > 0
      ? "#EF4444"
      : "var(--text-strong)";
  const pct = enough ? Math.round(share! * 100) : null;
  const text = !enough
    ? "—"
    : tx("ex_hypo_count", { pct: pct!, hypoCount, classifiedCount });
  return (
    <div style={{
      background:"var(--surface-soft)",
      border:`1px solid ${BORDER}`,
      borderRadius:10, padding:"10px 12px",
    }}>
      <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{tx("ex_hypo_risk_share")}</div>
      <div style={{ fontSize:14, fontWeight:700, color, letterSpacing:"-0.01em", fontFamily:"var(--font-mono)" }}>{text}</div>
      <div style={{ fontSize:11, color:"var(--text-faint)", marginTop:3 }}>
        {enough
          ? tx("ex_hypo_share_text")
          : tx("ex_n_classified_need", { n: classifiedCount, min: PATTERN_MIN_SESSIONS })}
      </div>
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
      <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>
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
                color: active ? ACCENT : "var(--text-muted)",
                fontSize:13,
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
  value, from, to, onChange, onBoundChange, options, title,
}: {
  value: DateRangeKey;
  from: string | null;
  to: string | null;
  onChange: (value: DateRangeKey) => void;
  onBoundChange: (side: "from" | "to", value: string) => void;
  options: { value: DateRangeKey; label: string }[];
  title: string;
}) {
  return (
    <div>
      <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700, marginBottom:8, textTransform:"uppercase" }}>
        {title}
      </div>
      <div role="radiogroup" aria-label="Date range" style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {options.map(opt => {
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
                color: active ? ACCENT : "var(--text-muted)",
                fontSize:13,
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
          <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:12, color:"var(--text-dim)", letterSpacing:"0.06em", fontWeight:600, textTransform:"uppercase", flex:"1 1 140px" }}>
            From
            <input
              type="date"
              value={from ?? ""}
              max={to ?? undefined}
              onChange={(e) => onBoundChange("from", e.target.value)}
              style={{
                background:"var(--input-bg)",
                border:`1px solid ${BORDER}`,
                borderRadius:8,
                padding:"7px 10px",
                color:"var(--text)",
                fontSize:13,
                outline:"none",
                colorScheme:"dark",
              }}
            />
          </label>
          <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:12, color:"var(--text-dim)", letterSpacing:"0.06em", fontWeight:600, textTransform:"uppercase", flex:"1 1 140px" }}>
            To
            <input
              type="date"
              value={to ?? ""}
              min={from ?? undefined}
              onChange={(e) => onBoundChange("to", e.target.value)}
              style={{
                background:"var(--input-bg)",
                border:`1px solid ${BORDER}`,
                borderRadius:8,
                padding:"7px 10px",
                color:"var(--text)",
                fontSize:13,
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

/**
 * Inline editor for an existing meal entry — lets the user fix macros and
 * the bolus value after the fact (e.g. when the AI parser was off, or when
 * a correction bolus was given later). Glucose readings, meal time, and
 * meal_type are intentionally NOT editable here — those have their own
 * dedicated flows (LifecycleBlock, BackfillBlock, classification engine).
 *
 * On save, calls updateMeal which recomputes evaluation + meal_type +
 * calories server-side and returns the merged Meal so the parent can
 * patch its local list without a full refetch.
 */
function MealEditor({ meal, onSaved, onCancel }: {
  meal: Meal;
  onSaved: (updated: Meal) => void;
  onCancel: () => void;
}) {
  const tx = useTranslations("entriesExpand");
  // Carbs input now follows the user's chosen display unit (g / BE / KE)
  // — same pattern as the engine wizard. The value is seeded via
  // carbUnit.fromGrams() and converted back via carbUnit.toGrams() on
  // save. The DB column meals.carbs_grams stays in grams as the canonical
  // storage unit. We snapshot the seed string at mount so we can detect
  // a no-change roundtrip and write back the original grams unchanged
  // (avoids BE/KE rounding drift like 25g → 2.1 BE → 25.2g).
  const carbUnit = useCarbUnit();
  const initialCarbsDisplay = String(carbUnit.fromGrams(meal.carbs_grams ?? 0));
  const [carbs,   setCarbs]   = useState<string>(initialCarbsDisplay);
  const [carbsSeed] = useState<string>(initialCarbsDisplay);
  const [protein, setProtein] = useState<string>(String(meal.protein_grams ?? 0));
  const [fat,     setFat]     = useState<string>(String(meal.fat_grams     ?? 0));
  const [fiber,   setFiber]   = useState<string>(String(meal.fiber_grams   ?? 0));
  // Insulin: empty string means "noch offen" (null in DB), explicit "0"
  // means "0u given". We preserve that distinction in the editor even
  // though the collapsed list shows both as "0u" by request.
  const [bolus,   setBolus]   = useState<string>(meal.insulin_units != null ? String(meal.insulin_units) : "");
  // Editable meal time — seeded from `meal.meal_time` (or created_at
  // fallback) and shown as a native datetime-local input. User
  // request 2026-05-17 ("wenn ich entries expande und bearbeite will
  // ich auch zeit editieren können") — sub-headline used to say
  // "Glukose-Werte und Uhrzeit bleiben unverändert" but the time is
  // now editable too, so the help text below was updated. We seed
  // with the local-wallclock format the input expects (no TZ shift).
  const initialMealTimeIso = meal.meal_time ?? meal.created_at;
  const [mealTimeLocal, setMealTimeLocal] = useState<string>(() => {
    const d = new Date(initialMealTimeIso);
    if (Number.isNaN(d.getTime())) return "";
    const off = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
  });
  const [mealTimeSeed] = useState<string>(mealTimeLocal);
  // Editable glucose_before — auto-populated from the CGM history
  // when the user changes the meal time (user request 2026-05-17:
  // "ich will dass wenn man nach voice log die zeit verändert
  // entsprechend der cgm wert passend zu dieser ausgewählten zeit
  // aus der historie gezogen wird und autopopuliert"). We seed from
  // the persisted glucose_before; the auto-fill below replaces it
  // with the CGM sample closest to the new meal_time within a ±15
  // minute window. `glucoseSource` powers a small "auto / manual"
  // hint under the field so the user knows whether the current
  // number was hand-typed or pulled from the CGM stream.
  const [glucose,       setGlucose]       = useState<string>(meal.glucose_before != null ? String(meal.glucose_before) : "");
  const [glucoseSource, setGlucoseSource] = useState<"manual" | "cgm-auto" | "cgm-miss" | "cgm-error" | "cgm-loading" | null>(null);
  // Bumped on every manual onChange. The debounced CGM fetch
  // captures the value at request-start; if it changes before the
  // response lands, we drop the response so a late-arriving CGM
  // value cannot clobber what the user just typed (architect-found
  // race, 2026-05-17).
  const manualEditCounter = useRef(0);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  // Debounced CGM auto-fetch: whenever the user picks a new meal time
  // (and it actually differs from the seed), look for the CGM sample
  // closest to that wallclock within ±15 min and write its value into
  // the glucose field. Skips when the time is unchanged so we don't
  // clobber a manual edit on every render. /api/cgm/samples returns
  // continuous readings across both source tables (cgm_samples +
  // apple_health_readings) so this works for LLU, Nightscout, and
  // HealthKit users alike.
  useEffect(() => {
    if (mealTimeLocal.trim() === mealTimeSeed.trim()) return;
    if (mealTimeLocal.trim() === "") return;
    if (busy) return; // freeze auto-fill while a save is in flight
    const candidate = new Date(mealTimeLocal);
    if (Number.isNaN(candidate.getTime())) return;
    let cancelled = false;
    const editVersionAtStart = manualEditCounter.current;
    const ctrl = new AbortController();
    setGlucoseSource("cgm-loading");
    const id = window.setTimeout(async () => {
      const targetMs = candidate.getTime();
      const windowMs = 15 * 60_000;
      const fromIso  = new Date(targetMs - windowMs).toISOString();
      const toIso    = new Date(targetMs + windowMs).toISOString();
      try {
        const r = await fetch(
          `/api/cgm/samples?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        if (cancelled) return;
        if (!r.ok) { setGlucoseSource("cgm-error"); return; }
        const body = await r.json() as { samples?: Array<{ v: number; t: number }> };
        if (cancelled) return;
        // Manual-dirty guard: if the user typed something into the
        // glucose field between request-start and now, never clobber
        // it — only update the status hint.
        if (manualEditCounter.current !== editVersionAtStart) return;
        const samples = Array.isArray(body.samples) ? body.samples : [];
        if (samples.length === 0) {
          setGlucoseSource("cgm-miss");
          return;
        }
        // Pick the sample whose timestamp is closest to the chosen
        // meal time. Ties (rare) break by the earlier sample.
        let best = samples[0];
        let bestDelta = Math.abs(best.t - targetMs);
        for (const s of samples) {
          const d = Math.abs(s.t - targetMs);
          if (d < bestDelta) { best = s; bestDelta = d; }
        }
        setGlucose(String(Math.round(best.v)));
        setGlucoseSource("cgm-auto");
      } catch (e) {
        if (cancelled) return;
        if ((e as { name?: string })?.name === "AbortError") return;
        setGlucoseSource("cgm-error");
      }
    }, 450);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [mealTimeLocal, mealTimeSeed, busy]);

  // Auto-scroll the editor into view when it mounts. The list is long and
  // the editor often opens far below the fold (depending on which entry the
  // user clicked) — without this, the page sits at its previous scroll
  // position and the user has to hunt for the editor manually.
  // Using "start" with a small offset to clear the sticky page header.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Defer one frame so the layout is settled (the editor swaps in
    // synchronously but the surrounding page can still be reflowing).
    const id = requestAnimationFrame(() => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Scroll to position the editor 80px from the viewport top to leave
      // breathing room under the page's sticky filter bar.
      const target = window.scrollY + rect.top - 80;
      window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  function parseNum(s: string): number | null {
    const t = s.trim().replace(",", ".");
    if (t === "") return null;
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  async function handleSave() {
    setErr(null);
    const c  = parseNum(carbs);
    const p  = parseNum(protein);
    const f  = parseNum(fat);
    const fb = parseNum(fiber);
    if (c === null || p === null || f === null || fb === null) {
      setErr("Bitte gültige Zahlen für alle Makros eintragen (0 ist erlaubt).");
      return;
    }
    if (c < 0 || p < 0 || f < 0 || fb < 0) {
      setErr("Makro-Werte dürfen nicht negativ sein.");
      return;
    }
    // Insulin: empty → null (Bolus offen), else must be a finite number ≥ 0.
    let i: number | null;
    const bt = bolus.trim();
    if (bt === "") {
      i = null;
    } else {
      const iv = parseNum(bt);
      if (iv === null || iv < 0) {
        setErr("Bolus muss 0 oder positiv sein (oder leer für 'noch offen').");
        return;
      }
      i = iv;
    }
    // Convert displayed carbs back to grams. Skip the conversion on a
    // pure no-change roundtrip so BE/KE rounding (e.g. 25g → 2.1 BE →
    // 25.2g) doesn't silently drift the stored value.
    const carbsUnchanged =
      meal.carbs_grams != null &&
      carbs.trim() === carbsSeed.trim();
    const carbsGramsToWrite = carbsUnchanged
      ? meal.carbs_grams!
      : carbUnit.toGrams(c);
    // Meal-time: only send if the user actually changed it (avoids
    // overwriting a precise meal_time with a re-roundtripped wall-clock
    // string that differs only in second-precision). datetime-local has
    // no timezone, so we interpret it as the user's local wall clock
    // and convert to a real ISO instant for storage — same approach
    // the engine wizard uses on save.
    let mealTimeIso: string | undefined;
    if (mealTimeLocal.trim() !== mealTimeSeed.trim()) {
      const trimmed = mealTimeLocal.trim();
      if (trimmed === "") {
        mealTimeIso = undefined; // leave unchanged if user blanked it
      } else {
        const d = new Date(trimmed);
        if (Number.isNaN(d.getTime())) {
          setErr(tx("ex_err_time_verbose"));
          return;
        }
        mealTimeIso = d.toISOString();
      }
    }
    // Glucose: empty → leave unchanged (don't clear an existing value
    // by accident), otherwise require a finite positive number. Only
    // patch when the value actually differs from the persisted one to
    // avoid spurious lifecycle recomputes.
    const glucoseSeed = meal.glucose_before != null ? String(meal.glucose_before) : "";
    let glucoseToWrite: number | null | undefined;
    if (glucose.trim() !== glucoseSeed.trim()) {
      if (glucose.trim() === "") {
        glucoseToWrite = undefined; // leave column unchanged on blank
      } else {
        const gv = parseNum(glucose);
        if (gv === null || gv <= 0) {
          setErr(tx("ex_err_glucose"));
          return;
        }
        glucoseToWrite = gv;
      }
    }
    setBusy(true);
    try {
      const updated = await updateMeal(meal.id, {
        carbs_grams:   carbsGramsToWrite,
        protein_grams: p,
        fat_grams:     f,
        fiber_grams:   fb,
        insulin_units: i,
        ...(mealTimeIso   !== undefined ? { meal_time:      mealTimeIso }   : null),
        ...(glucoseToWrite !== undefined ? { glucose_before: glucoseToWrite } : null),
      });
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx("ex_err_save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} style={{ display:"flex", flexDirection:"column", gap:14, scrollMarginTop:110 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {tx("meal_editor_title")}
        </div>
        <span style={{ padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700, background:`${ACCENT}20`, color:ACCENT, border:`1px solid ${ACCENT}40`, letterSpacing:"0.04em", textTransform:"uppercase" }}>
          Editor
        </span>
      </div>

      <div style={{ fontSize:13, color:"var(--text-dim)", lineHeight:1.5 }}>
        {tx("meal_editor_hint")}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
        <EditField label={`Carbs (${carbUnit.label})`}   value={carbs}   onChange={setCarbs}   accent={ORANGE}    placeholder={carbUnit.placeholder} step={carbUnit.step} />
        <EditField label="Protein (g)" value={protein} onChange={setProtein} accent="#3B82F6"   placeholder="0" />
        <EditField label="Fat (g)"     value={fat}     onChange={setFat}     accent="#A855F7"   placeholder="0" />
        <EditField label="Fiber (g)"   value={fiber}   onChange={setFiber}                       placeholder="0" />
      </div>

      <EditField
        label={tx("meal_editor_bolus_label")}
        value={bolus}
        onChange={setBolus}
        accent={ACCENT}
        placeholder={tx("meal_editor_bolus_placeholder")}
      />

      {/* Editable meal time — native datetime-local picker so iOS /
          Android render their wheel + calendar UI without us needing
          a custom widget. Same styling as EditField below to keep
          the form visually consistent. Whenever the user picks a new
          time, the effect above queries /api/cgm/samples in a ±15min
          window around that wallclock and auto-populates the glucose
          field with the closest CGM reading from the user's history. */}
      <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
        <span style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {tx("meal_editor_time_label")}
        </span>
        <input
          type="datetime-local"
          value={mealTimeLocal}
          onChange={(e) => setMealTimeLocal(e.target.value)}
          style={{
            background:"var(--surface-soft)",
            border:`1px solid ${ACCENT}40`,
            borderRadius:8,
            padding:"10px 12px",
            color:"var(--text)",
            fontSize:14,
            fontWeight:600,
            fontFamily:"var(--font-mono)",
            outline:"none",
            colorScheme:"dark",
            width:"100%",
            boxSizing:"border-box",
          }}
        />
      </label>

      {/* Editable glucose_before — manual edit OR auto-populated
          from the CGM history when the meal time changes (see
          effect above). The small hint under the input reflects
          provenance so the user knows whether the current number
          was hand-typed or pulled from the stream. */}
      <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
        <span style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {tx("meal_editor_glucose_label")}
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={glucose}
          onChange={(e) => {
            setGlucose(e.target.value);
            setGlucoseSource("manual");
            manualEditCounter.current += 1; // invalidate any pending CGM fetch
          }}
          placeholder={tx("meal_editor_glucose_placeholder")}
          style={{
            background:"var(--surface-soft)",
            border:`1px solid ${GREEN}40`,
            borderRadius:8,
            padding:"10px 12px",
            color:"var(--text)",
            fontSize:14,
            fontWeight:600,
            fontFamily:"var(--font-mono)",
            outline:"none",
            colorScheme:"dark",
            width:"100%",
            boxSizing:"border-box",
          }}
        />
        {glucoseSource && (
          <span style={{
            fontSize:11, color:
              glucoseSource === "cgm-auto"    ? GREEN :
              glucoseSource === "cgm-loading" ? "var(--text-dim)" :
              glucoseSource === "cgm-miss"    ? PINK :
              glucoseSource === "cgm-error"   ? PINK : "var(--text-dim)",
            letterSpacing:"0.02em", marginTop:2,
          }}>
            {glucoseSource === "cgm-auto"    && tx("meal_cgm_auto")}
            {glucoseSource === "cgm-loading" && tx("meal_cgm_loading")}
            {glucoseSource === "cgm-miss"    && tx("meal_cgm_miss")}
            {glucoseSource === "cgm-error"   && tx("meal_cgm_error")}
            {glucoseSource === "manual"      && tx("meal_cgm_manual")}
          </span>
        )}
      </label>

      {err && (
        <div style={{ fontSize:13, color:PINK, padding:"8px 10px", background:`${PINK}10`, border:`1px solid ${PINK}30`, borderRadius:8 }}>
          {err}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:4 }}>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            padding:"12px",
            borderRadius:10,
            border:`1px solid ${BORDER}`,
            background:"var(--surface-soft)",
            color:"var(--text-body)",
            fontSize:14,
            fontWeight:600,
            cursor:busy ? "not-allowed" : "pointer",
            letterSpacing:"0.02em",
          }}
        >
          {tx("ex_cancel")}
        </button>
        <button
          onClick={handleSave}
          disabled={busy}
          style={{
            padding:"12px",
            borderRadius:10,
            border:`1px solid ${ACCENT}`,
            background:ACCENT,
            color:"var(--on-accent)",
            fontSize:14,
            fontWeight:700,
            cursor:busy ? "wait" : "pointer",
            letterSpacing:"0.02em",
          }}
        >
          {busy ? tx("ex_saving") : tx("ex_save")}
        </button>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, accent, placeholder, step }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accent?: string;
  placeholder?: string;
  /** Optional numeric step — primarily a hint that the field is a
   *  number input (BE/KE typically use 0.5). When set we switch the
   *  input to type="number" so mobile spinners step in 0.5 increments
   *  instead of 1. parseNum on the save side still tolerates commas. */
  step?: number;
}) {
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <span style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
        {label}
      </span>
      <input
        type={step != null ? "number" : "text"}
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background:"var(--surface-soft)",
          border:`1px solid ${accent ? accent + "40" : BORDER}`,
          borderRadius:8,
          padding:"10px 12px",
          color:"var(--text)",
          fontSize:14,
          fontWeight:600,
          fontFamily:"var(--font-mono)",
          outline:"none",
          colorScheme:"dark",
          width:"100%",
          boxSizing:"border-box",
        }}
      />
    </label>
  );
}

// ── CYCLE / SYMPTOM ROW CARDS ───────────────────────────────────────
// Both rows are visually compact, single-state cards (no expand body)
// because the underlying records carry a small, fixed payload — there
// is nothing extra to reveal beyond what fits on one line. They use the
// same hover/border-shadow pattern as ExerciseRowCard so they slot
// naturally into the entry stream.

function fmtDateShort(s: string, locale: string): string {
  // Date-only string ("YYYY-MM-DD") — render as "Apr 27" / "27. Apr."
  // following the user's UI locale, avoiding TZ shifts. Locale is now
  // threaded in (was hardcoded "de") so the Cycle row matches the
  // Meal/Bolus row format for EN users.
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

function fmtDateTimeShort(iso: string, locale: string, fmtTime: (d: Date) => string): string {
  // Date + locale/pref-aware time. Date portion follows locale ("May 16"
  // vs "16. Mai"); time portion is delegated to the caller's
  // useTimeFormat().format helper so the user's auto/24h/12h pref
  // (Settings → Zeitformat) decides AM-PM vs 24h consistently with the
  // Meal/Bolus/Basal/Exercise cards.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return `${datePart}, ${fmtTime(d)}`;
}

function CycleRowCard({ log, onDelete, deleting, onUpdated }: {
  log: MenstrualLog;
  onDelete: () => void;
  deleting: boolean;
  onUpdated: (updated: MenstrualLog) => void;
}) {
  const t = useTranslations("engineLog");
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const isBleeding = log.flow_intensity != null;
  const accent = "#FF2D78";

  if (editing) {
    return (
      <div style={{
        background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:12,
        padding:"14px 14px",
      }}>
        <CycleEditor
          log={log}
          onSaved={(updated) => { setEditing(false); onUpdated(updated); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  // Prefer the new 4-phase enum; fall back to the legacy phase_marker
  // for pre-refactor rows so the entries log keeps rendering history
  // entries (notably 'pms' / 'other') under their original label.
  const heading = isBleeding
    ? `${t("cycle_row_bleeding")} · ${t(`cycle_flow_${log.flow_intensity}` as never)}`
    : log.cycle_phase
      ? `${t("cycle_row_marker")} · ${t(`cycle_phase_${log.cycle_phase}` as never)}`
      : `${t("cycle_row_marker")} · ${log.phase_marker ? t(`cycle_marker_${log.phase_marker}` as never) : ""}`;
  const dateLine = log.end_date && log.end_date !== log.start_date
    ? `${fmtDateShort(log.start_date, locale)} – ${fmtDateShort(log.end_date, locale)}`
    : fmtDateShort(log.start_date, locale);
  return (
    <div style={{
      background:SURFACE, border:`1px solid ${BORDER}`, borderRadius:12,
      padding:"12px 14px", display:"flex", alignItems:"center", gap:12,
    }}>
      <div style={{
        width:30, height:30, borderRadius:8,
        background:`${accent}18`, color:accent,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontWeight:800, fontSize:14, flexShrink:0,
      }}>♀</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"var(--text-strong)", letterSpacing:"-0.01em" }}>
          {heading}
        </div>
        <div style={{ fontSize:13, color:"var(--text-faint)", marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
          <span>{dateLine}</span>
          {log.notes && <span style={{ color:"var(--text-dim)" }}>· {log.notes}</span>}
        </div>
      </div>
      <button
        onClick={() => setEditing(true)}
        aria-label="Bearbeiten"
        style={{
          background:"transparent", border:"none", cursor:"pointer",
          color:"var(--text-faint)", padding:6, borderRadius:6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button
        onClick={onDelete}
        disabled={deleting}
        aria-label={t("row_delete_aria")}
        style={{
          background:"transparent", border:"none", cursor:deleting?"wait":"pointer",
          color:"var(--text-faint)", padding:6, borderRadius:6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// InfluenceRowCard / SymptomRowCard — both now reuse NonMealRow so they
// share the same date/time "When" chip, badge, primary/secondary metric
// layout, and Edit + Delete action grid that bolus / basal / exercise
// rows already use. Collapsed view = quick scan; expanded view = full
// details, with an inline editor toggle (mirrors ExerciseRowCard).
// ─────────────────────────────────────────────────────────────────────────

const INFLUENCE_ACCENT = "#F5A524";
const SYMPTOM_ACCENT   = "#A78BFA";

function InfluenceRowCard({ log, isOpen, onToggle, onDelete, deleting, onUpdated }: {
  log: InfluenceLog;
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  onUpdated: (updated: InfluenceLog) => void;
}) {
  const t = useTranslations("engineLog");
  const tx = useTranslations("entriesExpand");
  const locale = useLocale();
  const { format: fmtTime } = useTimeFormat();
  const occurred = parseDbDate(log.occurred_at);
  const dateStr = occurred.toLocaleDateString(locale, { month:"short", day:"numeric" });
  const timeStr = fmtTime(occurred);
  const typeLabel = t(`influence_type_${log.influence_type}` as never);

  // Editor state — mirrors ExerciseEditor: open in-place via onEdit,
  // collapses when the row collapses (parent toggles isOpen).
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!isOpen) setEditing(false); }, [isOpen]);

  // Collapsed metrics: primary = AMOUNT (the most "at-a-glance" value
  // the user logged), secondary = DETAILS. Both fall back to "—" so
  // the row keeps its grid shape even for sparse legacy entries.
  const amountValue  = log.amount  && log.amount.trim()  ? log.amount  : "—";
  const detailsValue = log.details && log.details.trim() ? log.details : "—";

  return (
    <NonMealRow
      isOpen={isOpen}
      onToggle={editing ? () => {} : onToggle}
      onDelete={onDelete}
      deleting={deleting}
      onEdit={editing ? undefined : () => setEditing(true)}
      suppressActions={editing}
      accent={INFLUENCE_ACCENT}
      badge={typeLabel}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel={t("influence_amount_label").replace(/\s*\(.*\)\s*$/, "").toUpperCase()}
      primaryValue={amountValue}
      primaryColor={INFLUENCE_ACCENT}
      secondaryLabel={t("influence_details_label").replace(/\s*\(.*\)\s*$/, "").toUpperCase()}
      secondaryValue={detailsValue}
      expandedDetails={editing ? (
        <InfluenceEditor
          log={log}
          onSaved={(updated) => { setEditing(false); onUpdated(updated); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <ExPanel title={tx("panel_session_details")}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
              <Detail label={t("influence_type_label").toUpperCase()} value={typeLabel} color={INFLUENCE_ACCENT}/>
              <Detail label={t("influence_amount_label").replace(/\s*\(.*\)\s*$/, "").toUpperCase()} value={amountValue}/>
              <Detail label={t("influence_details_label").replace(/\s*\(.*\)\s*$/, "").toUpperCase()} value={detailsValue}/>
              <Detail label={tx("row_when")} value={`${dateStr} · ${timeStr}`}/>
            </div>
          </ExPanel>
          {log.notes && (
            <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{tx("ex_notes_label")}</div>
              <div style={{ fontSize:14, color:"var(--text-strong)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}
        </div>
      )}
    />
  );
}

function SymptomRowCard({ log, isOpen, onToggle, onDelete, deleting, onUpdated }: {
  log: SymptomLog;
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  onUpdated: (updated: SymptomLog) => void;
}) {
  const t = useTranslations("engineLog");
  const tx = useTranslations("entriesExpand");
  const locale = useLocale();
  const { format: fmtTime } = useTimeFormat();
  const occurred = parseDbDate(log.occurred_at);
  const dateStr = occurred.toLocaleDateString(locale, { month:"short", day:"numeric" });
  const timeStr = fmtTime(occurred);

  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!isOpen) setEditing(false); }, [isOpen]);

  // Collapsed metrics: primary = SEVERITY (numeric "3/5" so the cell
  // stays compact under the mono treatment), secondary = TYPES count
  // + the first type label so the user can scan without expanding.
  const types = log.symptom_types || [];
  const firstTypeLabel = types[0] ? t(`symptom_${types[0]}` as never) : "—";
  const typesValue = types.length <= 1
    ? firstTypeLabel
    : `${firstTypeLabel} +${types.length - 1}`;
  const badgeLabel = log.category === "pms"
    ? t("symptom_category_pms_badge")
    : t("symptom_row_title");

  return (
    <NonMealRow
      isOpen={isOpen}
      onToggle={editing ? () => {} : onToggle}
      onDelete={onDelete}
      deleting={deleting}
      onEdit={editing ? undefined : () => setEditing(true)}
      suppressActions={editing}
      accent={SYMPTOM_ACCENT}
      badge={badgeLabel}
      dateStr={dateStr}
      timeStr={timeStr}
      primaryLabel={tx("row_severity")}
      primaryValue={(() => {
        // Per-symptom severities (Task: per-symptom severity).
        // Row primary cell collapses to one number: show the exact
        // value if every symptom shares the same severity, else show
        // "Ø {mean}/5" so the user knows it's an aggregate.
        const vals: number[] = [];
        for (const v of Object.values(log.severities ?? {})) {
          if (typeof v === "number") vals.push(v);
        }
        if (vals.length === 0) return "—";
        const allSame = vals.every(v => v === vals[0]);
        const avg = avgSeverity(log) ?? vals[0];
        return allSame ? `${vals[0]}/5` : `Ø ${avg}/5`;
      })()}
      primaryColor={SYMPTOM_ACCENT}
      primaryMono
      secondaryLabel={tx("row_symptoms")}
      secondaryValue={typesValue}
      secondarySubtitle={log.cgm_glucose_at_log != null ? `${log.cgm_glucose_at_log} mg/dL` : undefined}
      expandedDetails={editing ? (
        <SymptomEditor
          log={log}
          onSaved={(updated) => { setEditing(false); onUpdated(updated); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <ExPanel title={tx("panel_session_details")}>
            <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, textTransform:"uppercase", marginBottom:6 }}>
              {tx("row_symptoms")}
            </div>
            {types.length === 0 ? (
              <span style={{ fontSize:13, color:"var(--text-faint)" }}>—</span>
            ) : (
              // One row per symptom — label on the left, severity dots
              // + numeric value on the right. Replaces the legacy
              // single "row severity" line now that each symptom
              // carries its own 1..5 value.
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {types.map(s => {
                  const sev = (log.severities ?? {})[s];
                  const sevNum = typeof sev === "number" ? sev : null;
                  return (
                    <div key={s} style={{
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                      gap:10, padding:"6px 10px", borderRadius:10,
                      background:`${SYMPTOM_ACCENT}10`, border:`1px solid ${SYMPTOM_ACCENT}26`,
                    }}>
                      <span style={{
                        fontSize:13, fontWeight:600, color:SYMPTOM_ACCENT,
                        minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      }}>{t(`symptom_${s}` as never)}</span>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flex:"0 0 auto" }}>
                        <div style={{ display:"flex", gap:3 }} aria-label={`Severity ${sevNum ?? "?"} of 5`}>
                          {[1,2,3,4,5].map(n => (
                            <span key={n} style={{
                              width:7, height:7, borderRadius:99,
                              background: sevNum != null && n <= sevNum ? SYMPTOM_ACCENT : "var(--border-strong)",
                            }}/>
                          ))}
                        </div>
                        <span style={{ fontSize:13, fontWeight:700, color:SYMPTOM_ACCENT, fontFamily:"var(--font-mono)", minWidth:32, textAlign:"right" }}>
                          {sevNum != null ? `${sevNum}/5` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ExPanel>
          {log.cgm_glucose_at_log != null && (
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
              borderRadius:10, padding:"10px 12px",
            }}>
              <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, textTransform:"uppercase" }}>
                {tx("ex_cgm_at_log")}
              </div>
              <div style={{ fontSize:14, fontWeight:700, color:SYMPTOM_ACCENT, fontFamily:"var(--font-mono)" }}>
                {log.cgm_glucose_at_log} mg/dL
              </div>
            </div>
          )}
          {log.notes && (
            <div style={{ background:"var(--surface-soft)", border:`1px solid ${BORDER}`, borderRadius:10, padding:"10px 12px" }}>
              <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:4 }}>{tx("ex_notes_label")}</div>
              <div style={{ fontSize:14, color:"var(--text-strong)", lineHeight:1.5 }}>{log.notes}</div>
            </div>
          )}
        </div>
      )}
    />
  );
}

/**
 * Inline editor for a single InfluenceLog. Exposes the four user-
 * facing fields the row card surfaces: type / amount / details /
 * notes. The CGM snapshot is intentionally not editable.
 */
function InfluenceEditor({ log, onSaved, onCancel }: {
  log: InfluenceLog;
  onSaved: (updated: InfluenceLog) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("engineLog");
  const tCommon = useTranslations();
  const tx = useTranslations("entriesExpand");
  const [type, setType]       = useState<InfluenceType>(log.influence_type);
  const [amount, setAmount]   = useState<string>(log.amount ?? "");
  const [details, setDetails] = useState<string>(log.details ?? "");
  const [notes, setNotes]     = useState<string>(log.notes ?? "");
  const [occurredLocal, setOccurredLocal] = useState<string>(() => isoToLocal(log.occurred_at));
  const [occurredSeed] = useState<string>(() => isoToLocal(log.occurred_at));
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  async function handleSave() {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const patch: {
        influence_type?: InfluenceType;
        amount?: string | null;
        details?: string | null;
        notes?: string | null;
        occurred_at?: string;
      } = {};
      if (type !== log.influence_type) patch.influence_type = type;
      const a = amount.trim();  const na = a.length > 0 ? a : null;
      if (na !== (log.amount  ?? null)) patch.amount = na;
      const d = details.trim(); const nd = d.length > 0 ? d : null;
      if (nd !== (log.details ?? null)) patch.details = nd;
      const n = notes.trim();   const nn = n.length > 0 ? n : null;
      if (nn !== (log.notes   ?? null)) patch.notes = nn;
      if (occurredLocal.trim() !== occurredSeed.trim() && occurredLocal.trim() !== "") {
        const iso = localToIso(occurredLocal);
        if (!iso) { setErr(tx("ex_err_time")); setBusy(false); return; }
        patch.occurred_at = iso;
      }

      if (Object.keys(patch).length === 0) { setBusy(false); onCancel(); return; }
      const updated = await updateInfluenceLog(log.id, patch);
      queueMicrotask(() => window.dispatchEvent(new Event("glev:influence-updated")));
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx("ex_err_save"));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {t("influence_row_title").toUpperCase()}
        </div>
        <span style={{
          padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700,
          background:`${INFLUENCE_ACCENT}20`, color:INFLUENCE_ACCENT,
          border:`1px solid ${INFLUENCE_ACCENT}40`,
        }}>{t(`influence_type_${type}` as never)}</span>
      </div>

      <div>
        <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:6, textTransform:"uppercase" }}>
          {t("influence_type_label")}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {INFLUENCE_TYPES.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => setType(opt)}
              style={{
                padding:"6px 12px", borderRadius:99, fontSize:13, fontWeight:600,
                background: opt === type ? `${INFLUENCE_ACCENT}22` : "var(--surface-soft)",
                color: opt === type ? INFLUENCE_ACCENT : "var(--text-body)",
                border: `1px solid ${opt === type ? `${INFLUENCE_ACCENT}50` : BORDER}`,
                cursor:"pointer",
              }}
            >{t(`influence_type_${opt}` as never)}</button>
          ))}
        </div>
      </div>

      <DateTimeField
        label="Zeitpunkt"
        value={occurredLocal}
        onChange={setOccurredLocal}
        accent={INFLUENCE_ACCENT}
      />
      <EditorField label={t("influence_amount_label")}  value={amount}  onChange={setAmount}  placeholder={t("influence_amount_placeholder")}/>
      <EditorField label={t("influence_details_label")} value={details} onChange={setDetails} placeholder={t("influence_details_placeholder")}/>
      <EditorField label={tx("ex_notes_label")} value={notes} onChange={setNotes} placeholder="" multiline/>

      {err && <div style={{ fontSize:12, color:PINK }}>{err}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <button onClick={onCancel} disabled={busy} style={{
          padding:"12px", borderRadius:10, border:`1px solid ${BORDER}`,
          background:"var(--surface-soft)", color:"var(--text-body)",
          fontSize:14, fontWeight:600, cursor:busy?"not-allowed":"pointer",
        }}>{tCommon("cancel_btn")}</button>
        <button onClick={handleSave} disabled={busy} style={{
          padding:"12px", borderRadius:10, border:"none",
          background:INFLUENCE_ACCENT, color:"#fff",
          fontSize:14, fontWeight:700, cursor:busy?"not-allowed":"pointer",
        }}>{busy ? "…" : t("influence_save_btn")}</button>
      </div>
    </div>
  );
}

/**
 * Inline editor for a single SymptomLog. Severity slider (1..5),
 * toggle chips for the curated symptom vocabulary, plus optional
 * notes. Category (general/pms) is preserved as-is since switching
 * it would force re-picking the entire chip set — that belongs to
 * the dedicated log form, not this in-place corrector.
 */
function SymptomEditor({ log, onSaved, onCancel }: {
  log: SymptomLog;
  onSaved: (updated: SymptomLog) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("engineLog");
  const tx = useTranslations("entriesExpand");
  // Per-symptom severity (Task: per-symptom severity in the edit
  // sheet). Each chip carries its own 1..5 value; toggling a chip
  // off drops its entry, toggling on (re)adds with the row's old
  // value if we still have it, otherwise default 3.
  const [types, setTypes] = useState<SymptomType[]>([...(log.symptom_types || [])]);
  const [severities, setSeverities] = useState<SeveritiesMap>(() => {
    const src = (log.severities ?? {}) as SeveritiesMap;
    const out: SeveritiesMap = {};
    for (const s of log.symptom_types || []) {
      const v = src[s];
      out[s] = (typeof v === "number" ? v : 3) as SeverityValue;
    }
    return out;
  });
  const [notes, setNotes] = useState<string>(log.notes ?? "");
  const [occurredLocal, setOccurredLocal] = useState<string>(() => isoToLocal(log.occurred_at));
  const [occurredSeed] = useState<string>(() => isoToLocal(log.occurred_at));
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  function toggleType(s: SymptomType) {
    const wasOn = types.includes(s);
    setTypes(prev => wasOn ? prev.filter(x => x !== s) : [...prev, s]);
    setSeverities(prev => {
      const next: SeveritiesMap = { ...prev };
      if (wasOn) {
        delete next[s];
      } else {
        // Restore the row's original value if it had one, else 3.
        const orig = (log.severities ?? {})[s];
        next[s] = (typeof orig === "number" ? orig : 3) as SeverityValue;
      }
      return next;
    });
  }

  function setSymptomSeverity(s: SymptomType, v: SeverityValue) {
    setSeverities(prev => ({ ...prev, [s]: v }));
  }

  async function handleSave() {
    if (busy) return;
    setErr(null);
    if (types.length === 0) { setErr("Mindestens ein Symptom erforderlich."); return; }
    setBusy(true);
    try {
      const patch: { severities?: SeveritiesMap; symptom_types?: SymptomType[]; notes?: string | null; occurred_at?: string } = {};
      const prevTypes = [...(log.symptom_types || [])].sort().join(",");
      const nextTypes = [...types].sort().join(",");
      const typesChanged = prevTypes !== nextTypes;
      // Did any severity value change? Compare on the final type
      // list so a removed chip doesn't trigger a spurious diff.
      const prevSev = (log.severities ?? {}) as SeveritiesMap;
      const sevChanged = typesChanged || types.some(
        s => severities[s] !== prevSev[s],
      );
      if (typesChanged) patch.symptom_types = types;
      if (sevChanged) {
        const clean: SeveritiesMap = {};
        for (const s of types) {
          const v = severities[s];
          clean[s] = (typeof v === "number" ? v : 3) as SeverityValue;
        }
        patch.severities = clean;
      }
      const n = notes.trim(); const nn = n.length > 0 ? n : null;
      if (nn !== (log.notes ?? null)) patch.notes = nn;
      if (occurredLocal.trim() !== occurredSeed.trim() && occurredLocal.trim() !== "") {
        const iso = localToIso(occurredLocal);
        if (!iso) { setErr(tx("ex_err_time")); setBusy(false); return; }
        patch.occurred_at = iso;
      }

      if (Object.keys(patch).length === 0) { setBusy(false); onCancel(); return; }
      const updated = await updateSymptomLog(log.id, patch);
      queueMicrotask(() => window.dispatchEvent(new Event("glev:symptom-updated")));
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx("ex_err_save"));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {t("symptom_row_title").toUpperCase()}
        </div>
        {log.category === "pms" && (
          <span style={{
            padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700,
            background:`${SYMPTOM_ACCENT}20`, color:SYMPTOM_ACCENT,
            border:`1px solid ${SYMPTOM_ACCENT}40`,
          }}>{t("symptom_category_pms_badge")}</span>
        )}
      </div>

      <div>
        <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:6, textTransform:"uppercase" }}>
          {t("symptom_row_title")}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {SYMPTOM_TYPES.map(s => {
            const active = types.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleType(s)}
                style={{
                  padding:"6px 10px", borderRadius:99, fontSize:12, fontWeight:600,
                  background: active ? `${SYMPTOM_ACCENT}22` : "var(--surface-soft)",
                  color: active ? SYMPTOM_ACCENT : "var(--text-body)",
                  border: `1px solid ${active ? `${SYMPTOM_ACCENT}50` : BORDER}`,
                  cursor:"pointer",
                }}
              >{t(`symptom_${s}` as never)}</button>
            );
          })}
        </div>
      </div>

      {types.length > 0 && (
        <div>
          <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, marginBottom:8, textTransform:"uppercase" }}>
            {t("symptom_severity_per_chip_label")}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {types.map(s => {
              const v = (severities[s] ?? 3) as SeverityValue;
              return (
                <div key={s} style={{
                  display:"flex", alignItems:"center", gap:10,
                  background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
                  borderRadius:10, padding:"8px 10px",
                }}>
                  <div style={{
                    flex:"1 1 auto", minWidth:0,
                    fontSize:13, fontWeight:600, color:SYMPTOM_ACCENT,
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                  }}>
                    {t(`symptom_${s}` as never)}
                  </div>
                  <div role="radiogroup" aria-label={t(`symptom_${s}` as never)} style={{ display:"flex", gap:4 }}>
                    {[1,2,3,4,5].map(n => {
                      const on = n === v;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setSymptomSeverity(s, n as SeverityValue)}
                          style={{
                            width:32, height:32, borderRadius:8,
                            background: on ? `${SYMPTOM_ACCENT}22` : "transparent",
                            color: on ? SYMPTOM_ACCENT : "var(--text-body)",
                            border: `1px solid ${on ? `${SYMPTOM_ACCENT}50` : BORDER}`,
                            fontSize:13, fontWeight:700, cursor:"pointer",
                            fontFamily:"var(--font-mono)", padding:0,
                          }}
                        >{n}</button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:11, color:"var(--text-faint)" }}>
            <span>{t("symptom_severity_min")}</span>
            <span>{t("symptom_severity_max")}</span>
          </div>
        </div>
      )}

      <DateTimeField
        label="Zeitpunkt"
        value={occurredLocal}
        onChange={setOccurredLocal}
        accent={SYMPTOM_ACCENT}
      />
      <EditorField label={tx("ex_notes_label")} value={notes} onChange={setNotes} placeholder="" multiline/>

      {err && <div style={{ fontSize:12, color:PINK }}>{err}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <button onClick={onCancel} disabled={busy} style={{
          padding:"12px", borderRadius:10, border:`1px solid ${BORDER}`,
          background:"var(--surface-soft)", color:"var(--text-body)",
          fontSize:14, fontWeight:600, cursor:busy?"not-allowed":"pointer",
        }}>{t("cancel_btn")}</button>
        <button onClick={handleSave} disabled={busy} style={{
          padding:"12px", borderRadius:10, border:"none",
          background:SYMPTOM_ACCENT, color:"#fff",
          fontSize:14, fontWeight:700, cursor:busy?"not-allowed":"pointer",
        }}>{busy ? "…" : t("symptom_save_btn")}</button>
      </div>
    </div>
  );
}

/** Small labelled text/textarea field used by the symptom + influence
 *  inline editors. Keeps the editor visuals consistent with the rest
 *  of the entries page's surface tokens. */
function EditorField({ label, value, onChange, placeholder, multiline }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; multiline?: boolean;
}) {
  const common: React.CSSProperties = {
    width:"100%", padding:"10px 12px",
    background:"var(--surface-soft)", border:`1px solid ${BORDER}`,
    borderRadius:10, color:"var(--text-strong)", fontSize:14,
    fontFamily:"inherit", outline:"none",
  };
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ fontSize:11, color:"var(--text-faint)", letterSpacing:"0.08em", fontWeight:600, textTransform:"uppercase" }}>
        {label}
      </div>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} style={{ ...common, resize:"vertical" }}/>
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={common}/>
      )}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// InsulinEntryEditor — shared inline editor for both BOLUS and BASAL rows.
// Editable fields: wallclock, units, insulin name, notes. When the
// wallclock changes the server re-fetches `cgm_glucose_at_log` from the
// CGM history (bolus only — basal rows don't surface that column
// meaningfully). All edits dispatch `glev:insulin-updated` so the
// entries page reloads the row in-place.
// ─────────────────────────────────────────────────────────────────────────
function InsulinEntryEditor({ log, onSaved, onCancel }: {
  log: InsulinLog;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const txIe = useTranslations("entriesExpand");
  const accent = log.insulin_type === "bolus" ? INSULIN_ACCENT : BASAL_ACCENT;
  const [createdLocal, setCreatedLocal] = useState<string>(() => isoToLocal(log.created_at));
  const [createdSeed] = useState<string>(() => isoToLocal(log.created_at));
  const [units, setUnits] = useState<number>(log.units);
  const [name, setName]   = useState<string>(log.insulin_name ?? "");
  const [notes, setNotes] = useState<string>(log.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState<number>(0);

  async function handleSave() {
    if (busy) return;
    setErr(null);
    if (!Number.isFinite(units) || units < 0 || units > 200) {
      setErr(txIe("ex_err_dose")); return;
    }
    setBusy(true);
    try {
      const patch: { created_at?: string; units?: number; insulin_name?: string | null; notes?: string | null } = {};
      if (units !== log.units) patch.units = units;
      const trimmedName = name.trim();
      const normName = trimmedName.length > 0 ? trimmedName : null;
      if (normName !== (log.insulin_name ?? null)) patch.insulin_name = normName;
      const trimmedNotes = notes.trim();
      const normNotes = trimmedNotes.length > 0 ? trimmedNotes : null;
      if (normNotes !== (log.notes ?? null)) patch.notes = normNotes;
      if (createdLocal.trim() !== createdSeed.trim() && createdLocal.trim() !== "") {
        const iso = localToIso(createdLocal);
        if (!iso) { setErr(txIe("ex_err_time")); setBusy(false); return; }
        patch.created_at = iso;
      }
      if (Object.keys(patch).length === 0) { setBusy(false); onCancel(); return; }
      await updateInsulinEntry(log.id, patch);
      setSavedTick(n => n + 1);
      queueMicrotask(() => window.dispatchEvent(new Event("glev:insulin-updated")));
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : txIe("ex_err_save"));
    } finally {
      setBusy(false);
    }
  }

  const timeChanged = createdLocal.trim() !== createdSeed.trim();

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {log.insulin_type === "bolus" ? txIe("ins_editor_title_bolus") : txIe("ins_editor_title_basal")}
        </div>
        <span style={{
          padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700,
          background:`${accent}20`, color:accent,
          border:`1px solid ${accent}40`,
          letterSpacing:"0.04em", textTransform:"uppercase",
        }}>Editor</span>
      </div>

      <div style={{ fontSize:13, color:"var(--text-dim)", lineHeight:1.5 }}>
        {txIe("ins_editor_hint")}
        {log.insulin_type === "bolus" && txIe("ins_editor_hint_bolus_time")}
      </div>

      <DateTimeField
        label={txIe("ins_editor_time_field")}
        value={createdLocal}
        onChange={setCreatedLocal}
        accent={accent}
        hint={
          timeChanged && log.insulin_type === "bolus"
            ? txIe("ins_editor_time_hint")
            : undefined
        }
      />

      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <label style={{ fontSize:13, color:"var(--text-dim)" }}>
          {txIe("ins_editor_dose_prefix")} —{" "}
          <span style={{ color:accent, fontWeight:700, fontFamily:"var(--font-mono)" }}>
            {units.toFixed(units % 1 === 0 ? 0 : 1)} U
          </span>
        </label>
        <SnapSlider
          value={units}
          onChange={(n) => setUnits(Math.round(n * 2) / 2)}
          min={0}
          max={50}
          step={0.5}
          unit="U"
          accent={accent}
          ariaLabel={txIe("ins_editor_dose_prefix")}
        />
      </div>

      <CollapsibleField label={txIe("ins_editor_insulin_name")} accent={accent} hasValue={name.trim().length > 0}>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="z.B. Novorapid, Tresiba, …"
          maxLength={80}
          style={{
            width:"100%", background:"var(--input-bg)",
            border:`1px solid ${BORDER}`, borderRadius:12,
            padding:"12px 14px", fontSize:14, color:"var(--text-strong)", outline:"none",
          }}
        />
      </CollapsibleField>

      <CollapsibleField label={txIe("ins_editor_notes")} accent={accent} hasValue={notes.trim().length > 0}>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder=""
          style={{
            width:"100%", background:"var(--input-bg)",
            border:`1px solid ${BORDER}`, borderRadius:12,
            padding:"12px 14px", fontSize:14, color:"var(--text-strong)", outline:"none",
          }}
        />
      </CollapsibleField>

      {err && (
        <div style={{ fontSize:13, color:PINK, padding:"8px 10px", background:`${PINK}10`, border:`1px solid ${PINK}30`, borderRadius:8 }}>
          {err}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, alignItems:"end" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding:"13px", borderRadius:12,
            border:`1px solid ${BORDER}`, background:"var(--surface-soft)",
            color:"var(--text-body)", fontSize:14, fontWeight:600,
            cursor:busy ? "not-allowed" : "pointer", letterSpacing:"0.02em",
            marginTop:18,
          }}
        >{txIe("ex_cancel")}</button>
        <SaveButton
          onClick={handleSave}
          disabled={busy}
          busy={busy}
          accent={accent}
          label={txIe("ex_save")}
          successKey={savedTick || null}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CycleEditor — inline editor for menstrual / cycle rows. start_date is a
// pure DATE column (no time), so a native date input is used instead of
// the datetime-local field. Bleeding rows expose flow_intensity; phase
// rows expose cycle_phase. Notes always editable.
// ─────────────────────────────────────────────────────────────────────────
function CycleEditor({ log, onSaved, onCancel }: {
  log: MenstrualLog;
  onSaved: (updated: MenstrualLog) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("engineLog");
  const tx = useTranslations("entriesExpand");
  const accent = "#FF2D78";
  const isBleeding = log.flow_intensity != null;
  const [startDate, setStartDate] = useState<string>(log.start_date);
  const [flow, setFlow] = useState<FlowIntensity | null>(log.flow_intensity);
  const [notes, setNotes] = useState<string>(log.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const minIso = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);

  async function handleSave() {
    if (busy) return;
    setErr(null);
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setErr("Datum ungültig."); return;
    }
    if (startDate > todayIso) { setErr("Datum darf nicht in der Zukunft liegen."); return; }
    setBusy(true);
    try {
      const patch: { start_date?: string; flow_intensity?: FlowIntensity | null; notes?: string | null } = {};
      if (startDate !== log.start_date) patch.start_date = startDate;
      if (isBleeding && flow !== log.flow_intensity) patch.flow_intensity = flow;
      const n = notes.trim(); const nn = n.length > 0 ? n : null;
      if (nn !== (log.notes ?? null)) patch.notes = nn;
      if (Object.keys(patch).length === 0) { setBusy(false); onCancel(); return; }
      const updated = await updateMenstrualLog(log.id, patch);
      queueMicrotask(() => window.dispatchEvent(new Event("glev:menstrual-updated")));
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : tx("ex_err_save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:11, color:"var(--text-dim)", letterSpacing:"0.1em", fontWeight:700 }}>
          {tx("cycle_editor_title")}
        </div>
        <span style={{
          padding:"4px 10px", borderRadius:99, fontSize:12, fontWeight:700,
          background:`${accent}20`, color:accent,
          border:`1px solid ${accent}40`,
          letterSpacing:"0.04em", textTransform:"uppercase",
        }}>Editor</span>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <label style={{ fontSize:13, color:"var(--text-dim)" }}>Datum</label>
        <input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          min={minIso}
          max={todayIso}
          style={{
            background:"var(--input-bg)",
            border:`1px solid ${BORDER}`, borderRadius:12,
            padding:"12px 14px", fontSize:14, fontWeight:600,
            color:"var(--text-strong)", outline:"none",
            fontFamily:"var(--font-mono)", letterSpacing:"0.01em",
            minHeight:44, colorScheme:"dark",
          }}
        />
      </div>

      {isBleeding && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <label style={{ fontSize:13, color:"var(--text-dim)" }}>Stärke</label>
          <SegmentedChoice<FlowIntensity>
            value={flow ?? "medium"}
            onChange={setFlow}
            accent={accent}
            ariaLabel="Stärke"
            options={[
              { value: "light",  label: t("cycle_flow_light") },
              { value: "medium", label: t("cycle_flow_medium") },
              { value: "heavy",  label: t("cycle_flow_heavy") },
            ]}
          />
        </div>
      )}

      <CollapsibleField label={tx("ins_editor_notes")} accent={accent} hasValue={notes.trim().length > 0}>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder=""
          style={{
            width:"100%", background:"var(--input-bg)",
            border:`1px solid ${BORDER}`, borderRadius:12,
            padding:"12px 14px", fontSize:14, color:"var(--text-strong)", outline:"none",
          }}
        />
      </CollapsibleField>

      {err && (
        <div style={{ fontSize:13, color:PINK, padding:"8px 10px", background:`${PINK}10`, border:`1px solid ${PINK}30`, borderRadius:8 }}>
          {err}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, alignItems:"end" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            padding:"13px", borderRadius:12,
            border:`1px solid ${BORDER}`, background:"var(--surface-soft)",
            color:"var(--text-body)", fontSize:14, fontWeight:600,
            cursor:busy ? "not-allowed" : "pointer", letterSpacing:"0.02em",
          }}
        >{tx("ex_cancel")}</button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          style={{
            padding:"13px", borderRadius:12, border:"none",
            background:accent, color:"#fff",
            fontSize:14, fontWeight:700, cursor:busy?"not-allowed":"pointer",
          }}
        >{busy ? tx("ex_saving") : tx("ex_save")}</button>
      </div>
    </div>
  );
}

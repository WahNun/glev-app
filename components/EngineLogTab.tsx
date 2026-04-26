"use client";

import { useState, useEffect } from "react";
import { insertInsulinLog } from "@/lib/insulin";
import { insertExerciseLog, type ExerciseType } from "@/lib/exercise";
import { exerciseTypeLabel } from "@/lib/exerciseEval";
import { scheduleJobsForLog } from "@/lib/cgmJobs";
import { fetchMeals, type Meal } from "@/lib/meals";
import { parseDbDate } from "@/lib/time";
import { isToday } from "@/lib/utils/datetime";

// Builds the dropdown label for a meal in the "Zu Mahlzeit verknüpfen"
// picker — "HH:MM — <first food name or meal_type> (Xg C)". Defensive
// against parsed_json being null / non-array / lacking a name field.
function formatMealOption(m: Meal): string {
  const t = parseDbDate(m.meal_time ?? m.created_at);
  const time = t.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const carbs = Math.round(m.carbs_grams ?? 0);
  let label: string = "Mahlzeit";
  if (Array.isArray(m.parsed_json) && m.parsed_json.length > 0) {
    const first = m.parsed_json[0] as { name?: string };
    if (typeof first?.name === "string" && first.name.trim()) label = first.name.trim();
  } else if (m.meal_type) {
    label = m.meal_type;
  }
  return `${time} — ${label} (${carbs}g C)`;
}

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const ORANGE = "#FF9500";
const PINK   = "#FF2D78";
const SURFACE = "#111117";
const BORDER  = "rgba(255,255,255,0.08)";

const inp: React.CSSProperties = {
  background: "#0D0D12",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: "11px 14px",
  color: "#fff",
  fontSize: 14,
  outline: "none",
  width: "100%",
};
const card: React.CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: "20px 24px",
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.4)",
  display: "block",
  marginBottom: 6,
};

// ── Datetime-local helpers ──────────────────────────────────────────
// `<input type="datetime-local">` works in *local* wall-clock time
// formatted as "YYYY-MM-DDTHH:mm" (no timezone). We have to convert
// to/from real Date instances ourselves so the persisted ISO string
// matches the user's intent.
function toLocalDtString(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function nowLocalDt(): string { return toLocalDtString(new Date()); }
// 365 days back — matches the spec "from past year to real time".
// Used for the input's `min` attribute so the native picker greys
// out anything older.
function oneYearAgoLocalDt(): string {
  return toLocalDtString(new Date(Date.now() - 365 * 86400_000));
}
function parseLocalDt(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
// "vor 3 Std" / "vor 2 Tagen" — short relative-time label for the
// success banner so users immediately see we honored the back-date.
function relativeAgo(deltaMs: number): string {
  if (deltaMs < 60_000)            return "gerade eben";
  const min = Math.round(deltaMs / 60_000);
  if (min < 60)                    return `vor ${min} Min`;
  const hr  = Math.round(min / 60);
  if (hr < 24)                     return `vor ${hr} Std`;
  const day = Math.round(hr / 24);
  return `vor ${day} ${day === 1 ? "Tag" : "Tagen"}`;
}

/**
 * Extract a human-readable message from anything that ended up in a
 * catch block. Real Errors hand back `.message` directly; supabase-js
 * PostgrestError / AuthError values are plain objects with the same
 * `.message` shape but fail `instanceof Error`, so we have to dig
 * manually. Falls back to "Unbekannter Fehler" only when the throw
 * had no usable text at all.
 */
function extractErrMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts: string[] = [];
    if (typeof o.message === "string" && o.message.trim()) parts.push(o.message.trim());
    if (typeof o.details === "string" && o.details.trim()) parts.push(o.details.trim());
    if (typeof o.hint    === "string" && o.hint.trim())    parts.push(o.hint.trim());
    if (typeof o.code    === "string" && o.code.trim())    parts.push(`[${o.code.trim()}]`);
    if (parts.length) return parts.join(" — ");
  }
  if (typeof e === "string" && e.trim()) return e.trim();
  return "Unbekannter Fehler";
}

/** Pull current CGM reading; null on any failure (network, no LLU, 401). */
async function pullCurrentCgm(): Promise<number | null> {
  try {
    const r = await fetch("/api/cgm/latest", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.current?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Inline Bolus/Basal toggle. */
function Segmented<T extends string>({
  value, options, onChange, accent,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  accent: string;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${options.length},1fr)`,
      gap: 6,
      background: "#0D0D12",
      border: `1px solid ${BORDER}`,
      borderRadius: 12,
      padding: 4,
    }}>
      {options.map(opt => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: on ? `${accent}22` : "transparent",
              color: on ? accent : "rgba(255,255,255,0.55)",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

function StatusBanner({ status, accent }: { status: Status; accent: string }) {
  if (status.kind === "idle") return null;
  if (status.kind === "submitting") {
    return (
      <div style={{
        marginTop: 14, padding: "10px 14px",
        background: "rgba(255,255,255,0.04)", borderRadius: 10,
        fontSize: 12, color: "rgba(255,255,255,0.55)",
      }}>
        Wird gespeichert…
      </div>
    );
  }
  if (status.kind === "ok") {
    return (
      <div style={{
        marginTop: 14, padding: "12px 14px",
        background: `${accent}14`, border: `1px solid ${accent}33`, borderRadius: 10,
        fontSize: 13, color: accent, fontWeight: 600,
      }}>
        {status.message}
      </div>
    );
  }
  return (
    <div style={{
      marginTop: 14, padding: "12px 14px",
      background: `${PINK}14`, border: `1px solid ${PINK}33`, borderRadius: 10,
      fontSize: 13, color: PINK, fontWeight: 600,
    }}>
      {status.message}
    </div>
  );
}

export function InsulinForm() {
  const [type, setType] = useState<"bolus" | "basal">("bolus");
  const [name, setName] = useState("");
  const [units, setUnits] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Injection time picker — defaults to "now" for live submissions.
  // Users can back-date up to 365 days for forgotten / retroactive
  // shots. Stored as the datetime-local string format ("YYYY-MM-DDTHH:mm")
  // and converted to a real ISO instant in handleSubmit.
  const [at, setAt] = useState<string>(() => nowLocalDt());
  // Today's meals, newest first, capped at 10 — feeds the optional
  // "Zu Mahlzeit verknüpfen" dropdown that only renders for bolus entries.
  // Refetched whenever the user toggles to bolus so a meal logged in
  // another tab/session shows up without a full reload.
  const [todayMeals, setTodayMeals] = useState<Meal[]>([]);
  const [relatedMealId, setRelatedMealId] = useState<string>("");

  useEffect(() => {
    if (type !== "bolus") return;
    let cancelled = false;
    fetchMeals().then(all => {
      if (cancelled) return;
      const todays = all
        .filter(m => isToday(m.meal_time ?? m.created_at ?? ""))
        .sort((a, b) => parseDbDate(b.meal_time ?? b.created_at).getTime() - parseDbDate(a.meal_time ?? a.created_at).getTime())
        .slice(0, 10);
      setTodayMeals(todays);
    }).catch(() => { /* dropdown silently empty if fetch fails */ });
    return () => { cancelled = true; };
  }, [type]);

  const placeholder = type === "bolus" ? "Fiasp" : "Tresiba";
  const u = parseFloat(units);
  const atDate = parseLocalDt(at);
  // Validate the picker too — invalid date OR more than 365 days back
  // OR > 1 minute in the future (small grace window for clock drift)
  // disables the submit button.
  const nowMs = Date.now();
  const atValid = !!atDate && atDate.getTime() >= nowMs - 365 * 86400_000 && atDate.getTime() <= nowMs + 60_000;
  const valid = type && name.trim().length > 0 && Number.isFinite(u) && u > 0 && u <= 100 && atValid;

  async function handleSubmit() {
    if (!valid || !atDate) return;
    setStatus({ kind: "submitting" });
    // Treat anything older than 5 minutes as a back-dated entry: the
    // current CGM reading would be wrong by ≥ that delta, so we leave
    // cgm_glucose_at_log NULL and let the scheduler fill it from CGM
    // history at the actual injection instant. Mirrors the Exercise
    // form's retroactive pattern.
    const deltaMs = nowMs - atDate.getTime();
    const isRetro = deltaMs > 5 * 60_000;
    const cgm = isRetro ? null : await pullCurrentCgm();
    const atIso = atDate.toISOString();
    try {
      const inserted = await insertInsulinLog({
        insulin_type: type,
        insulin_name: name.trim(),
        units: u,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
        // Only persisted for bolus entries (insertInsulinLog drops it for
        // basal even if set, but we also clear the UI on type=basal).
        related_entry_id: type === "bolus" && relatedMealId ? relatedMealId : null,
        // Override created_at when the picker isn't "now" — passed
        // unconditionally because lib/insulin.ts only writes it when
        // truthy and the live default still ends up within the same
        // second the DB would otherwise have used.
        at: atIso,
      });
      // Schedule post-fetches relative to the chosen injection time
      // (not "now") so back-dated bolus +2h / basal +24h fetches can
      // resolve immediately from CGM history. Falls back to the chosen
      // instant if the row didn't echo created_at for some reason.
      const ref = inserted?.created_at || atIso;
      void scheduleJobsForLog({
        logId: inserted.id,
        logType: type,
        refTimeIso: ref,
      });
      const typeLabel = type === "bolus" ? "Bolus" : "Basal";
      const whenLabel = isRetro ? ` (${relativeAgo(deltaMs)})` : "";
      setStatus({
        kind: "ok",
        message: cgm != null
          ? `Geloggt — ${u}u ${typeLabel} (${name.trim()})${whenLabel} bei ${Math.round(cgm)} mg/dL.`
          : `Geloggt — ${u}u ${typeLabel} (${name.trim()})${whenLabel}. Kein CGM-Wert verfügbar.`,
      });
      setUnits("");
      setNotes("");
      setRelatedMealId("");
      // Reset the picker to a fresh "now" so the next log doesn't
      // silently inherit the previous back-date.
      setAt(nowLocalDt());
    } catch (e) {
      // Defensive: lib functions SHOULD wrap supabase errors in Error
      // (see lib/insulin.ts), but PostgrestError / AuthError are plain
      // objects with a `.message` field — extract it manually so a
      // missed wrap somewhere upstream doesn't degrade to the generic
      // "Unbekannter Fehler" fallback.
      const msg = extractErrMessage(e);
      setStatus({ kind: "error", message: `Speichern fehlgeschlagen: ${msg}` });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${GREEN}20`, border: `1px solid ${GREEN}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 2v20M2 12h20" />
          </svg>
        </span>
        Insulin loggen
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>Typ</label>
          <Segmented<"bolus" | "basal">
            value={type}
            onChange={setType}
            accent={GREEN}
            options={[
              { value: "bolus", label: "Bolus" },
              { value: "basal", label: "Basal" },
            ]}
          />
        </div>
        <div>
          <label style={labelStyle}>Insulin-Name</label>
          <input
            style={inp}
            placeholder={placeholder}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Einheiten</label>
          <input
            style={inp}
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0.5"
            max="100"
            placeholder="z.B. 6"
            value={units}
            onChange={e => setUnits(e.target.value)}
          />
        </div>
        <div>
          {/* Injection time picker — both Bolus and Basal can be back-dated
              up to 365 days for forgotten / retroactive shots. Native
              datetime-local picker handles date AND time in one widget.
              Defaults to "now". When the chosen time is > 5 min in the
              past, handleSubmit skips the live CGM pull and lets the
              scheduler fill from history (mirrors the Exercise form). */}
          <label style={labelStyle}>Zeitpunkt</label>
          <input
            style={inp}
            type="datetime-local"
            value={at}
            min={oneYearAgoLocalDt()}
            max={nowLocalDt()}
            onChange={e => setAt(e.target.value)}
          />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
            {atDate && nowMs - atDate.getTime() > 5 * 60_000
              ? `Rückdatiert — ${relativeAgo(nowMs - atDate.getTime())}. Kein Live-CGM, Werte werden aus dem Verlauf geholt.`
              : "Standard: jetzt. Bis zu 365 Tage rückdatierbar."}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Notiz (optional)</label>
          <input
            style={inp}
            placeholder="z.B. vor Mahlzeit, Korrektur, …"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
        {/* Bolus-only: explicit link to a meal logged today. Engine ICR
            pairing prefers this over the ±30min time-window heuristic.
            Hidden for basal because basal isn't dosed against a meal. */}
        {type === "bolus" && (
          <div>
            <label style={labelStyle}>Zu Mahlzeit verknüpfen (optional)</label>
            <select
              style={{ ...inp, appearance: "none", WebkitAppearance: "none", cursor: todayMeals.length ? "pointer" : "default" }}
              value={relatedMealId}
              onChange={e => setRelatedMealId(e.target.value)}
              disabled={todayMeals.length === 0}
            >
              <option value="">— keine Verknüpfung —</option>
              {todayMeals.map(m => (
                <option key={m.id} value={m.id}>{formatMealOption(m)}</option>
              ))}
            </select>
            {todayMeals.length === 0 ? (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
                Heute noch keine Mahlzeiten geloggt.
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
                Heute geloggte Mahlzeiten (max. 10, neueste zuerst).
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!valid || status.kind === "submitting"}
        style={{
          marginTop: 18, width: "100%", padding: "13px",
          borderRadius: 12, border: "none",
          background: valid ? GREEN : "rgba(255,255,255,0.05)",
          color: valid ? "#0A0A0E" : "rgba(255,255,255,0.25)",
          fontSize: 14, fontWeight: 800,
          cursor: valid ? "pointer" : "not-allowed",
          transition: "all 0.15s",
        }}
      >
        Log Insulin
      </button>

      <StatusBanner status={status} accent={GREEN} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "rgba(255,255,255,0.03)", borderRadius: 10,
        fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5,
      }}>
        Glev rechnet keine Dosen — du gibst ein, was du gespritzt hast. Der CGM-Wert wird beim Absenden automatisch gezogen.
      </div>
    </div>
  );
}

// New exercise taxonomy used by the form. Legacy `hypertrophy` rows
// remain valid in the DB and are mapped to "Strength" for display, but
// the picker only shows the new set so going forward all rows use it.
const EXERCISE_TYPE_OPTIONS: ExerciseType[] = ["cardio", "strength", "hiit", "yoga", "cycling", "run"];

// Retroactive-start choices. Selecting anything other than "Now"
// shifts the reference time the CGM scheduler uses to compute the
// at-end and +1h fetches, so workouts that already ended can still
// be evaluated from CGM history. Capped at 3 h to match the process
// route's exercise abandon window.
const STARTED_OPTIONS: { value: number; label: string }[] = [
  { value: 0,   label: "Now" },
  { value: 30,  label: "30m" },
  { value: 60,  label: "1h" },
  { value: 120, label: "2h" },
  { value: 180, label: "3h" },
];

export function ExerciseForm() {
  const [type, setType] = useState<ExerciseType>("cardio");
  const [startedMinAgo, setStartedMinAgo] = useState<number>(0);
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState<"low" | "medium" | "high">("medium");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const d = parseInt(duration, 10);
  const valid = Number.isFinite(d) && d > 0 && d <= 600;

  // Compute the actual workout start instant for the submit confirmation
  // and the CGM scheduler. For "Now" this equals submit time.
  function computeStartIso(): string {
    return new Date(Date.now() - startedMinAgo * 60_000).toISOString();
  }

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    const isRetro = startedMinAgo > 0;
    // For live ("Now") submissions, anchor on the live CGM reading.
    // For retroactive submissions, leave the baseline NULL so the
    // scheduler fills it from CGM history at the actual start instant
    // (current value would otherwise be wrong by ≥ startedMinAgo).
    const cgm = isRetro ? null : await pullCurrentCgm();
    try {
      const refIso = computeStartIso();
      const insertedEx = await insertExerciseLog({
        exercise_type: type,
        duration_minutes: d,
        intensity,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
        // Only override created_at for retroactive logs — live
        // submissions keep the DB default `now()`.
        start_at: isRetro ? refIso : undefined,
      });
      // Schedule post-fetches: at workout end (start + duration), and
      // +1h after end. For retroactive logs, refTime is shifted into
      // the past so the at-end fetch can resolve immediately from CGM
      // history.
      void scheduleJobsForLog({
        logId: insertedEx.id,
        logType: "exercise",
        refTimeIso: refIso,
        durationMinutes: d,
      });
      const typeLabel = exerciseTypeLabel(type);
      const startedLabel = startedMinAgo === 0
        ? ""
        : ` (gestartet vor ${STARTED_OPTIONS.find(o => o.value === startedMinAgo)?.label})`;
      // Map the stored intensity token to the spec wording for display.
      const intensityLabel = intensity === "medium" ? "moderate" : intensity;
      setStatus({
        kind: "ok",
        message: cgm != null
          ? `Geloggt — ${d} min ${typeLabel} (${intensityLabel})${startedLabel} bei ${Math.round(cgm)} mg/dL.`
          : `Geloggt — ${d} min ${typeLabel} (${intensityLabel})${startedLabel}. Kein CGM-Wert verfügbar.`,
      });
      setDuration("");
      setNotes("");
      setStartedMinAgo(0);
    } catch (e) {
      // See InsulinForm above — extract `.message` from PostgrestError-
      // like plain objects so the banner shows the real cause.
      const msg = extractErrMessage(e);
      setStatus({ kind: "error", message: `Speichern fehlgeschlagen: ${msg}` });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${ORANGE}20`, border: `1px solid ${ORANGE}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.5 6.5l11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7" />
          </svg>
        </span>
        Exercise loggen
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>Typ</label>
          {/* 6 options — too wide for one row of equal columns on
              narrow viewports. We render a 3-col grid that wraps to
              2 rows; each cell is its own toggle button. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
            background: "#0D0D12",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 4,
          }}>
            {EXERCISE_TYPE_OPTIONS.map(opt => {
              const on = opt === type;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setType(opt)}
                  style={{
                    padding: "9px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: on ? `${ORANGE}22` : "transparent",
                    color: on ? ORANGE : "rgba(255,255,255,0.55)",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {exerciseTypeLabel(opt)}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Gestartet</label>
          {/* Retroactive start picker — shifts the CGM scheduler's
              reference time so a workout already finished can still
              be evaluated from CGM history within the 3 h window. */}
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${STARTED_OPTIONS.length}, 1fr)`,
            gap: 6,
            background: "#0D0D12",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 4,
          }}>
            {STARTED_OPTIONS.map(opt => {
              const on = opt.value === startedMinAgo;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStartedMinAgo(opt.value)}
                  style={{
                    padding: "9px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: on ? `${ORANGE}22` : "transparent",
                    color: on ? ORANGE : "rgba(255,255,255,0.55)",
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {opt.value === 0 ? "Jetzt" : `vor ${opt.label}`}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Dauer (Minuten)</label>
          <input
            style={inp}
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            max="600"
            placeholder="z.B. 45"
            value={duration}
            onChange={e => setDuration(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Intensität</label>
          {/* DB stores the legacy `medium` token (matches the existing
              CHECK constraint on insulin_logs/exercise_logs); the
              user-facing label reads "Moderate" per spec. */}
          <Segmented<"low" | "medium" | "high">
            value={intensity}
            onChange={setIntensity}
            accent={ORANGE}
            options={[
              { value: "low",    label: "Low" },
              { value: "medium", label: "Moderate" },
              { value: "high",   label: "High" },
            ]}
          />
        </div>
        <div>
          <label style={labelStyle}>Notiz (optional)</label>
          <input
            style={inp}
            placeholder="z.B. Beine, Intervalle, …"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!valid || status.kind === "submitting"}
        style={{
          marginTop: 18, width: "100%", padding: "13px",
          borderRadius: 12, border: "none",
          background: valid ? ORANGE : "rgba(255,255,255,0.05)",
          color: valid ? "#0A0A0E" : "rgba(255,255,255,0.25)",
          fontSize: 14, fontWeight: 800,
          cursor: valid ? "pointer" : "not-allowed",
          transition: "all 0.15s",
        }}
      >
        Log Exercise
      </button>

      <StatusBanner status={status} accent={ORANGE} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "rgba(255,255,255,0.03)", borderRadius: 10,
        fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5,
      }}>
        Der CGM-Wert beim Loggen hilft Glev, Bewegung mit Glukose-Reaktionen zu verknüpfen.
      </div>
    </div>
  );
}

export default function EngineLogTab() {
  return (
    <div>
      <style>{`
        @media (max-width: 720px) {
          .glev-log-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div
        className="glev-log-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}
      >
        <InsulinForm />
        <ExerciseForm />
      </div>

      {/* Manual fingerstick capture lives now as its own top-level tab
          ("FS Glucose") on the engine screen — no longer rendered here to
          avoid duplication. */}

      <div style={{
        marginTop: 20, padding: "14px 18px",
        background: "rgba(255,255,255,0.03)", borderRadius: 12, border: `1px solid ${BORDER}`,
      }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
          <strong style={{ color: "rgba(255,255,255,0.4)" }}>Hinweis:</strong> Insulin- und
          Exercise-Logs sind reine Dokumentation. Glev berechnet keine Dosen und gibt
          keine Empfehlungen zur Insulingabe — das ist Sache deines Diabetes-Teams.
        </div>
      </div>

      {/* keep ACCENT in scope for future tab additions without lint warnings */}
      <span style={{ display: "none", color: ACCENT }} />
    </div>
  );
}

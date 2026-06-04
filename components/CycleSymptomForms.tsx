"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  insertMenstrualLog,
  CYCLE_PHASES,
  type FlowIntensity,
  type CyclePhase,
} from "@/lib/menstrual";
import {
  insertSymptomLog,
  SYMPTOM_TYPES,
  PMS_SYMPTOM_TYPES,
  avgSeverity,
  type SymptomType,
  type SymptomCategory,
  type SeveritiesMap,
  type SeverityValue,
} from "@/lib/symptoms";
import { hapticSelection, hapticSuccess, hapticError } from "@/lib/haptics";
import SnapSlider from "@/components/log/SnapSlider";
import CollapsibleField from "@/components/log/CollapsibleField";
import SaveButton from "@/components/log/SaveButton";
import { fetchUserProfile, cycleSurfacesAvailable, type Sex } from "@/lib/userProfile";

const PINK   = "#FF2D78";
const PURPLE = "#A78BFA";
const BORDER = "var(--border)";
const SURFACE = "var(--surface)";

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
  padding: "11px 14px",
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
  width: "100%",
};
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-dim)",
  display: "block",
  marginBottom: 6,
};

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
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 13, color: "var(--text-muted)",
      }}>…</div>
    );
  }
  const isOk = status.kind === "ok";
  const color = isOk ? accent : "#FF2D78";
  return (
    <div style={{
      marginTop: 14, padding: "12px 14px",
      background: `${color}14`, border: `1px solid ${color}33`, borderRadius: 10,
      fontSize: 14, color, fontWeight: 600,
    }}>
      {status.message}
    </div>
  );
}

function todayDate(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}
function nowLocalDt(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** Pull the freshest live CGM reading; null on any failure (no CGM
 *  connected, network error, 401). Mirrors the same helper used by
 *  the Insulin/Exercise forms so all three log types snapshot glucose
 *  the same way. */
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

function PillRow<T extends string>({
  value, options, onChange, accent,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T | null) => void;
  accent: string;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: 6,
      background: "var(--input-bg)",
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
            onClick={() => {
              hapticSelection();
              onChange(on ? null : opt.value);
            }}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: on ? `${accent}22` : "transparent",
              color: on ? accent : "var(--text-muted)",
              fontSize: 14,
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

export function CycleForm() {
  const t = useTranslations("engineLog");
  // Two distinct event modes — bleeding (with optional end-date and a
  // required flow intensity) or a single-day phase marker. The DB
  // CHECK constraint only requires *one* of flow_intensity / phase_marker
  // to be non-null, so the toggle prevents ambiguous mixed entries
  // and keeps the form simple to reason about.
  const [mode, setMode] = useState<"bleeding" | "marker">("bleeding");
  const [start, setStart] = useState<string>(() => todayDate());
  const [end, setEnd] = useState<string>("");
  const [flow, setFlow] = useState<FlowIntensity | null>("medium");
  // Refactored from the legacy 3-marker PhaseMarker (ovulation/pms/other)
  // to the standard 4-phase enum. PMS is now a symptom category, "Andere"
  // was removed by spec. Mode key stays "marker" for UX continuity.
  const [phase, setPhase] = useState<CyclePhase | null>("ovulation");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [savedTick, setSavedTick] = useState<number>(0);

  // AI pre-fill: read glev_pending_cycle from sessionStorage on mount,
  // then listen for glev:open-cycle-log dispatched by navigateToLogScreen.
  // The payload shape mirrors the log_cycle_entry tool params:
  //   { start_date, end_date?, flow_intensity?, phase_marker?, notes? }
  // phase_marker "ovulation" maps to CyclePhase; "pms"/"other" leave phase
  // at its default (user picks manually). Clears sessionStorage after reading.
  useEffect(() => {
    function applyPayload(raw: unknown) {
      if (!raw || typeof raw !== "object") return;
      const p = raw as Record<string, unknown>;
      const startDate = typeof p.start_date === "string" ? p.start_date : null;
      const flowIntensity = typeof p.flow_intensity === "string" ? p.flow_intensity : null;
      const phaseMarker = typeof p.phase_marker === "string" ? p.phase_marker : null;
      const endDate = typeof p.end_date === "string" && p.end_date ? p.end_date : null;
      const notesVal = typeof p.notes === "string" && p.notes ? p.notes : null;

      if (flowIntensity && ["light", "medium", "heavy"].includes(flowIntensity)) {
        setMode("bleeding");
        setFlow(flowIntensity as FlowIntensity);
      } else if (phaseMarker) {
        setMode("marker");
        // Only "ovulation" maps to a CyclePhase directly.
        // "pms" / "other" leave the phase picker at its current default.
        if (phaseMarker === "ovulation") setPhase("ovulation");
      }
      if (startDate) setStart(startDate);
      if (endDate) setEnd(endDate);
      if (notesVal) setNotes(notesVal);
    }

    // On mount: check sessionStorage for a pending pre-fill written by
    // navigateToLogScreen before navigating to this screen.
    if (typeof window !== "undefined") {
      const raw = window.sessionStorage.getItem("glev_pending_cycle");
      if (raw) {
        try { applyPayload(JSON.parse(raw)); } catch { /* ignore parse errors */ }
        try { window.sessionStorage.removeItem("glev_pending_cycle"); } catch {}
      }
    }

    const handler = (e: Event) => {
      applyPayload((e as CustomEvent).detail);
    };
    window.addEventListener("glev:open-cycle-log", handler);
    return () => window.removeEventListener("glev:open-cycle-log", handler);
  }, []);

  const valid = (() => {
    if (!start) return false;
    if (mode === "bleeding") {
      if (!flow) return false;
      if (end && end < start) return false;
      return true;
    }
    return phase != null;
  })();

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    try {
      await insertMenstrualLog({
        start_date: start,
        end_date: mode === "bleeding" && end ? end : null,
        flow_intensity: mode === "bleeding" ? flow : null,
        cycle_phase: mode === "marker" ? phase : null,
        notes: notes.trim() || null,
      });
      setSavedTick(n => n + 1);
      hapticSuccess();
      setStatus({
        kind: "ok",
        message: mode === "bleeding"
          ? t("cycle_logged_bleeding", { date: start, flow: flow ? t(`cycle_flow_${flow}` as never) : "" })
          : t("cycle_logged_phase", { date: start, phase: phase ? t(`cycle_phase_${phase}` as never) : "" }),
      });
      setNotes("");
      setEnd("");
      // Tell other surfaces (entries page, insights) to refetch.
      try { window.dispatchEvent(new CustomEvent("glev:menstrual-updated")); } catch {}
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      hapticError();
      setStatus({ kind: "error", message: t("save_failed_prefix", { message: msg }) });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${PINK}20`, border: `1px solid ${PINK}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: PINK, fontSize: 13,
        }}>♀</span>
        {t("cycle_card_title")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>{t("cycle_mode_label")}</label>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            background: "var(--input-bg)",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 4,
          }}>
            {(["bleeding", "marker"] as const).map(m => {
              const on = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    if (!on) hapticSelection();
                    setMode(m);
                  }}
                  style={{
                    padding: "9px 10px", borderRadius: 8, border: "none",
                    background: on ? `${PINK}22` : "transparent",
                    color: on ? PINK : "var(--text-muted)",
                    fontSize: 14, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {t(`cycle_mode_${m}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={labelStyle}>
            {mode === "bleeding" ? t("cycle_start_label") : t("cycle_marker_date_label")}
          </label>
          <input
            style={inp}
            type="date"
            value={start}
            max={todayDate()}
            onChange={e => setStart(e.target.value)}
          />
        </div>

        {mode === "bleeding" && (
          <>
            <div>
              <label style={labelStyle}>{t("cycle_end_label")}</label>
              <input
                style={inp}
                type="date"
                value={end}
                min={start || undefined}
                max={todayDate()}
                onChange={e => setEnd(e.target.value)}
              />
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>
                {t("cycle_end_hint")}
              </div>
            </div>
            <div>
              {/* 1-5 slider mapped onto the light/medium/heavy DB enum. */}
              <label style={labelStyle}>
                {t("cycle_flow_label")} —{" "}
                <span style={{ color: PINK, fontWeight: 700 }}>
                  {flow === "light" ? t("cycle_flow_light")
                    : flow === "heavy" ? t("cycle_flow_heavy")
                    : t("cycle_flow_medium")}
                </span>
              </label>
              <SnapSlider
                value={flow === "light" ? 2 : flow === "heavy" ? 4 : 3}
                onChange={(n) =>
                  setFlow(n <= 2 ? "light" : n >= 4 ? "heavy" : "medium")
                }
                min={1}
                max={5}
                step={1}
                accent={PINK}
                ariaLabel={t("cycle_flow_label")}
              />
            </div>
          </>
        )}

        {mode === "marker" && (
          <div>
            <label style={labelStyle}>{t("cycle_phase_label")}</label>
            {/* Native select — viel ehrlicher als ein 4-spaltiger
                PillRow, dessen Labels (Lutealphase, Menstruation)
                auf schmalen Screens abgeschnitten wurden. Der
                System-Picker auf iOS/Android handhabt Overflow,
                Accessibility und Tastatur-Navigation gratis. */}
            <div style={{ position: "relative" }}>
              <select
                value={phase ?? ""}
                onChange={(e) => {
                  hapticSelection();
                  const v = e.target.value;
                  setPhase(v === "" ? null : (v as CyclePhase));
                }}
                aria-label={t("cycle_phase_label")}
                style={{
                  ...inp,
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  paddingRight: 36,
                  cursor: "pointer",
                  fontWeight: 600,
                  color: phase ? PINK : "var(--text-muted)",
                }}
              >
                <option value="" disabled>
                  {t("cycle_phase_label")}
                </option>
                {CYCLE_PHASES.map((p) => (
                  <option key={p} value={p}>
                    {t(`cycle_phase_${p}` as never)}
                  </option>
                ))}
              </select>
              <svg
                width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
                style={{
                  position: "absolute", right: 14, top: "50%",
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                  color: "var(--text-muted)",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        )}

        <CollapsibleField
          label={t("note_collapse_label")}
          accent={PINK}
          hasValue={notes.trim().length > 0}
        >
          <input
            style={inp}
            placeholder={t("cycle_note_placeholder")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={300}
          />
        </CollapsibleField>
      </div>

      <SaveButton
        onClick={handleSubmit}
        disabled={!valid}
        busy={status.kind === "submitting"}
        accent={PINK}
        label={t("cycle_save_btn")}
        successKey={savedTick || null}
      />

      <StatusBanner status={status} accent={PINK} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("cycle_disclaimer")}
      </div>
    </div>
  );
}

export function SymptomForm() {
  const t = useTranslations("engineLog");
  const router = useRouter();
  // Holds the post-save auto-redirect timer so we can cancel it on
  // unmount (e.g. user taps a bottom-nav tab during the 1.1s delay)
  // and avoid yanking them to /entries after they already navigated
  // somewhere else. Architect flagged the unmanaged setTimeout as a
  // race-condition regression — this ref is the fix.
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
  }, []);
  const [selected, setSelected] = useState<Set<SymptomType>>(new Set());
  // Per-symptom severity map. Each selected chip gets its own 1..5
  // value (default 3 on first toggle-on). When a chip is toggled off
  // we drop the key so the map mirrors `selected` exactly — that's
  // what the API/DB constraint expects.
  const [severities, setSeverities] = useState<SeveritiesMap>({});
  const [occurredAt, setOccurredAt] = useState<string>(() => nowLocalDt());

  // Voice-intent pre-fill: glev:open-symptom-log dispatched by useVoiceIntents
  // when the classifier recognises a symptom utterance (e.g. "Ich fühle mich
  // hypoglykämisch"). Pre-selects matching symptom chips and sets default
  // severities — user still confirms with "Speichern" (compliance gate D-003).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ symptom_types?: string[] }>).detail;
      if (!Array.isArray(detail?.symptom_types)) return;
      const incoming = detail.symptom_types.filter(
        (s): s is SymptomType => SYMPTOM_TYPES.includes(s as SymptomType),
      );
      if (incoming.length === 0) return;
      setSelected(new Set(incoming));
      setSeverities(
        Object.fromEntries(incoming.map((s) => [s, 3 as const])) as SeveritiesMap,
      );
    };
    window.addEventListener("glev:open-symptom-log", handler);
    return () => window.removeEventListener("glev:open-symptom-log", handler);
  }, []);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [savedTick, setSavedTick] = useState<number>(0);
  // General body symptoms vs. curated PMS / cycle-related subset.
  // The PMS chip list (PMS_SYMPTOM_TYPES) is a strict subset of the
  // full vocabulary so a user-selected token is always representable
  // in either bucket — but switching categories still clears the
  // selection so chips never end up "selected but invisible" after
  // the visible chip list shrinks.
  const [category, setCategory] = useState<SymptomCategory>("general");
  // Biological sex gates the PMS / cycle category. Male users never see
  // the toggle and stay locked on "general"; null is treated as "show
  // everything" so pre-onboarding users aren't worse off. Same source of
  // truth (`fetchUserProfile`) as the Insights cycle card.
  const [sex, setSex] = useState<Sex | null>(null);
  useEffect(() => {
    fetchUserProfile().then((p) => setSex(p.sex)).catch(() => {});
  }, []);
  const showCycleCategory = cycleSurfacesAvailable(sex);
  // If the profile resolves to male after the user already opened the
  // PMS tab, force them back to "general" so they can't end up logging
  // a hidden category.
  useEffect(() => {
    if (!showCycleCategory && category === "pms") setCategory("general");
  }, [showCycleCategory, category]);
  const chipTypes: readonly SymptomType[] =
    category === "pms" ? PMS_SYMPTOM_TYPES : SYMPTOM_TYPES;

  const switchCategory = (c: SymptomCategory) => {
    if (c === category) return;
    hapticSelection();
    setCategory(c);
    setSelected(new Set());
    setSeverities({});
  };

  const toggle = (s: SymptomType) => {
    hapticSelection();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
    setSeverities(prev => {
      const next = { ...prev };
      if (next[s] != null) {
        delete next[s];
      } else {
        next[s] = 3;
      }
      return next;
    });
  };

  const setSymptomSeverity = (s: SymptomType, v: SeverityValue) => {
    hapticSelection();
    setSeverities(prev => ({ ...prev, [s]: v }));
  };

  // Every selected chip must have a 1..5 entry. Toggling logic above
  // keeps the two in sync; this is a defensive belt-and-suspenders
  // check so a bad state can never reach the API.
  const severitiesComplete = Array.from(selected).every(
    s => typeof severities[s] === "number",
  );
  const valid = selected.size > 0 && severitiesComplete && !!occurredAt;

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    try {
      const occurredIso = new Date(occurredAt).toISOString();
      // Snapshot the live CGM only when the symptom was logged ~now.
      // For retroactive entries the live reading would be wrong by
      // however far back occurred_at sits, so leave it null rather
      // than store a misleading value. ±5 min tolerance matches the
      // ManualEntryModal's "now window" so a user nudging the time
      // picker by a couple minutes still gets the snapshot.
      const NOW_WINDOW_MS = 5 * 60 * 1000;
      const isNow = Math.abs(Date.now() - new Date(occurredAt).getTime()) <= NOW_WINDOW_MS;
      const cgm = isNow ? await pullCurrentCgm() : null;
      const types = Array.from(selected);
      // Build a clean severities map containing ONLY the selected
      // types — even though toggle() keeps them in sync, an extra
      // pass here makes the payload bulletproof against future state
      // drift (e.g. if a future feature mutates one without the other).
      const cleanSeverities: SeveritiesMap = {};
      for (const tk of types) {
        const v = severities[tk];
        cleanSeverities[tk] = (typeof v === "number" ? v : 3) as SeverityValue;
      }
      await insertSymptomLog({
        symptom_types: types,
        severities: cleanSeverities,
        occurred_at: occurredIso,
        cgm_glucose_at_log: cgm,
        category,
        notes: notes.trim() || null,
      });
      hapticSuccess();
      setSavedTick(n => n + 1);
      // PMS-tagged saves get a distinct toast so the user sees the
      // category landed correctly without having to inspect the row.
      const isPms = category === "pms";
      const okKey = cgm != null
        ? (isPms ? "symptom_logged_pms_ok_with_cgm" : "symptom_logged_ok_with_cgm")
        : (isPms ? "symptom_logged_pms_ok" : "symptom_logged_ok");
      // Toast still shows ONE severity number for compactness — use
      // the rounded mean across all per-symptom values.
      const avgSev = avgSeverity({ severities: cleanSeverities }) ?? 3;
      setStatus({
        kind: "ok",
        message: cgm != null
          ? t(okKey, { count: types.length, severity: avgSev, cgm: Math.round(cgm) })
          : t(okKey, { count: types.length, severity: avgSev }),
      });
      setSelected(new Set());
      setSeverities({});
      setNotes("");
      setOccurredAt(nowLocalDt());
      try { window.dispatchEvent(new CustomEvent("glev:symptom-updated")); } catch {}
      // After a successful symptom log, auto-redirect to /entries so
      // the user sees their fresh entry in the timeline (2026-05-17
      // user request: "wenn ich gerade ein symptom geloggt habe sollte
      // ich eigentlich direkt zum entries screen weitergeleitet werden
      // kurz nach der erfolgsbestätigung"). 1100 ms gives the success
      // banner + SaveButton tick animation time to register; longer
      // delays felt like the form was stuck. Timer id is tracked in
      // redirectTimerRef so the unmount effect can cancel it if the
      // user navigates away first (footer-nav tap during the delay).
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = setTimeout(() => {
        redirectTimerRef.current = null;
        try { router.push("/entries"); } catch {}
      }, 1100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      hapticError();
      setStatus({ kind: "error", message: t("save_failed_prefix", { message: msg }) });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${PURPLE}20`, border: `1px solid ${PURPLE}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: PURPLE, fontSize: 13, fontWeight: 800,
        }}>★</span>
        {t("symptom_card_title")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {showCycleCategory && (
          <div>
            <label style={labelStyle}>{t("symptom_category_label")}</label>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              background: "var(--input-bg)",
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 4,
            }}>
              {(["general", "pms"] as const).map(c => {
                const on = c === category;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => switchCategory(c)}
                    style={{
                      padding: "9px 10px", borderRadius: 8, border: "none",
                      background: on ? `${PURPLE}22` : "transparent",
                      color: on ? PURPLE : "var(--text-muted)",
                      fontSize: 14, fontWeight: 700, cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {t(`symptom_category_${c}` as never)}
                  </button>
                );
              })}
            </div>
            {category === "pms" && (
              <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>
                {t("symptom_category_pms_hint")}
              </div>
            )}
          </div>
        )}

        <div>
          <label style={labelStyle}>{t("symptom_select_label")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {chipTypes.map(s => {
              const on = selected.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 99,
                    border: `1px solid ${on ? PURPLE : "var(--border)"}`,
                    background: on ? `${PURPLE}22` : "var(--input-bg)",
                    color: on ? PURPLE : "var(--text-muted)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  {t(`symptom_${s}` as never)}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>
            {t("symptom_select_hint")}
          </div>
        </div>

        {selected.size > 0 && (
          <div>
            <label style={labelStyle}>{t("symptom_severity_per_chip_label")}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Array.from(selected).map(s => {
                const v = (severities[s] ?? 3) as SeverityValue;
                return (
                  <div key={s} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: "var(--input-bg)", border: `1px solid ${BORDER}`,
                    borderRadius: 10, padding: "8px 10px",
                  }}>
                    <div style={{
                      flex: "1 1 auto", minWidth: 0,
                      fontSize: 13, fontWeight: 600, color: PURPLE,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {t(`symptom_${s}` as never)}
                    </div>
                    <div
                      role="radiogroup"
                      aria-label={t(`symptom_${s}` as never)}
                      style={{ display: "flex", gap: 4, flex: "0 0 auto" }}
                    >
                      {([1, 2, 3, 4, 5] as const).map(n => {
                        const on = n === v;
                        return (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setSymptomSeverity(s, n)}
                            style={{
                              width: 32, height: 32, borderRadius: 8,
                              background: on ? `${PURPLE}22` : "transparent",
                              color: on ? PURPLE : "var(--text-muted)",
                              border: `1px solid ${on ? `${PURPLE}50` : BORDER}`,
                              fontSize: 13, fontWeight: 700, cursor: "pointer",
                              fontFamily: "var(--font-mono)",
                              padding: 0,
                            }}
                          >{n}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between",
              fontSize: 12, color: "var(--text-faint)", marginTop: 6,
            }}>
              <span>{t("symptom_severity_min")}</span>
              <span>{t("symptom_severity_max")}</span>
            </div>
          </div>
        )}

        <div>
          <label style={labelStyle}>{t("symptom_when_label")}</label>
          <input
            style={inp}
            type="datetime-local"
            value={occurredAt}
            max={nowLocalDt()}
            onChange={e => setOccurredAt(e.target.value)}
          />
        </div>

        <CollapsibleField
          label={t("note_collapse_label")}
          accent={PURPLE}
          hasValue={notes.trim().length > 0}
        >
          <input
            style={inp}
            placeholder={t("symptom_note_placeholder")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={300}
          />
        </CollapsibleField>
      </div>

      <SaveButton
        onClick={handleSubmit}
        disabled={!valid}
        busy={status.kind === "submitting"}
        accent={PURPLE}
        label={t("symptom_save_btn")}
        successKey={savedTick || null}
      />

      <StatusBanner status={status} accent={PURPLE} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("symptom_disclaimer")}
      </div>
    </div>
  );
}

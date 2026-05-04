"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  insertMenstrualLog,
  type FlowIntensity,
  type PhaseMarker,
} from "@/lib/menstrual";
import {
  insertSymptomLog,
  SYMPTOM_TYPES,
  type SymptomType,
} from "@/lib/symptoms";

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
  fontSize: 12,
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
        fontSize: 12, color: "var(--text-muted)",
      }}>…</div>
    );
  }
  const isOk = status.kind === "ok";
  const color = isOk ? accent : "#FF2D78";
  return (
    <div style={{
      marginTop: 14, padding: "12px 14px",
      background: `${color}14`, border: `1px solid ${color}33`, borderRadius: 10,
      fontSize: 13, color, fontWeight: 600,
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
            onClick={() => onChange(on ? null : opt.value)}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: on ? `${accent}22` : "transparent",
              color: on ? accent : "var(--text-muted)",
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
  const [marker, setMarker] = useState<PhaseMarker | null>("ovulation");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const valid = (() => {
    if (!start) return false;
    if (mode === "bleeding") {
      if (!flow) return false;
      if (end && end < start) return false;
      return true;
    }
    return marker != null;
  })();

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    try {
      await insertMenstrualLog({
        start_date: start,
        end_date: mode === "bleeding" && end ? end : null,
        flow_intensity: mode === "bleeding" ? flow : null,
        phase_marker: mode === "marker" ? marker : null,
        notes: notes.trim() || null,
      });
      setStatus({
        kind: "ok",
        message: mode === "bleeding"
          ? t("cycle_logged_bleeding", { date: start, flow: flow ? t(`cycle_flow_${flow}` as never) : "" })
          : t("cycle_logged_marker", { date: start, marker: marker ? t(`cycle_marker_${marker}` as never) : "" }),
      });
      setNotes("");
      setEnd("");
      // Tell other surfaces (entries page, insights) to refetch.
      try { window.dispatchEvent(new CustomEvent("glev:menstrual-updated")); } catch {}
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message: t("save_failed_prefix", { message: msg }) });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${PINK}20`, border: `1px solid ${PINK}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: PINK, fontSize: 12,
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
                  onClick={() => setMode(m)}
                  style={{
                    padding: "9px 10px", borderRadius: 8, border: "none",
                    background: on ? `${PINK}22` : "transparent",
                    color: on ? PINK : "var(--text-muted)",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
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
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                {t("cycle_end_hint")}
              </div>
            </div>
            <div>
              <label style={labelStyle}>{t("cycle_flow_label")}</label>
              <PillRow<FlowIntensity>
                value={flow}
                onChange={setFlow}
                accent={PINK}
                options={[
                  { value: "light",  label: t("cycle_flow_light") },
                  { value: "medium", label: t("cycle_flow_medium") },
                  { value: "heavy",  label: t("cycle_flow_heavy") },
                ]}
              />
            </div>
          </>
        )}

        {mode === "marker" && (
          <div>
            <label style={labelStyle}>{t("cycle_marker_label")}</label>
            <PillRow<PhaseMarker>
              value={marker}
              onChange={setMarker}
              accent={PINK}
              options={[
                { value: "ovulation", label: t("cycle_marker_ovulation") },
                { value: "pms",       label: t("cycle_marker_pms") },
                { value: "other",     label: t("cycle_marker_other") },
              ]}
            />
          </div>
        )}

        <div>
          <label style={labelStyle}>{t("note_label")}</label>
          <input
            style={inp}
            placeholder={t("cycle_note_placeholder")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={300}
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!valid || status.kind === "submitting"}
        style={{
          marginTop: 18, width: "100%", padding: "13px",
          borderRadius: 12, border: "none",
          background: valid ? PINK : "var(--surface-soft)",
          color: valid ? "var(--on-accent)" : "var(--text-ghost)",
          fontSize: 14, fontWeight: 800,
          cursor: valid ? "pointer" : "not-allowed",
          transition: "all 0.15s",
        }}
      >
        {t("cycle_save_btn")}
      </button>

      <StatusBanner status={status} accent={PINK} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("cycle_disclaimer")}
      </div>
    </div>
  );
}

export function SymptomForm() {
  const t = useTranslations("engineLog");
  const [selected, setSelected] = useState<Set<SymptomType>>(new Set());
  const [severity, setSeverity] = useState<number>(3);
  const [occurredAt, setOccurredAt] = useState<string>(() => nowLocalDt());
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const toggle = (s: SymptomType) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const valid = selected.size > 0 && severity >= 1 && severity <= 5 && !!occurredAt;

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
      await insertSymptomLog({
        symptom_types: types,
        severity,
        occurred_at: occurredIso,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
      });
      setStatus({
        kind: "ok",
        message: cgm != null
          ? t("symptom_logged_ok_with_cgm", { count: types.length, severity, cgm: Math.round(cgm) })
          : t("symptom_logged_ok", { count: types.length, severity }),
      });
      setSelected(new Set());
      setNotes("");
      setOccurredAt(nowLocalDt());
      setSeverity(3);
      try { window.dispatchEvent(new CustomEvent("glev:symptom-updated")); } catch {}
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message: t("save_failed_prefix", { message: msg }) });
    }
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: `${PURPLE}20`, border: `1px solid ${PURPLE}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: PURPLE, fontSize: 12, fontWeight: 800,
        }}>★</span>
        {t("symptom_card_title")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>{t("symptom_select_label")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SYMPTOM_TYPES.map(s => {
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
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  {t(`symptom_${s}` as never)}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
            {t("symptom_select_hint")}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t("symptom_severity_label", { value: severity })}</label>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={severity}
            onChange={e => setSeverity(Number(e.target.value))}
            style={{ width: "100%", accentColor: PURPLE }}
          />
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontSize: 10, color: "var(--text-faint)", marginTop: 4,
          }}>
            <span>{t("symptom_severity_min")}</span>
            <span>{t("symptom_severity_max")}</span>
          </div>
        </div>

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

        <div>
          <label style={labelStyle}>{t("note_label")}</label>
          <input
            style={inp}
            placeholder={t("symptom_note_placeholder")}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={300}
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!valid || status.kind === "submitting"}
        style={{
          marginTop: 18, width: "100%", padding: "13px",
          borderRadius: 12, border: "none",
          background: valid ? PURPLE : "var(--surface-soft)",
          color: valid ? "var(--on-accent)" : "var(--text-ghost)",
          fontSize: 14, fontWeight: 800,
          cursor: valid ? "pointer" : "not-allowed",
          transition: "all 0.15s",
        }}
      >
        {t("symptom_save_btn")}
      </button>

      <StatusBanner status={status} accent={PURPLE} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("symptom_disclaimer")}
      </div>
    </div>
  );
}

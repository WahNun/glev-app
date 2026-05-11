"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  insertInfluenceLog,
  INFLUENCE_TYPES,
  type InfluenceType,
} from "@/lib/influences";
import { hapticSelection, hapticSuccess, hapticError } from "@/lib/haptics";
import CollapsibleField from "@/components/log/CollapsibleField";
import SaveButton from "@/components/log/SaveButton";
import TimeQuickChips from "@/components/log/TimeQuickChips";

const AMBER = "#F5A524";

// Quick "occurred ago" presets — same Now/-1h/-3h pattern the
// Insulin/Exercise/Symptom/Fingerstick forms use. Custom (-1) reveals a
// datetime-local picker for finer back-dating, capped at 1 year so we
// don't end up with prehistoric typos in the journal. Labels resolved
// per-locale inside the component (de: "Jetzt", en: "Now").
const QUICK_VALUES = [0, 60, 180] as const;
const QUICK_CUSTOM = -1;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
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

function nowLocalDt(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function localDtMinusMinutes(min: number): string {
  const d = new Date(Date.now() - min * 60_000);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function localDtMinusMs(ms: number): string {
  const d = new Date(Date.now() - ms);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
const MIN_OCCURRED_DT = () => localDtMinusMs(ONE_YEAR_MS);

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

export function InfluenceForm() {
  const t = useTranslations("engineLog");
  const [influenceType, setInfluenceType] = useState<InfluenceType>("alcohol");
  const [details, setDetails] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState<string>(() => nowLocalDt());
  // 0=Jetzt, 60/180=Quick chips, -1=custom datetime-local revealed.
  const [quickAgo, setQuickAgo] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [savedTick, setSavedTick] = useState<number>(0);

  const usingCustom = quickAgo === QUICK_CUSTOM;

  const quickOptions = QUICK_VALUES.map(v => ({
    value: v,
    label: v === 0
      ? t("influence_when_now_chip")
      : t("influence_when_ago_chip", { hours: v / 60 }),
  }));

  // Picking a quick chip rewrites occurredAt to the matching preset.
  // Switching to "Andere Zeit…" leaves the current value intact so the
  // datetime-local input opens at a sensible default.
  function selectQuick(v: number) {
    setQuickAgo(v);
    if (v === QUICK_CUSTOM) return;
    setOccurredAt(localDtMinusMinutes(v));
  }

  // Form is valid as long as occurred_at parses and isn't > 1y in the past
  // (matches the API + UI min). Future timestamps are blocked by the input
  // `max` already, but we re-check here so paste/manual entry can't slip
  // through.
  const occurredMs = occurredAt ? new Date(occurredAt).getTime() : NaN;
  const occurredOk =
    Number.isFinite(occurredMs)
    && occurredMs <= Date.now() + 60_000
    && occurredMs >= Date.now() - ONE_YEAR_MS;
  const valid = !!influenceType && occurredOk;

  function selectType(v: InfluenceType) {
    if (v === influenceType) return;
    hapticSelection();
    setInfluenceType(v);
  }

  async function handleSubmit() {
    if (!valid) return;
    setStatus({ kind: "submitting" });
    try {
      const occurredIso = new Date(occurredAt).toISOString();
      // Snapshot live CGM only when the entry is logged ~now (±5 min).
      // Back-dated entries leave CGM null so we don't store a value
      // that doesn't correspond to the actual event time.
      const NOW_WINDOW_MS = 5 * 60 * 1000;
      const isNow = Math.abs(Date.now() - new Date(occurredAt).getTime()) <= NOW_WINDOW_MS;
      const cgm = isNow ? await pullCurrentCgm() : null;
      await insertInfluenceLog({
        influence_type: influenceType,
        occurred_at: occurredIso,
        details: details.trim() || null,
        amount: amount.trim() || null,
        cgm_glucose_at_log: cgm,
        notes: notes.trim() || null,
      });
      hapticSuccess();
      setSavedTick(n => n + 1);
      const typeLabel = t(`influence_type_${influenceType}` as never);
      setStatus({
        kind: "ok",
        message: cgm != null
          ? t("influence_logged_ok_with_cgm", { type: typeLabel, cgm: Math.round(cgm) })
          : t("influence_logged_ok", { type: typeLabel }),
      });
      setDetails("");
      setAmount("");
      setNotes("");
      setOccurredAt(nowLocalDt());
      setQuickAgo(0);
      try { window.dispatchEvent(new CustomEvent("glev:influence-updated")); } catch {}
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
          background: `${AMBER}20`, border: `1px solid ${AMBER}40`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: AMBER, fontSize: 13, fontWeight: 800,
        }}>◆</span>
        {t("influence_card_title")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>{t("influence_type_label")}</label>
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${INFLUENCE_TYPES.length}, 1fr)`,
            gap: 6,
            background: "var(--input-bg)",
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            padding: 4,
          }}>
            {INFLUENCE_TYPES.map(v => {
              const on = v === influenceType;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => selectType(v)}
                  style={{
                    padding: "9px 8px", borderRadius: 8, border: "none",
                    background: on ? `${AMBER}22` : "transparent",
                    color: on ? AMBER : "var(--text-muted)",
                    fontSize: 13, fontWeight: 700, cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {t(`influence_type_${v}` as never)}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t("influence_details_label")}</label>
          <input
            style={inp}
            placeholder={t("influence_details_placeholder")}
            value={details}
            onChange={e => setDetails(e.target.value)}
            maxLength={120}
          />
        </div>

        <div>
          <label style={labelStyle}>{t("influence_amount_label")}</label>
          <input
            style={inp}
            placeholder={t("influence_amount_placeholder")}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            maxLength={60}
          />
        </div>

        <div>
          <label style={labelStyle}>{t("influence_when_label")}</label>
          <TimeQuickChips
            value={usingCustom ? -999 : quickAgo}
            onChange={selectQuick}
            accent={AMBER}
            ariaLabel={t("influence_when_label")}
            options={quickOptions}
          />
          <button
            type="button"
            aria-pressed={usingCustom}
            onClick={() => {
              hapticSelection();
              selectQuick(usingCustom ? 0 : QUICK_CUSTOM);
            }}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px dashed ${usingCustom ? AMBER : "var(--border)"}`,
              background: usingCustom ? `${AMBER}10` : "transparent",
              color: usingCustom ? AMBER : "var(--text-muted)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            {t("influence_when_custom_btn")}
          </button>
          {usingCustom && (
            <input
              style={{ ...inp, marginTop: 8 }}
              type="datetime-local"
              value={occurredAt}
              min={MIN_OCCURRED_DT()}
              max={nowLocalDt()}
              onChange={e => setOccurredAt(e.target.value)}
            />
          )}
        </div>

        <CollapsibleField
          label={t("note_collapse_label")}
          accent={AMBER}
          hasValue={notes.trim().length > 0}
        >
          <input
            style={inp}
            placeholder={t("influence_note_placeholder")}
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
        accent={AMBER}
        label={t("influence_save_btn")}
        successKey={savedTick || null}
      />

      <StatusBanner status={status} accent={AMBER} />

      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "var(--surface-soft)", borderRadius: 10,
        fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5,
      }}>
        {t("influence_disclaimer")}
      </div>
    </div>
  );
}

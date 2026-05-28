"use client";

/**
 * /settings/icr-schedule — three configurable time-banded ICRs.
 *
 * Lucas-spec (2026-05-14):
 *   - Dedicated sub-page (NOT a card in main settings).
 *   - 3 time slots, free-form labels with placeholder examples.
 *   - Times minute-granular (HH:MM input).
 *   - Master toggle on top so user can capture values without
 *     activating yet.
 *
 * Phase A: capture-only. The Adaptive Engine still uses the single
 * global ICR until Phase B wires `findActiveSlot()` into the
 * recommendation pipeline.
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  fetchIcrSchedule,
  saveIcrSchedule,
  defaultSlots,
  hhmmToMinutes,
  minutesToHHMM,
  type IcrSlot,
  type IcrSchedule,
} from "@/lib/icrSchedule";
import { hapticSelection, hapticSuccess, hapticError } from "@/lib/haptics";
import SnapSlider from "@/components/log/SnapSlider";

const ACCENT = "#4F6EF7";
const GREEN  = "#22D3A0";
const PINK   = "#FF2D78";

export default function IcrSchedulePage() {
  const t = useTranslations("icrSchedule");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [slots, setSlots]     = useState<IcrSlot[]>(defaultSlots());

  useEffect(() => {
    void (async () => {
      try {
        const sched = await fetchIcrSchedule();
        setEnabled(sched.enabled);
        // If no slots saved yet, seed with sensible defaults so the
        // user sees a starting structure instead of three empty cards.
        if (sched.slots.length === 3) {
          setSlots(sched.slots);
        } else if (sched.slots.length > 0) {
          // Partial — merge into 3-slot scaffold preserving saved ones.
          const seeded = defaultSlots();
          for (const s of sched.slots) seeded[s.slotIndex - 1] = s;
          setSlots(seeded);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function updateSlot(idx: number, patch: Partial<IcrSlot>) {
    setSlots(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    setSuccess(false);
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const payload: IcrSchedule = { enabled, slots };
      await saveIcrSchedule(payload);
      setSuccess(true);
      void hapticSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void hapticError();
    } finally {
      setSaving(false);
    }
  }

  // Example placeholder labels — Lucas wants free naming with examples
  // rotating across the slots so the user gets the idea.
  const placeholders = [t("slot_placeholder_1"), t("slot_placeholder_2"), t("slot_placeholder_3")];

  if (loading) {
    return (
      <div style={{ maxWidth: 480, margin: "0 auto", padding: 16, color: "var(--text-faint)" }}>
        {t("loading")}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 16, paddingBottom: 80 }}>
      {/* Header with back link */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/settings"
          style={{ fontSize: 13, color: ACCENT, textDecoration: "none", display: "inline-block", marginBottom: 8 }}
        >
          ← {t("back_to_settings")}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
          {t("page_title")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
          {t("page_subtitle")}
        </p>
      </div>

      {/* Master toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          background: "var(--surface)",
          border: `1px solid var(--border)`,
          borderRadius: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ flex: 1, paddingRight: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            {t("master_toggle_label")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2, lineHeight: 1.4 }}>
            {t("master_toggle_help")}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("master_toggle_label")}
          onClick={() => { void hapticSelection(); setEnabled(v => !v); setSuccess(false); }}
          style={{
            position: "relative",
            width: 48,
            height: 28,
            border: "none",
            borderRadius: 99,
            background: enabled ? GREEN : "var(--surface-soft)",
            cursor: "pointer",
            transition: "background 200ms",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2,
              left: enabled ? 22 : 2,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "white",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              transition: "left 200ms",
            }}
          />
        </button>
      </div>

      {/* Three slots — always editable so users can stage values without
          activating yet (Phase A: capture-only). Master toggle gates
          engine consumption only. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {slots.map((slot, idx) => (
          <SlotCard
            key={slot.slotIndex}
            slot={slot}
            placeholder={placeholders[idx]}
            onChange={(patch) => updateSlot(idx, patch)}
            t={t}
          />
        ))}
      </div>

      {/* Save area */}
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {error && (
          <div style={{ fontSize: 12, color: PINK, padding: "8px 12px", background: `${PINK}11`, border: `1px solid ${PINK}33`, borderRadius: 10 }}>
            {t("save_error")}: {error}
          </div>
        )}
        {success && (
          <div style={{ fontSize: 12, color: GREEN, padding: "8px 12px", background: `${GREEN}11`, border: `1px solid ${GREEN}33`, borderRadius: 10 }}>
            {t("save_success")}
          </div>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            width: "100%",
            padding: "14px",
            background: ACCENT,
            color: "white",
            border: "none",
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
            transition: "opacity 150ms",
          }}
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>

      {/* Phase-A note */}
      <p style={{ marginTop: 20, fontSize: 11, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.5 }}>
        {t("phase_a_note")}
      </p>
    </div>
  );
}

function SlotCard({
  slot, placeholder, onChange, t,
}: {
  slot: IcrSlot;
  placeholder: string;
  onChange: (patch: Partial<IcrSlot>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [startStr, setStartStr] = useState(minutesToHHMM(slot.startMinute));
  const [endStr,   setEndStr]   = useState(minutesToHHMM(slot.endMinute));
  // Re-sync when parent updates (e.g. on initial load of saved data).
  useEffect(() => { setStartStr(minutesToHHMM(slot.startMinute)); }, [slot.startMinute]);
  useEffect(() => { setEndStr(minutesToHHMM(slot.endMinute));     }, [slot.endMinute]);

  function commitStart(s: string) {
    setStartStr(s);
    const m = hhmmToMinutes(s);
    if (m != null) onChange({ startMinute: m });
  }
  function commitEnd(s: string) {
    setEndStr(s);
    const m = hhmmToMinutes(s);
    if (m != null) onChange({ endMinute: m });
  }

  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--surface)",
        border: `1px solid var(--border)`,
        borderRadius: 14,
      }}
    >
      {/* Slot header — index + per-slot enable toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)" }}>
          {t("slot_label", { n: slot.slotIndex })}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-faint)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={slot.enabled}
            onChange={(e) => { void hapticSelection(); onChange({ enabled: e.target.checked }); }}
            style={{ accentColor: ACCENT }}
          />
          {t("slot_enabled")}
        </label>
      </div>

      {/* Free-text label */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
          {t("slot_name_label")}
        </label>
        <input
          type="text"
          value={slot.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={placeholder}
          maxLength={32}
          style={{
            width: "100%",
            padding: "10px 12px",
            background: "var(--surface-soft)",
            border: `1px solid var(--border)`,
            borderRadius: 10,
            color: "var(--text)",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Time window — start / end */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
            {t("slot_from")}
          </label>
          <input
            type="time"
            value={startStr}
            onChange={(e) => commitStart(e.target.value)}
            step={60}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--surface-soft)",
              border: `1px solid var(--border)`,
              borderRadius: 10,
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
            {t("slot_to")}
          </label>
          <input
            type="time"
            value={endStr}
            onChange={(e) => commitEnd(e.target.value)}
            step={60}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--surface-soft)",
              border: `1px solid var(--border)`,
              borderRadius: 10,
              color: "var(--text)",
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* ICR value */}
      <div>
        <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>
          {t("slot_icr_label")}
        </label>
        <SnapSlider
          value={slot.icrGPerUnit}
          onChange={(v) => onChange({ icrGPerUnit: v })}
          min={2}
          max={40}
          step={1}
          unit="g/IE"
          accent={ACCENT}
          ariaLabel={t("slot_icr_label")}
        />
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          paddingLeft: 2,
          paddingRight: 2,
        }}>
          {[5, 10, 15, 20, 25, 30].map((tick) => (
            <span key={tick} style={{
              fontSize: 10,
              color: slot.icrGPerUnit === tick ? ACCENT : "var(--text-ghost)",
              fontWeight: slot.icrGPerUnit === tick ? 700 : 400,
              transition: "color 150ms ease",
            }}>
              {tick}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

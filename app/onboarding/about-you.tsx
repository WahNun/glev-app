"use client";

/**
 * Onboarding Step 1: "About you" — collects sex + birth_year (mandatory)
 * and optionally height + weight. Mirrors the dark-cockpit chrome of the
 * other onboarding steps (forced dark via _shared.tsx).
 *
 * Why birth year (not full birthday): we only need an age band, not a
 * birthday — keep PII minimal. Year-only is a CHECK constraint in the
 * migration and validated again server-side in /api/onboarding.
 *
 * Why mandatory: `sex` gates the cycle-logging surfaces (male hides
 * them entirely). `birth_year` will feed insulin-sensitivity defaults
 * later. Height/weight are stored but not yet wired into recommendations.
 *
 * Skip: still works (the parent Shell renders the top-right Skip), but
 * the primary "Next" CTA is disabled until sex + birth_year are valid.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Shell,
  ACCENT,
  SURFACE,
  BORDER,
  TEXT,
  TEXT_DIM,
  TEXT_FAINT,
  PINK,
} from "./_shared";
import { fetchUserProfile, type Sex } from "@/lib/userProfile";

type SexOption = { key: Sex; label: string };

export default function AboutYouStep({
  onNext,
  onBack,
  onSkip,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("onboarding.about_you");

  const [sex, setSex] = useState<Sex | null>(null);
  const [birthYear, setBirthYear] = useState<string>("");
  const [heightCm, setHeightCm] = useState<string>("");
  const [weightKg, setWeightKg] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from profile so re-entering the flow (Settings → "Onboarding
  // wiederholen") shows already-saved values instead of empty fields.
  useEffect(() => {
    fetchUserProfile()
      .then((p) => {
        if (p.sex) setSex(p.sex);
        if (p.birthYear) setBirthYear(String(p.birthYear));
        if (p.heightCm) setHeightCm(String(p.heightCm));
        if (p.weightKg) setWeightKg(String(p.weightKg));
      })
      .catch(() => { /* silent — empty is fine */ });
  }, []);

  const currentYear = new Date().getFullYear();
  const sexOptions: SexOption[] = useMemo(
    () => [
      { key: "female", label: t("sex_female") },
      { key: "male", label: t("sex_male") },
      { key: "diverse", label: t("sex_diverse") },
    ],
    [t],
  );

  // Validation — mirrors the API CHECK constraints.
  const birthYearNum = parseInt(birthYear, 10);
  const birthYearValid =
    Number.isInteger(birthYearNum) &&
    birthYearNum >= 1900 &&
    birthYearNum <= currentYear;

  const heightNum = heightCm.trim() === "" ? null : parseInt(heightCm, 10);
  const heightValid =
    heightNum === null ||
    (Number.isInteger(heightNum) && heightNum >= 50 && heightNum <= 280);

  const weightNum = weightKg.trim() === "" ? null : parseFloat(weightKg.replace(",", "."));
  const weightValid =
    weightNum === null ||
    (Number.isFinite(weightNum) && weightNum >= 20 && weightNum <= 400);

  const canContinue = sex !== null && birthYearValid && heightValid && weightValid;

  async function handleNext() {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "profile",
          sex,
          birth_year: birthYearNum,
          height_cm: heightNum,
          weight_kg: weightNum,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("save_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 600,
    color: TEXT_DIM,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: SURFACE,
    color: TEXT,
    fontSize: 16,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <Shell
      step={1}
      onNext={handleNext}
      onBack={onBack}
      onSkip={onSkip}
      primaryLabel={submitting ? t("saving") : t("primary")}
      primaryDisabled={!canContinue || submitting}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
          {t("headline")}
        </h1>
        <p style={{ fontSize: 14, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
          {t("sub")}
        </p>
      </div>

      {/* ── Sex (mandatory, segmented) ─────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={labelStyle}>
          {t("sex_label")} <span style={{ color: PINK }}>*</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {sexOptions.map((opt) => {
            const active = sex === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSex(opt.key)}
                aria-pressed={active}
                style={{
                  padding: "14px 8px",
                  borderRadius: 12,
                  border: `1px solid ${active ? ACCENT : BORDER}`,
                  background: active ? `${ACCENT}1F` : SURFACE,
                  color: active ? TEXT : TEXT_DIM,
                  fontWeight: active ? 700 : 500,
                  fontSize: 14,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  minHeight: 48,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Birth year (mandatory, numeric) ────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={labelStyle}>
          {t("birth_year_label")} <span style={{ color: PINK }}>*</span>
        </div>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder={t("birth_year_placeholder", { year: currentYear - 30 })}
          value={birthYear}
          onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          style={{
            ...inputStyle,
            borderColor:
              birthYear.length > 0 && !birthYearValid ? PINK : BORDER,
          }}
        />
        {birthYear.length > 0 && !birthYearValid && (
          <div style={{ fontSize: 12, color: PINK }}>
            {t("birth_year_invalid", { min: 1900, max: currentYear })}
          </div>
        )}
      </div>

      {/* ── Height + weight (optional, side-by-side) ───────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={labelStyle}>{t("height_label")}</div>
          <div style={{ position: "relative" }}>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              placeholder="170"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              style={{
                ...inputStyle,
                paddingRight: 44,
                borderColor: heightCm.length > 0 && !heightValid ? PINK : BORDER,
              }}
            />
            <span style={{
              position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
              color: TEXT_FAINT, fontSize: 13, fontWeight: 500, pointerEvents: "none",
            }}>cm</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={labelStyle}>{t("weight_label")}</div>
          <div style={{ position: "relative" }}>
            <input
              inputMode="decimal"
              maxLength={5}
              placeholder="70"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5))}
              style={{
                ...inputStyle,
                paddingRight: 44,
                borderColor: weightKg.length > 0 && !weightValid ? PINK : BORDER,
              }}
            />
            <span style={{
              position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
              color: TEXT_FAINT, fontSize: 13, fontWeight: 500, pointerEvents: "none",
            }}>kg</span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: TEXT_FAINT, margin: 0, lineHeight: 1.5 }}>
        {t("optional_hint")}
      </p>

      {error && (
        <div style={{
          padding: "10px 12px",
          background: `${PINK}14`,
          border: `1px solid ${PINK}40`,
          borderRadius: 10,
          color: PINK,
          fontSize: 13,
          lineHeight: 1.4,
        }}>
          {error}
        </div>
      )}
    </Shell>
  );
}

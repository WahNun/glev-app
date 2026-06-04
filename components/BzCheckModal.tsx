"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocale } from "next-intl";
import { hapticSuccess, hapticError } from "@/lib/haptics";

const ACCENT = "#4F6EF7";

type Strings = {
  preBolus: string;
  postBolus: (detail: string) => string;
  bgCheck: string;
  ariaLabel: (typeLabel: string) => string;
  measureNow: string;
  prompt: string;
  placeholder: string;
  validationError: string;
  saveFailed: string;
  saved: string;
  saving: string;
  retry: string;
  save: string;
  cancel: string;
};

const DE: Strings = {
  preBolus: "Prä-Bolus-Check",
  postBolus: (detail) => `Post-Bolus-Check (${detail})`,
  bgCheck: "BZ-Check",
  ariaLabel: (typeLabel) => `BZ-Wert eintragen — ${typeLabel}`,
  measureNow: "BZ jetzt messen",
  prompt: "Trag deinen aktuellen Blutzuckerwert ein.",
  placeholder: "z. B. 145",
  validationError: "Gib einen gültigen Wert zwischen 20 und 600 mg/dL ein.",
  saveFailed: "Speichern fehlgeschlagen.",
  saved: "✓ Gespeichert",
  saving: "Speichert …",
  retry: "Erneut versuchen",
  save: "Wert speichern",
  cancel: "Abbrechen",
};

const EN: Strings = {
  preBolus: "Pre-bolus BG check",
  postBolus: (detail) => `Post-bolus BG check (${detail})`,
  bgCheck: "BG check",
  ariaLabel: (typeLabel) => `Log BG value — ${typeLabel}`,
  measureNow: "Check your BG now",
  prompt: "Enter your current blood glucose value.",
  placeholder: "e.g. 145",
  validationError: "Please enter a valid value between 20 and 600 mg/dL.",
  saveFailed: "Could not save. Please try again.",
  saved: "✓ Saved",
  saving: "Saving …",
  retry: "Try again",
  save: "Save value",
  cancel: "Cancel",
};

export interface BzCheckPayload {
  mealId: string;
  checkType: string;
  /** Human-readable label shown in the sheet header. */
  label?: string;
}

interface Props {
  payload: BzCheckPayload | null;
  onClose: () => void;
}

/**
 * Bottom-sheet that appears when a post-bolus reminder fires.
 * The user enters their current blood glucose value; on save it
 * writes bg_at_check to the matching meal_timeline_checks row via
 * POST /api/timeline-check/bg-result.
 *
 * Triggered by the `glev:meal-check-reminder` CustomEvent dispatched
 * by MealCheckReminderProvider when the OS notification is tapped.
 */
export default function BzCheckModal({ payload, onClose }: Props) {
  const locale = useLocale();
  const T = locale === "en" ? EN : DE;

  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = payload !== null;

  // Reset state each time a new payload arrives
  useEffect(() => {
    if (open) {
      setValue("");
      setStatus("idle");
      setErrorMsg(null);
      // Delay focus slightly so the animation has started
      const t = window.setTimeout(() => inputRef.current?.focus(), 300);
      return () => window.clearTimeout(t);
    }
  }, [open, payload?.mealId, payload?.checkType]);

  const handleSave = useCallback(async () => {
    if (!payload) return;
    const num = Number(value.replace(",", "."));
    if (!Number.isFinite(num) || num < 20 || num > 600) {
      setErrorMsg(T.validationError);
      return;
    }
    setStatus("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/timeline-check/bg-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          meal_id: payload.mealId,
          check_type: payload.checkType,
          bg_mg_dl: Math.round(num),
        }),
      });
      if (res.status === 409) {
        // Already recorded — still a success from UX perspective
        setStatus("saved");
        hapticSuccess();
        window.setTimeout(onClose, 1200);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setStatus("saved");
      hapticSuccess();
      window.setTimeout(onClose, 1200);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : T.saveFailed);
      hapticError();
    }
  }, [payload, value, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSave();
      if (e.key === "Escape") onClose();
    },
    [handleSave, onClose],
  );

  const typeLabel =
    payload?.checkType === "pre"
      ? T.preBolus
      : payload?.checkType
        ? T.postBolus(payload.checkType.replace("_", " "))
        : T.bgCheck;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 1200,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.2s",
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={T.ariaLabel(typeLabel)}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1201,
          background: "var(--surface, #161b22)",
          borderRadius: "20px 20px 0 0",
          padding: "24px 20px calc(env(safe-area-inset-bottom, 0px) + 28px)",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.35)",
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: "var(--text-ghost)",
            margin: "0 auto 20px",
          }}
        />

        {/* Header */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}>
            {typeLabel}
          </div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text-strong)",
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {payload?.label ? `„${payload.label}"` : T.measureNow}
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              margin: "6px 0 0",
              lineHeight: 1.4,
            }}
          >
            {T.prompt}
          </p>
        </div>

        {/* Input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 20,
            background: "var(--border-soft)",
            border: `1.5px solid ${errorMsg ? "rgba(255,100,100,0.6)" : "var(--border-strong)"}`,
            borderRadius: 14,
            padding: "0 14px",
          }}
        >
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={20}
            max={600}
            step={1}
            placeholder={T.placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={status === "saving" || status === "saved"}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 28,
              fontWeight: 700,
              color: "var(--text-strong)",
              padding: "16px 0",
              minWidth: 0,
            }}
          />
          <span
            style={{
              fontSize: 14,
              color: "var(--text-dim)",
              flexShrink: 0,
              paddingTop: 2,
            }}
          >
            mg/dL
          </span>
        </div>

        {/* Error message */}
        {errorMsg && (
          <p
            style={{
              fontSize: 12,
              color: "#ff8888",
              margin: "8px 0 0",
              lineHeight: 1.4,
            }}
          >
            {errorMsg}
          </p>
        )}

        {/* Save button */}
        <button
          type="button"
          onClick={handleSave}
          disabled={status === "saving" || status === "saved" || !value.trim()}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "16px",
            borderRadius: 14,
            border: "none",
            background:
              status === "saved"
                ? "rgba(80,200,120,0.85)"
                : status === "saving"
                  ? "rgba(79,110,247,0.6)"
                  : ACCENT,
            color: "var(--on-accent)",
            fontSize: 16,
            fontWeight: 700,
            cursor:
              status === "saving" || status === "saved" || !value.trim()
                ? "default"
                : "pointer",
            opacity:
              !value.trim() && status === "idle" ? 0.5 : 1,
            transition: "background 0.2s, opacity 0.2s",
          }}
        >
          {status === "saved"
            ? T.saved
            : status === "saving"
              ? T.saving
              : status === "error"
                ? T.retry
                : T.save}
        </button>

        {/* Cancel */}
        {status !== "saved" && (
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "12px",
              borderRadius: 14,
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {T.cancel}
          </button>
        )}
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const ACCENT = "#4F6EF7";
const GREEN = "#22D3A0";
const PINK = "#FF2D78";
const BORDER = "var(--border)";

const inp: React.CSSProperties = {
  background: "var(--input-bg)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: "10px 14px",
  color: "var(--text)",
  fontSize: 15,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-dim)",
  display: "block",
  marginBottom: 5,
};

interface Props {
  onSuccess?: () => void;
}

export default function CgmSetupRequestForm({ onSuccess }: Props) {
  const t = useTranslations("cgmSetupRequest");

  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [os, setOs] = useState("");
  const [nightscout, setNightscout] = useState("");
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!brand || !os || !nightscout) {
      setError(t("error_required"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/cgm/setup-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sensor_brand: brand,
          sensor_model: model.trim() || null,
          device_os: os,
          nightscout_status: nightscout,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(j?.error ?? t("error_generic"));
      }
      setSubmitted(true);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        style={{
          padding: "20px 24px",
          background: `${GREEN}12`,
          border: `1px solid ${GREEN}40`,
          borderRadius: 14,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: GREEN }}>
          {t("success_title")}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
          {t("success_body")}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Intro block */}
      <div
        style={{
          padding: "14px 16px",
          background: "var(--surface-soft)",
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          marginBottom: 20,
        }}
      >
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>
          {t("intro_title")}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55 }}>
          {t("intro_body")}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Sensor brand */}
        <div>
          <label htmlFor="csr-brand" style={labelStyle}>
            {t("label_brand")} <span style={{ color: PINK }}>*</span>
          </label>
          <select
            id="csr-brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            disabled={submitting}
            style={{ ...inp, appearance: "auto" }}
            required
          >
            <option value="">{t("brand_placeholder")}</option>
            <option value="dexcom">Dexcom</option>
            <option value="freestyle_libre">FreeStyle Libre</option>
            <option value="medtronic">Medtronic</option>
            <option value="eversense">Eversense</option>
            <option value="sibionics">Sibionics</option>
            <option value="other">{t("brand_other")}</option>
          </select>
        </div>

        {/* Sensor model (optional) */}
        <div>
          <label htmlFor="csr-model" style={labelStyle}>
            {t("label_model")}
          </label>
          <input
            id="csr-model"
            type="text"
            placeholder={t("model_placeholder")}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={submitting}
            style={inp}
            maxLength={120}
          />
        </div>

        {/* Device OS */}
        <div>
          <label htmlFor="csr-os" style={labelStyle}>
            {t("label_os")} <span style={{ color: PINK }}>*</span>
          </label>
          <select
            id="csr-os"
            value={os}
            onChange={(e) => setOs(e.target.value)}
            disabled={submitting}
            style={{ ...inp, appearance: "auto" }}
            required
          >
            <option value="">{t("os_placeholder")}</option>
            <option value="ios">iOS (iPhone)</option>
            <option value="android">Android</option>
            <option value="both">{t("os_both")}</option>
          </select>
        </div>

        {/* Nightscout experience */}
        <div>
          <label htmlFor="csr-nightscout" style={labelStyle}>
            {t("label_nightscout")} <span style={{ color: PINK }}>*</span>
          </label>
          <select
            id="csr-nightscout"
            value={nightscout}
            onChange={(e) => setNightscout(e.target.value)}
            disabled={submitting}
            style={{ ...inp, appearance: "auto" }}
            required
          >
            <option value="">{t("nightscout_placeholder")}</option>
            <option value="none">{t("nightscout_none")}</option>
            <option value="heard_of_it">{t("nightscout_heard_of_it")}</option>
            <option value="tried_it">{t("nightscout_tried_it")}</option>
            <option value="running_it">{t("nightscout_running_it")}</option>
          </select>
        </div>

        {/* Free-text note */}
        <div>
          <label htmlFor="csr-note" style={labelStyle}>
            {t("label_note")}
          </label>
          <textarea
            id="csr-note"
            placeholder={t("note_placeholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
            rows={3}
            maxLength={800}
            style={{
              ...inp,
              resize: "vertical",
              minHeight: 72,
              lineHeight: 1.5,
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 13,
              color: PINK,
              background: `${PINK}10`,
              border: `1px solid ${PINK}30`,
              borderRadius: 8,
              padding: "8px 12px",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !brand || !os || !nightscout}
          style={{
            minHeight: 46,
            borderRadius: 12,
            border: "none",
            background: ACCENT,
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            cursor: submitting || !brand || !os || !nightscout ? "not-allowed" : "pointer",
            opacity: submitting || !brand || !os || !nightscout ? 0.6 : 1,
            fontFamily: "inherit",
            transition: "opacity 0.15s",
          }}
        >
          {submitting ? t("submit_busy") : t("submit_idle")}
        </button>
      </form>
    </div>
  );
}

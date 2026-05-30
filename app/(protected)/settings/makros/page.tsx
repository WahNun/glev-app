"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  fetchMacroTargets, saveMacroTargets,
  DEFAULT_MACRO_TARGETS, type MacroTargets,
} from "@/lib/userSettings";

const ACCENT = "#4F6EF7", PINK = "#FF2D78", BORDER = "var(--border)";
const inp: React.CSSProperties = {
  background: "var(--input-bg)", border: `1px solid ${BORDER}`,
  borderRadius: 10, padding: "10px 14px", color: "var(--text)",
  fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box",
};

export default function MakrosPage() {
  const t = useTranslations("settings");

  const touchedRef = useRef(false);
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(DEFAULT_MACRO_TARGETS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    fetchMacroTargets()
      .then((m) => { if (!touchedRef.current) setMacroTargets(m); })
      .catch(() => {});
  }, []);

  function updMacro<K extends keyof MacroTargets>(key: K, val: MacroTargets[K]) {
    touchedRef.current = true;
    setMacroTargets((prev) => ({ ...prev, [key]: val }));
  }

  const handleSave = useCallback(async () => {
    setSaving(true); setSaveError("");
    try {
      await saveMacroTargets(macroTargets);
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("save_failed"));
    } finally {
      setSaving(false);
    }
  }, [macroTargets, t]);

  const targets: Array<{ key: keyof MacroTargets; label: string; def: number; max: number }> = [
    { key: "carbs",   label: t("macro_carbs_label"),   def: 250, max: 2000 },
    { key: "protein", label: t("macro_protein_label"), def: 120, max: 2000 },
    { key: "fat",     label: t("macro_fat_label"),     def: 80,  max: 2000 },
    { key: "fiber",   label: t("macro_fiber_label"),   def: 30,  max: 200  },
  ];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/settings/mein-koerper"
          style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}
        >
          ‹ Mein Körper
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
          {t("daily_macros_title")}
        </h1>
      </div>

      <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: 14, padding: "16px 16px 20px", marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.55, margin: "0 0 16px" }}>
          {t("daily_macros_desc")}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {targets.map((target) => (
            <div key={target.key}>
              <label style={{ fontSize: 13, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
                {target.label}
              </label>
              <input
                style={inp}
                type="number"
                min={0}
                max={target.max}
                value={macroTargets[target.key]}
                onChange={(e) => {
                  const n = parseInt(e.target.value);
                  updMacro(target.key, Number.isFinite(n) ? Math.max(0, Math.min(target.max, n)) : target.def);
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {saveError && (
        <p style={{ fontSize: 13, color: PINK, lineHeight: 1.4, textAlign: "center", marginBottom: 8 }}>
          {saveError}
        </p>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        style={{
          width: "100%", padding: "13px", borderRadius: 12, border: "none",
          cursor: saving ? "wait" : "pointer",
          background: `linear-gradient(135deg, ${ACCENT}, #6B8BFF)`,
          color: "var(--on-accent)", fontSize: 14, fontWeight: 700,
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? t("save_button_busy") : saved ? t("save_button_done") : "Speichern"}
      </button>
    </div>
  );
}

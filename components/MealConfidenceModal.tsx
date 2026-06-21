"use client";

import { useLocale } from "next-intl";
import type { ParsedFood } from "@/lib/meals";
import { computeItemConfidence } from "@/lib/nutrition/confidence";
import type { ItemConfidence } from "@/lib/nutrition/confidence";
import { sourceLabel } from "@/lib/nutrition/badgeFor";
import type { NutritionSource } from "@/lib/nutrition/types";

const COPY = {
  de: {
    title:            "Konfidenz-Aufschlüsselung",
    estimation:       "Schätzung",
    carbs:            "KH",
    protein:          "Eiweiß",
    fat:              "Fett",
    fiber:            "Ballaststoffe",
    source_breakdown: "Aufschlüsselung",
    overall:          "Konfidenz gesamt",
    enter_own:        "Eigenen Wert eingeben",
    close:            "Schließen",
    mixed_note:       "Quelle gemischt",
  },
  en: {
    title:            "Confidence breakdown",
    estimation:       "Estimate",
    carbs:            "Carbs",
    protein:          "Protein",
    fat:              "Fat",
    fiber:            "Fiber",
    source_breakdown: "Breakdown",
    overall:          "Overall confidence",
    enter_own:        "Enter own value",
    close:            "Close",
    mixed_note:       "Mixed source",
  },
};

interface Props {
  items: ParsedFood[];
  isOpen: boolean;
  onClose: () => void;
  onEditMacros?: () => void;
}

function formatCi(value: number, ci: number): string {
  if (value === 0 && ci < 0.1) return "0 g";
  const ciRounded = Math.max(0.1, ci);
  return `${value.toFixed(1)} ±${ciRounded.toFixed(1)} g`;
}

function ConfidencePill({ pct }: { pct: number }) {
  const color =
    pct >= 85 ? "#34d399" :
    pct >= 70 ? "#fbbf24" :
                "#f87171";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 700,
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        whiteSpace: "nowrap",
      }}
    >
      {pct}%
    </span>
  );
}

function ItemCard({
  item,
  locale,
  t,
  onEditMacros,
}: {
  item: ParsedFood;
  locale: "de" | "en";
  t: typeof COPY["de"];
  onEditMacros?: () => void;
}) {
  const conf: ItemConfidence = computeItemConfidence(item, locale);
  const src = (item.source ?? "estimated") as NutritionSource;
  const srcLabel = sourceLabel(src, locale);
  const isMixed = src === "estimated" && item.carbs > 0;

  return (
    <div
      style={{
        background: "var(--surface-alt, rgba(255,255,255,0.03))",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Item header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>
            {item.name}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 6 }}>
            {item.grams}g
          </span>
        </div>
        <ConfidencePill pct={conf.overallPct} />
      </div>

      {/* Macro rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(
          [
            { key: "carbs" as const,   label: t.carbs,   conf: conf.carbs },
            { key: "protein" as const, label: t.protein, conf: conf.protein },
            { key: "fat" as const,     label: t.fat,     conf: conf.fat },
            { key: "fiber" as const,   label: t.fiber,   conf: conf.fiber },
          ] as const
        ).map(({ key, label, conf: c }) => (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--text-muted)", minWidth: 80 }}>{label}:</span>
            <span style={{ color: "var(--text-body)", fontVariantNumeric: "tabular-nums" }}>
              {formatCi(c.value, c.ci)}
            </span>
          </div>
        ))}
      </div>

      {/* Source breakdown */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, marginBottom: 2 }}>
          {t.source_breakdown} {t.carbs}:
        </div>
        {conf.carbs.details.map((line, i) => (
          <div key={i} style={{ fontSize: 11, color: "var(--text-body)", paddingLeft: 8 }}>
            • {line}
          </div>
        ))}
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
          {isMixed ? t.mixed_note : srcLabel}{" "}
          {src === "open_food_facts" ? "(verifiziert)" : ""}
        </div>
      </div>

      {/* Per-item edit button */}
      {onEditMacros && (
        <button
          type="button"
          onClick={onEditMacros}
          style={{
            marginTop: 2,
            width: "100%",
            padding: "8px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-body)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {t.enter_own}
        </button>
      )}
    </div>
  );
}

export default function MealConfidenceModal({ items, isOpen, onClose, onEditMacros }: Props) {
  const rawLocale = useLocale();
  const locale: "de" | "en" = rawLocale === "en" ? "en" : "de";
  const t = COPY[locale];

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
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.2s",
        }}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1201,
          background: "var(--surface, #161b22)",
          borderRadius: "20px 20px 0 0",
          maxHeight: "80dvh",
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateY(0)" : "translateY(100%)",
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
            margin: "16px auto 0",
            flexShrink: 0,
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px 10px",
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: "var(--text-strong)",
            }}
          >
            {t.title}
          </h2>
          <button
            type="button"
            aria-label={t.close}
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 18,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable item list */}
        <div
          style={{
            overflowY: "auto",
            padding: "0 16px calc(env(safe-area-inset-bottom, 0px) + 24px)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {items.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
              {t.estimation}
            </div>
          ) : (
            items.map((item, i) => (
              <ItemCard
                key={i}
                item={item}
                locale={locale}
                t={t}
                onEditMacros={onEditMacros}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

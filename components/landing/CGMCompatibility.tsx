"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BORDER, MINT, SURFACE, TEXT_DIM, TEXT_FAINT } from "./tokens";

const YELLOW = "#F5C451";

type Variant = "default" | "compact";

export default function CGMCompatibility({ variant = "default" }: { variant?: Variant }) {
  const t = useTranslations("cgm");
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [modalOpen]);

  const isCompact = variant === "compact";
  const supported = ["Libre 2 & 3", "Nightscout"];
  const limited = ["Dexcom", "Medtronic"];

  return (
    <section
      style={{
        width: "100%",
        maxWidth: 680,
        margin: "0 auto",
        padding: isCompact ? "0 20px" : "0 20px",
        boxSizing: "border-box",
      }}
    >
      <h2
        style={{
          fontSize: isCompact ? 18 : 22,
          fontWeight: 700,
          margin: "0 0 14px",
          letterSpacing: "-0.01em",
          color: "var(--text)",
          textAlign: "center",
        }}
      >
        {t("section_title")}
      </h2>

      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 14,
          padding: isCompact ? "14px 16px" : "18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <CompatRow color={MINT} label={t("group_supported")} items={supported} />
        <div style={{ height: 1, background: BORDER, opacity: 0.6 }} />
        <CompatRow color={YELLOW} label={t("group_limited")} items={limited} />

        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.55,
            color: TEXT_DIM,
          }}
        >
          {t("microcopy")}{" "}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              color: MINT,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
          >
            {t("nightscout_link")}
          </button>
        </p>

        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: TEXT_FAINT,
          }}
        >
          {t.rich("unsure_hint", {
            link: (chunks) => (
              <a
                href="/"
                style={{
                  color: MINT,
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                  fontWeight: 500,
                }}
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>

      {modalOpen ? <NightscoutModal onClose={() => setModalOpen(false)} /> : null}
    </section>
  );
}

function CompatRow({ color, label, items }: { color: string; label: string; items: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: TEXT_FAINT,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {items.map((name) => (
          <span
            key={name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: 999,
              background: "var(--surface-2, rgba(255,255,255,0.04))",
              border: `1px solid ${BORDER}`,
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                boxShadow: `0 0 0 3px ${color}22`,
              }}
            />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function NightscoutModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("cgm");
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="nightscout-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--surface)",
          border: `1px solid ${BORDER}`,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          padding: "20px 22px 24px",
          boxSizing: "border-box",
          color: "var(--text)",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h3
            id="nightscout-modal-title"
            style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}
          >
            {t("modal_title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: 0,
              color: TEXT_DIM,
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 14,
            lineHeight: 1.6,
            color: TEXT_DIM,
            whiteSpace: "pre-line",
          }}
        >
          {t("modal_body")}
        </p>
        <a
          href="https://nightscout.github.io/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            padding: "12px 16px",
            borderRadius: 12,
            background: MINT,
            color: "#0A1F18",
            fontWeight: 700,
            fontSize: 15,
            textDecoration: "none",
          }}
        >
          {t("modal_cta")}
        </a>
      </div>
    </div>
  );
}

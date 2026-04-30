"use client";

import { useTranslations } from "next-intl";
import { BORDER, SURFACE, MINT, TEXT_DIM } from "./tokens";

/**
 * The 3-step "How it works" section, identical across landing pages.
 * Copy is pulled from the `marketing` namespace so the section reacts
 * to the visitor's locale (cookie or Accept-Language fallback) — see
 * `i18n/request.ts`. Both /beta and /pro use the same demo flow so
 * the keys live under shared `step{1,2,3}_title|body` slots.
 */
export default function Steps() {
  const t = useTranslations("marketing");
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Step n={1} title={t("step1_title")} body={t("step1_body")} />
      <Step n={2} title={t("step2_title")} body={t("step2_body")} />
      <Step n={3} title={t("step3_title")} body={t("step3_body")} />
    </section>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: `1px solid ${BORDER}`,
          background: SURFACE,
          color: MINT,
          display: "grid",
          placeItems: "center",
          fontSize: 14,
          fontWeight: 500,
          flexShrink: 0,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
        aria-hidden
      >
        {n}
      </div>
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 14, color: TEXT_DIM, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

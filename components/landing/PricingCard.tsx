import type { ReactNode } from "react";
import { BORDER, MINT, SURFACE, TEXT_DIM } from "./tokens";

export type PriceLineData = { left: string; right: string };

type PricingCardProps = {
  heading: string;
  lines: PriceLineData[];
  /** Optional small text shown below the price lines, in MINT. Can be a JSX
   *  fragment (e.g. for cross-page links) or a plain string. */
  footer?: ReactNode;
};

/** Pricing transparency card — variant content per page. */
export default function PricingCard({ heading, lines, footer }: PricingCardProps) {
  return (
    <section
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{heading}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {lines.map((l) => (
          <PriceLine key={l.left} left={l.left} right={l.right} />
        ))}
      </div>
      {footer && (
        <div style={{ fontSize: 13, color: MINT, lineHeight: 1.5 }}>{footer}</div>
      )}
    </section>
  );
}

function PriceLine({ left, right }: PriceLineData) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
      <span style={{ fontSize: 16, fontWeight: 600 }}>{left}</span>
      <span style={{ fontSize: 14, color: TEXT_DIM, textAlign: "right" }}>{right}</span>
    </div>
  );
}

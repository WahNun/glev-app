import { BORDER, SURFACE, TEXT_DIM, TEXT_FAINT } from "./tokens";

export type FAQItemData = { q: string; a: string };

/** Parameterized FAQ section — each landing page passes its own item list. */
export default function FAQ({ items }: { items: FAQItemData[] }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.01em" }}>FAQ</h2>
      {items.map((item) => (
        <FAQItem key={item.q} q={item.q} a={item.a} />
      ))}
    </section>
  );
}

function FAQItem({ q, a }: FAQItemData) {
  return (
    <details
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          fontSize: 15,
          fontWeight: 600,
          color: "#fff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span>{q}</span>
        <span aria-hidden style={{ color: TEXT_FAINT, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>+</span>
      </summary>
      <div style={{ fontSize: 14, color: TEXT_DIM, lineHeight: 1.55, marginTop: 10 }}>{a}</div>
    </details>
  );
}

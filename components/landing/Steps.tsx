import { BORDER, SURFACE, MINT, TEXT_DIM } from "./tokens";

/**
 * The 3-step "How it works" section, identical across landing pages.
 * Hard-coded copy — both /beta and /pro use the same demo flow.
 */
export default function Steps() {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Step n={1} title="Sprich deine Mahlzeit" body={'„zwei Scheiben Vollkornbrot mit Butter und ein Ei"'} />
      <Step n={2} title="KI liefert Makros und dein CGM-Wert erscheint automatisch" body="Carbs, Protein, Fett — sofort sichtbar, neben deinem aktuellen Glucosewert." />
      <Step n={3} title="Du korrigierst falls nötig, dosierst, alles dokumentiert" body="Eine Mahlzeit zu loggen dauert nicht länger als ein Atemzug." />
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

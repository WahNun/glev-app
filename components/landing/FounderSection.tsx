import Image from "next/image";
import { ACCENT, MINT } from "./tokens";

/**
 * Founder portrait + quote section.
 * Same content on /beta and /pro — Lucas's diagnosis story is the through-line
 * for both pages, so this is intentionally identical.
 */
export default function FounderSection() {
  return (
    <section style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16 }}>
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          background: ACCENT,
          overflow: "hidden",
          position: "relative",
          boxShadow: "0 8px 24px rgba(79,110,247,0.35)",
        }}
      >
        <Image
          src="/founder.png"
          alt="Lucas, Founder von Glev"
          fill
          sizes="96px"
          priority
          style={{
            objectFit: "cover",
            objectPosition: "50% 18%",
            transform: "scale(1.6)",
            transformOrigin: "50% 18%",
          }}
        />
      </div>
      <p style={{ fontSize: 16, lineHeight: 1.55, color: "rgba(255,255,255,0.9)", margin: 0, maxWidth: 540 }}>
        „Im April 2026 wurde bei mir Typ 1 diagnostiziert. In den ersten Wochen habe ich jede gängige T1D-App getestet —
        und keine fühlt sich an, als wäre sie für den Alltag gemacht. Glev ist die App, die ich vom ersten Tag an
        gebraucht hätte."
      </p>
      <div style={{ fontSize: 14, fontWeight: 500, color: MINT }}>
        Lucas, Founder · Typ 1 seit April 2026
      </div>
    </section>
  );
}

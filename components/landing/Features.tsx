import { ACCENT } from "./tokens";

const FEATURES = [
  "Voice-first meal input — schneller als jede Tipp-Form",
  "KI-Makroberechnung via OpenAI",
  "CGM-Integration für FreeStyle Libre 2 via LibreLinkUp (Dexcom folgt)",
  "Offline-fähig für Mahlzeit-Logging",
  "Export für deinen Arzt als PDF und Spreadsheet",
  "Privacy-first — keine Werbung, keine Datenverkäufe",
];

/** Identical feature list across landing pages. */
export default function Features() {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {FEATURES.map((f) => (
        <div key={f} style={{ display: "flex", gap: 12, fontSize: 15, lineHeight: 1.5 }}>
          <span aria-hidden style={{ color: ACCENT, fontWeight: 700, lineHeight: "22px" }}>•</span>
          <span style={{ color: "rgba(255,255,255,0.9)" }}>{f}</span>
        </div>
      ))}
    </section>
  );
}

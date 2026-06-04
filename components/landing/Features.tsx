import { getLocale } from "next-intl/server";
import { ACCENT } from "./tokens";

const DE = [
  "Voice-first Mahlzeit-Erfassung — schneller als jede Tipp-Form",
  "KI-Makroberechnung via OpenAI",
  "CGM-Integration für FreeStyle Libre 2 via LibreLinkUp (Dexcom folgt)",
  "Offline-fähig für Mahlzeit-Logging",
  "Export für deinen Arzt als PDF und Spreadsheet",
  "Privacy-first — keine Werbung, keine Datenverkäufe",
];

const EN = [
  "Voice-first meal logging — faster than any tap form",
  "AI macro calculation via OpenAI",
  "CGM integration for FreeStyle Libre 2 via LibreLinkUp (Dexcom coming soon)",
  "Works offline for meal logging",
  "Export for your doctor as PDF and spreadsheet",
  "Privacy-first — no ads, no data sales",
];

/** Identical feature list across landing pages. */
export default async function Features() {
  const locale = await getLocale();
  const features = locale === "en" ? EN : DE;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {features.map((f) => (
        <div key={f} style={{ display: "flex", gap: 12, fontSize: 15, lineHeight: 1.5 }}>
          <span aria-hidden style={{ color: ACCENT, fontWeight: 700, lineHeight: "22px" }}>•</span>
          <span style={{ color: "rgba(255,255,255,0.9)" }}>{f}</span>
        </div>
      ))}
    </section>
  );
}

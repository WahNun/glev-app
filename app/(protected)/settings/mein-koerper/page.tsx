"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PINK = "#F472B6";
const ip = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function MeinKoerperPage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ Einstellungen
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>Mein Körper</h1>
      </div>
      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...ip}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>}
          label="Über mich"
          subtitle="Geburtsjahr, Geschlecht, Diabetestyp"
          ariaLabel="Über mich öffnen"
          onClick={() => router.push("/settings/konto")}
        />
        <SettingsRow
          iconColor={PINK}
          icon={<svg {...ip}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18" /></svg>}
          label="Zyklusprotokoll"
          subtitle="Zyklusphasen tracken"
          ariaLabel="Zyklusprotokoll öffnen"
          onClick={() => router.push("/settings/app")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...ip}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>}
          label="Tagesmakros"
          subtitle="Ziel-KH, Protein und Fett"
          ariaLabel="Tagesmakros öffnen"
          onClick={() => router.push("/settings/app")}
        />
      </SettingsSection>
    </div>
  );
}

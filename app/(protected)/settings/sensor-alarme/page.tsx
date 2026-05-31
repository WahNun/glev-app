"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0";
const ip = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function SensorAlarmePage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ Einstellungen
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>Sensor & Alarme</h1>
      </div>
      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...ip}><path d="M4 12h3l2-6 4 12 2-6h5" /></svg>}
          label="CGM-Quelle"
          subtitle="LibreLinkUp, Nightscout, Dexcom"
          ariaLabel="CGM-Quelle öffnen"
          onClick={() => router.push("/settings/cgm")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...ip}><path d="M12 2C8 8 6 12 6 15a6 6 0 0 0 12 0c0-3-2-7-6-13z" /></svg>}
          label="Glukose & Alarme"
          subtitle="Zielbereich, Hypo-Alarm, Einheiten"
          ariaLabel="Glukose & Alarme öffnen"
          onClick={() => router.push("/settings/glukose")}
        />
      </SettingsSection>
    </div>
  );
}

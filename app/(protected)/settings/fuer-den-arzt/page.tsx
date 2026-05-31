"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0";
const ip = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function FuerDenArztPage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ Einstellungen
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>Für den Arzt</h1>
      </div>
      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...ip}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
          label="Arzttermine"
          subtitle="Termine erfassen, Werte dokumentieren"
          ariaLabel="Arzttermine öffnen"
          onClick={() => router.push("/settings/termine")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...ip}><path d="M12 3v12" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" /></svg>}
          label="Export"
          subtitle="Daten als CSV exportieren"
          ariaLabel="Export öffnen"
          onClick={() => router.push("/settings/daten")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...ip}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>}
          label="Integrationen"
          subtitle="Google Sheets verbinden"
          ariaLabel="Integrationen öffnen"
          onClick={() => router.push("/settings/integrationen")}
        />
      </SettingsSection>
    </div>
  );
}

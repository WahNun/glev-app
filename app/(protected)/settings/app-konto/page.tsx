"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PURPLE = "#A78BFA";
const ip = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function AppKontoPage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ Einstellungen
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>App & Konto</h1>
      </div>
      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...ip}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></svg>}
          label="Konto"
          subtitle="Profil, E-Mail, Passwort"
          ariaLabel="Konto öffnen"
          onClick={() => router.push("/settings/konto")}
        />
        <SettingsRow
          iconColor={PURPLE}
          icon={<svg {...ip}><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg>}
          label="Darstellung & Sprache"
          subtitle="Sprache, Zeitformat, Theme, Haptik"
          ariaLabel="App-Einstellungen öffnen"
          onClick={() => router.push("/settings/app")}
        />
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...ip}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>}
          label="Benachrichtigungen"
          subtitle="Push, kritische Alarme"
          ariaLabel="Benachrichtigungen öffnen"
          onClick={() => router.push("/settings/app")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...ip}><path d="M12 2v6" /><path d="M9 5l3 3 3-3" /><path d="M5 12c0-3 3-5 7-5s7 2 7 5c0 5-3 9-7 9s-7-4-7-9z" /></svg>}
          label="Einheiten & Format"
          subtitle="KE/g, mg/dL vs. mmol/L, Zeitformat"
          ariaLabel="Einheiten öffnen"
          onClick={() => router.push("/settings/app")}
        />
      </SettingsSection>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", PURPLE = "#A78BFA";
const ip = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function GlevEnginePage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ Einstellungen
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>Glev Engine</h1>
      </div>
      <SettingsSection>
        <SettingsRow
          iconColor={ACCENT}
          icon={<svg {...ip}><path d="M12 2v6" /><path d="M9 5l3 3 3-3" /><path d="M5 12c0-3 3-5 7-5s7 2 7 5c0 5-3 9-7 9s-7-4-7-9z" /></svg>}
          label="Gelernte Lebensmittel"
          subtitle="Eigene Lebensmitteldatenbank verwalten"
          ariaLabel="Gelernte Lebensmittel öffnen"
          onClick={() => router.push("/settings/food-history")}
        />
        <SettingsRow
          iconColor={PURPLE}
          icon={<svg {...ip}><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 12l8-8" /><path d="M18 2h4v4" /></svg>}
          label="Glev AI"
          subtitle="KI-Einstellungen und Sprachausgabe"
          ariaLabel="Glev AI öffnen"
          onClick={() => router.push("/settings/ai")}
        />
      </SettingsSection>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { SettingsSection, SettingsRow } from "@/components/SettingsRow";

const ACCENT = "#4F6EF7", GREEN = "#22D3A0", PINK = "#F472B6";
const ip = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

type Content = {
  back: string;
  h1: string;
  cycleLabel: string;
  cycleSub: string;
  cycleAria: string;
  macrosLabel: string;
  macrosSub: string;
  macrosAria: string;
};

const DE: Content = {
  back: "Einstellungen",
  h1: "Mein Körper",
  cycleLabel: "Zyklusprotokoll",
  cycleSub: "Zyklusphasen tracken",
  cycleAria: "Zyklusprotokoll öffnen",
  macrosLabel: "Tagesmakros",
  macrosSub: "Ziel-KH, Protein und Fett",
  macrosAria: "Tagesmakros öffnen",
};

const EN: Content = {
  back: "Settings",
  h1: "My body",
  cycleLabel: "Cycle log",
  cycleSub: "Track cycle phases",
  cycleAria: "Open cycle log",
  macrosLabel: "Daily macros",
  macrosSub: "Target carbs, protein and fat",
  macrosAria: "Open daily macros",
};

export default function MeinKoerperPage() {
  const router = useRouter();
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <Link href="/settings" style={{ fontSize: 14, color: ACCENT, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 12 }}>
          ‹ {C.back}
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>{C.h1}</h1>
      </div>
      <SettingsSection>
        <SettingsRow
          iconColor={PINK}
          icon={<svg {...ip}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18" /></svg>}
          label={C.cycleLabel}
          subtitle={C.cycleSub}
          ariaLabel={C.cycleAria}
          onClick={() => router.push("/settings/app")}
        />
        <SettingsRow
          iconColor={GREEN}
          icon={<svg {...ip}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>}
          label={C.macrosLabel}
          subtitle={C.macrosSub}
          ariaLabel={C.macrosAria}
          onClick={() => router.push("/settings/makros")}
        />
      </SettingsSection>
    </div>
  );
}

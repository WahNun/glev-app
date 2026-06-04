"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { supabase } from "@/lib/supabase";
import type { ParsedFood } from "@/lib/meals";

const ACCENT = "#4F6EF7";
const BG     = "var(--bg)";
const SURFACE = "var(--surface)";
const BORDER  = "var(--border)";
const TEXT    = "var(--text-strong)";
const MUTED   = "var(--text-muted)";
const DIM     = "var(--text-dim)";

type Content = {
  back: string;
  kicker: string;
  h1: string;
  sub: string;
  s1_title: string;
  sources: Array<{ icon: string; name: string; desc: string }>;
  s2_title: string;
  s2_body: string;
  s3_title: string;
  s3_items: string[];
  s4_title: string;
  s4_body: string;
  disclaimer: string;
};

const DE: Content = {
  back: "‹ Einstellungen",
  kicker: "EINSTELLUNGEN · DATENQUELLEN",
  h1: "Woher kommen deine Nährwerte?",
  sub: "Glev kombiniert mehrere Quellen, um die Makros deiner Mahlzeiten möglichst genau zu schätzen. Hier erfährst du, welche das sind und was das bedeutet.",
  s1_title: "Die vier Quellen im Überblick",
  sources: [
    {
      icon: "✅",
      name: "Open Food Facts (OFF)",
      desc: "Die größte offene Lebensmitteldatenbank der Welt. Besonders stark bei verpackten und Marken-Produkten aus dem DACH-Raum.",
    },
    {
      icon: "✅",
      name: "USDA FoodData Central",
      desc: "Die offizielle US-amerikanische Nährstoffdatenbank. Sehr zuverlässig bei generischen Zutaten wie Fleisch, Gemüse und Getreide.",
    },
    {
      icon: "✅",
      name: "Deine Logs",
      desc: "Mahlzeiten, die du bereits in Glev gespeichert hast. Wenn du dasselbe Gericht erneut erfasst, kann Glev auf deine eigenen Daten zurückgreifen.",
    },
    {
      icon: "✨",
      name: "KI-Schätzung",
      desc: "Wenn eine Zutat in keiner der Datenbanken gefunden wird, schätzt die KI die Nährwerte anhand des Namens und üblicher Portionsgrößen. Diese Items sind mit ✨ markiert.",
    },
  ],
  s2_title: "Warum manchmal KI-Schätzungen?",
  s2_body:
    "Keine Datenbank deckt alle Lebensmittel ab — vor allem selbst gekochte Gerichte, regionale Spezialitäten oder Restaurantmahlzeiten fehlen oft. Statt eine leere Antwort zu geben, schätzt die KI die Werte auf Basis ähnlicher Lebensmittel. Die Schätzungen sind für Orientierungszwecke gedacht, nicht als medizinisch präzise Werte.",
  s3_title: "Was du tun kannst",
  s3_items: [
    "Kontrolliere die Makros im Engine-Schritt bevor du speicherst — du kannst Werte jederzeit manuell anpassen.",
    "Je öfter du eine Mahlzeit speicherst, desto besser lernt Glev deine persönlichen Portionsgrößen kennen.",
    "Bei stark abweichenden KI-Schätzungen lohnt sich ein kurzer Blick auf die Verpackung oder eine Nährstoff-App.",
    "Du kannst Mahlzeiten nachträglich in den Einträgen bearbeiten, falls du einen Fehler bemerkst.",
  ],
  s4_title: "Risiken von KI-Inhalten",
  s4_body:
    "KI-Schätzungen können falsch liegen. Fehler sind wahrscheinlicher bei unbekannten Gerichten, stark verarbeiteten Produkten oder ungewöhnlichen Zutaten. Glev ist eine Dokumentations-App — alle Insulin-Einschätzungen sind Gesprächsgrundlagen für dein Diabetes-Team, keine medizinischen Empfehlungen. Verlass dich bei kritischen Entscheidungen nie allein auf KI-generierte Nährwerte.",
  disclaimer:
    "Glev ist kein Medizinprodukt. Alle Informationen sind Orientierungspunkte. · hello@glev.app",
};

const EN: Content = {
  back: "‹ Settings",
  kicker: "SETTINGS · DATA SOURCES",
  h1: "Where do your nutrition values come from?",
  sub: "Glev combines multiple sources to estimate the macros of your meals as accurately as possible. Here's what those sources are and what it means for you.",
  s1_title: "The four sources at a glance",
  sources: [
    {
      icon: "✅",
      name: "Open Food Facts (OFF)",
      desc: "The world's largest open food database. Especially strong for packaged and branded products.",
    },
    {
      icon: "✅",
      name: "USDA FoodData Central",
      desc: "The official US nutritional database. Very reliable for generic ingredients like meat, vegetables and grains.",
    },
    {
      icon: "✅",
      name: "Your logs",
      desc: "Meals you've already saved in Glev. When you log the same dish again, Glev can draw on your own data.",
    },
    {
      icon: "✨",
      name: "AI estimate",
      desc: "When an ingredient isn't found in any database, AI estimates the nutritional values based on the name and typical portion sizes. These items are marked ✨.",
    },
  ],
  s2_title: "Why AI estimates sometimes?",
  s2_body:
    "No database covers every food — home-cooked dishes, regional specialities and restaurant meals are often missing. Rather than returning an empty answer, AI estimates values based on similar foods. These estimates are intended for orientation, not as medically precise figures.",
  s3_title: "What you can do",
  s3_items: [
    "Check the macros in the Engine step before saving — you can adjust values manually at any time.",
    "The more often you save a meal, the better Glev learns your personal portion sizes.",
    "For strongly deviating AI estimates it's worth a quick look at the packaging or a nutrition app.",
    "You can edit meals afterwards in your entries if you spot a mistake.",
  ],
  s4_title: "Risks of AI-generated content",
  s4_body:
    "AI estimates can be wrong. Errors are more likely with unfamiliar dishes, highly processed products or unusual ingredients. Glev is a documentation app — all insulin assessments are a basis for discussion with your diabetes care team, not medical advice. Never rely solely on AI-generated nutritional values for critical decisions.",
  disclaimer:
    "Glev is not a medical device. All information is for orientation only. · hello@glev.app",
};

export default function DataSourcesPage() {
  const locale = useLocale();
  const C = locale === "en" ? EN : DE;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: TEXT,
        padding: "0 0 80px",
      }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "16px 16px 0" }}>
        {/* Back link */}
        <Link
          href="/settings"
          style={{ fontSize: 13, color: ACCENT, textDecoration: "none", display: "inline-block", marginBottom: 12 }}
        >
          {C.back}
        </Link>

        {/* Header */}
        <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: "0.15em", marginBottom: 6 }}>
          {C.kicker}
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 10px", lineHeight: 1.2 }}>
          {C.h1}
        </h1>
        <p style={{ fontSize: 14, color: DIM, lineHeight: 1.6, margin: "0 0 28px" }}>
          {C.sub}
        </p>

        {/* Section 1 — sources */}
        <Section title={C.s1_title}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {C.sources.map((s) => (
              <div
                key={s.name}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "12px 14px",
                  background: SURFACE,
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                }}
              >
                <div style={{ fontSize: 20, lineHeight: 1.3, flexShrink: 0 }}>{s.icon}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 3 }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: DIM, lineHeight: 1.55 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Section 2 — why AI */}
        <Section title={C.s2_title}>
          <p style={{ fontSize: 13, color: DIM, lineHeight: 1.65, margin: 0 }}>{C.s2_body}</p>
        </Section>

        {/* Section 3 — what you can do */}
        <Section title={C.s3_title}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {C.s3_items.map((item, i) => (
              <li key={i} style={{ display: "flex", gap: 10, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
                <span style={{ color: ACCENT, fontWeight: 700, flexShrink: 0 }}>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Section 4 — AI risk info box */}
        <Section title={C.s4_title}>
          <div
            style={{
              padding: "14px 16px",
              background: "rgba(139,92,246,0.08)",
              border: "1px solid rgba(139,92,246,0.25)",
              borderRadius: 12,
            }}
          >
            <p style={{ fontSize: 13, color: DIM, lineHeight: 1.65, margin: 0 }}>{C.s4_body}</p>
          </div>
        </Section>

        {/* Section 5 — Source statistics (last 30 days) */}
        <SourceStats locale={locale === "en" ? "en" : "de"} />

        {/* Disclaimer */}
        <p style={{ marginTop: 32, fontSize: 11, color: MUTED, lineHeight: 1.5 }}>{C.disclaimer}</p>
      </div>
    </main>
  );
}

// ── Source statistics component ───────────────────────────────────────────

type StatBucket = { label: string; count: number; pct: number; color: string };

function SourceStats({ locale }: { locale: "de" | "en" }) {
  const [buckets, setBuckets] = useState<StatBucket[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      try {
        const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
        const { data } = await supabase
          .from("meals")
          .select("parsed_json")
          .gte("created_at", since)
          .limit(500);
        if (!data) return;

        const counts = { db: 0, logs: 0, ai: 0 };
        for (const row of data as Array<{ parsed_json: ParsedFood[] | null }>) {
          for (const item of row.parsed_json ?? []) {
            if (item.source === "open_food_facts" || item.source === "usda") counts.db++;
            else if (item.source === "user_history" || item.source === "user_confirmed") counts.logs++;
            else counts.ai++;
          }
        }
        const total = counts.db + counts.logs + counts.ai;
        if (total === 0) return;
        const pct = (n: number) => Math.round((n / total) * 100);
        setBuckets([
          { label: locale === "en" ? "DB-verified (OFF/USDA)" : "DB-bestätigt (OFF/USDA)", count: counts.db,  pct: pct(counts.db),  color: "#22D3A0" },
          { label: locale === "en" ? "Your logs"              : "Deine Logs",              count: counts.logs, pct: pct(counts.logs), color: "#4F6EF7" },
          { label: locale === "en" ? "AI estimate"            : "KI-Schätzung",            count: counts.ai,   pct: pct(counts.ai),   color: "#a78bfa" },
        ]);
      } catch {
        // silent — stats are optional
      }
    })();
  }, [locale]);

  if (!buckets) return null;

  const title = locale === "en" ? "Your data sources (last 30 days)" : "Deine Datenquellen (letzte 30 Tage)";

  return (
    <Section title={title}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {buckets.map((b) => (
          <div key={b.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: DIM, marginBottom: 4 }}>
              <span>{b.label}</span>
              <span style={{ fontWeight: 600, color: b.color }}>{b.pct}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${b.pct}%`, background: b.color, borderRadius: 3, transition: "width 0.6s ease" }} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: TEXT, margin: "0 0 12px", letterSpacing: "-0.01em" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

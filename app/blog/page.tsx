"use client";

import Link from "next/link";
import Script from "next/script";
import { useTranslations } from "next-intl";
import GlevLockup from "@/components/GlevLockup";
import LocaleSwitcher from "@/components/LocaleSwitcher";

/**
 * Öffentlicher Blog. Inhalt liegt komplett bei Soro
 * (https://app.trysoro.com) — Lucas schreibt und veröffentlicht dort,
 * ihre Embed-Library lädt zur Laufzeit den aktuellen Stand und
 * rendert ihn in das `#soro-blog` Div. Dadurch braucht ein neuer
 * Beitrag keinen Glev-Deploy.
 *
 * Implementierung
 * - "use client" weil der Soro-Loader DOM-Manipulation macht (er sucht
 *   `#soro-blog` und schreibt das HTML rein).
 * - <Script strategy="afterInteractive" /> ist Next.js' Äquivalent zum
 *   `<script defer>` aus dem von Soro gelieferten Snippet — lädt nach
 *   Hydration, blockiert das initiale Render also nicht. Nur ein
 *   einziger Mount, kein Race-Risiko über next/script's eingebaute
 *   Dedup-Logik.
 * - Falls Soro das Div nicht findet (Netzwerkfehler, AdBlocker,
 *   Plattform-Wartung) bleibt das `#soro-blog` Div sichtbar leer; ein
 *   dezenter Fallback-Hinweis liegt versteckt darunter und wird per
 *   `:empty + .soro-blog-fallback` Selector eingeblendet.
 *
 * Header
 *   Spiegelt das Top-Nav-Layout der Homepage (`app/page.tsx`) bewusst
 *   1:1 — gleiche Höhe, gleicher Blur-Hintergrund, gleicher Logo-Slot
 *   plus LocaleSwitcher und Login-Pill. Marketing-Pages teilen sich in
 *   diesem Repo keine Layout-Komponente; statt eine zu extrahieren
 *   (würde diesen Turn aufblähen) duplizieren wir das Markup hier
 *   minimal. Sollte sich der Header öfter wiederholen, wäre das ein
 *   Kandidat für eine Extraktion in `components/landing/`.
 */

const BORDER = "var(--border)";

export default function BlogPage() {
  const t = useTranslations("marketing");

  return (
    <main
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "100dvh",
        fontFamily: "var(--font-inter), Inter, system-ui, sans-serif",
        // Identischer Top-Pad-Wert wie auf der Homepage, damit der
        // fixed-positionierte Header beim Wechsel zwischen / und /blog
        // optisch nicht "springt".
        paddingTop: "calc(56px + env(safe-area-inset-top))",
      }}
    >
      <style>{`
        .glev-link { transition: color 0.15s; }
        .glev-link:hover { color: #6B8BFF !important; }
        .glev-cta-ghost { transition: background 0.15s, border-color 0.15s; }
        .glev-cta-ghost:hover { background: var(--surface-soft); border-color: var(--border-strong); }

        /* Soro-Loader hängt seinen Content als Kindknoten in #soro-blog
           ein; solange der Container leer ist, blenden wir den
           Fallback-Hinweis darunter ein. Sobald Soro irgendetwas (auch
           nur ein Platzhalter-Skeleton) reinrendert, ist :empty falsch
           und der Hinweis verschwindet automatisch. */
        #soro-blog:empty + .soro-blog-fallback { display: block; }
        .soro-blog-fallback { display: none; }

        /* Soros Default-Stylesheet rendert auf dunklem Hintergrund mit
           niedrigem Kontrast. Wir überschreiben Schrift- und Linkfarben
           hart, damit der Inhalt auf #09090b les bleibt. !important
           weil Soro Inline-Styles + eigene Klassen mitliefert. */
        #soro-blog, #soro-blog * {
          color: var(--text) !important;
          background: transparent !important;
          border-color: var(--border) !important;
        }
        #soro-blog h1, #soro-blog h2, #soro-blog h3, #soro-blog h4 {
          color: var(--text) !important;
          font-weight: 700 !important;
        }
        #soro-blog a { color: #6B8BFF !important; text-decoration: underline; }
        #soro-blog a:hover { color: #9DB3FF !important; }
        #soro-blog code, #soro-blog pre {
          background: var(--surface-soft) !important;
          color: var(--text) !important;
          border: 1px solid var(--border) !important;
          border-radius: 6px;
        }
        #soro-blog blockquote {
          border-left: 3px solid var(--border-strong, #444) !important;
          color: var(--text-dim, #c7c7c7) !important;
          padding-left: 14px;
        }
        #soro-blog img { border-radius: 8px; }
      `}</style>

      {/* Top nav — gespiegelt vom Home-Page-Header (`app/page.tsx`).
          Wenn dort etwas geändert wird, hier mitziehen. */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "color-mix(in srgb, var(--bg) 72%, transparent)",
          backdropFilter: "saturate(180%) blur(14px)",
          WebkitBackdropFilter: "saturate(180%) blur(14px)",
          borderBottom: `1px solid ${BORDER}`,
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            maxWidth: 1180,
            margin: "0 auto",
            padding: "14px 24px",
          }}
        >
          <Link
            href="/"
            style={{ textDecoration: "none", color: "inherit" }}
            aria-label={t("nav_aria_home")}
          >
            <GlevLockup size={28} />
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <LocaleSwitcher ariaLabel={t("nav_aria_locale")} />
            <Link
              href="/login"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                textDecoration: "none",
                padding: "9px 16px",
                borderRadius: 999,
                border: `1px solid ${BORDER}`,
                background: "var(--surface-soft)",
              }}
              className="glev-cta-ghost"
            >
              {t("nav_signin")}
            </Link>
          </div>
        </div>
      </nav>

      <section
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "48px 24px 80px",
        }}
      >
        <header style={{ marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 40,
              lineHeight: 1.15,
              margin: "0 0 12px",
              letterSpacing: "-0.02em",
              fontWeight: 700,
              // Mobile-fix Schema aus /beta + /pro: kontrollierter
              // Wortbruch auf engen Viewports, kein horizontaler Overflow.
              hyphens: "auto",
              overflowWrap: "break-word",
            }}
          >
            {t("nav_blog")}
          </h1>
        </header>

        {/* Soro-Embed — Lucas schreibt drüben auf trysoro.com, das
            Skript holt den aktuellen Stand zur Laufzeit. ID darf nicht
            umbenannt werden, der Loader sucht exakt nach `soro-blog`. */}
        <div id="soro-blog" />

        <p
          className="soro-blog-fallback"
          style={{
            fontSize: 14,
            color: "var(--text-dim, #94a3b8)",
            marginTop: 8,
            padding: "16px 18px",
            border: `1px dashed ${BORDER}`,
            borderRadius: 10,
          }}
        >
          Wenn hier nichts erscheint, blockiert vermutlich ein Browser-
          Plugin den externen Blog-Loader. Schreib uns kurz an{" "}
          <a
            href="mailto:hello@glev.app"
            style={{ color: "var(--text)", textDecoration: "underline" }}
          >
            hello@glev.app
          </a>{" "}
          — wir helfen weiter.
        </p>
      </section>

      <Script
        src="https://app.trysoro.com/api/embed/3e94583a-baad-4296-a2ef-e7d445982516"
        strategy="afterInteractive"
      />
    </main>
  );
}

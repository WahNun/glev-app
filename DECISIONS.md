# DECISIONS.md

Dieses Dokument hält bewusste Architektur- und Scope-Entscheidungen fest sowie einen chronologischen Log aller abgeschlossenen Tasks. Zukünftige Agents lesen es am Task-Start, um den Kontext zu verstehen.

---

## Decisions

> Was hier steht, ist eine bewusste Nicht-Entscheidung oder eine Weichenstellung, die nicht mehr offen diskutiert werden soll.

### D-001 · Supabase statt eigener Auth/DB-Infrastruktur (2026-01-15)
Supabase liefert PostgreSQL, Row Level Security und Auth (Email/Password + JWT) als verwalteten Service. Eine eigene Postgres-Instanz mit Auth-Stack hätte dieselbe Betriebslast ohne den Mehrwert. Firebase wurde geprüft, aber wegen SQL-Querybarkeit und Open-Source-Kompatibilität verworfen. **Nicht wieder öffnen:** Solange keine Multi-Tenant-SaaS-Isolation erforderlich ist, bleibt Supabase die Datenebene.

### D-002 · Capacitor statt React Native für mobile Shells (2026-01-20)
Glev ist primär eine Next.js-Web-App. Capacitor erlaubt es, exakt dieselbe Web-Codebasis als Thin-Webview-Shell auf iOS/Android zu verpacken — kein zweiter Rendering-Pfad, keine doppelte Feature-Implementierung. React Native hätte eine separate Komponentenbibliothek und Logik-Schicht erfordert. **Nicht wieder öffnen:** Solange die App keine tief nativen UI-Patterns (z. B. UIKit-Navigation) braucht, bleibt Capacitor die Native-Schicht.

### D-003 · Keine direkten Dosis-Anweisungen in der UI (2026-02-01)
Glev ist ein Entscheidungs-*Support*-System, kein Medizinprodukt Klasse IIb. Direkte Dosis-Anweisungen (z. B. „Nimm jetzt 4 IE") würden eine klinische Validierung und MDR-Zertifizierung erfordern, die den aktuellen Rahmen sprengen. Alle Engine-Empfehlungen sind als Gesprächsbasis fürs Diabetes-Team gerahmt. **Nicht wieder öffnen:** Selbst nach einer möglichen MDR-Einreichung braucht jede Änderung an diesem Prinzip eine explizite Freigabe durch das medizinische Verantwortungsteam.

### D-004 · next-intl statt i18next für Lokalisierung (2026-02-10)
`next-intl` ist für Next.js App Router (Server Components, `generateMetadata`, Middleware-basiertes Locale-Routing) nativ ausgelegt. i18next benötigt zusätzliche Adapter (`next-i18next`) und arbeitet primär Client-seitig, was SSR-Hydration-Mismatches erzeugt. Unterstützte Locales: `de` (Standard) und `en`. **Nicht wieder öffnen:** Eine Migration würde alle `useTranslations()`-Aufrufe und die Middleware betreffen — Aufwand ohne funktionalen Mehrwert.

### D-005 · Pump-Dosierung bewusst aus dem Engine-Scope ausgeschlossen (2026-02-15)
Die Glev Engine berechnet Bolusempfehlungen für ICT-Nutzer (Pen-Injektionen). Insulinpumpen-Nutzer haben eigene Basal-/Bolusprofile, die von der Engine nicht modelliert werden. Die Engine zeigt Pump-Trägern kein Ergebnis an (oder einen expliziten Hinweis). Pump-spezifische Kalkulation (TBR, Extended Bolus) ist kein aktueller Roadmap-Punkt. **Nicht wieder öffnen:** Pump-Support erfordert ein eigenes Datenmodell und klinische Expertise — separates Feature-Flag, wenn überhaupt.

### D-006 · Vercel als einzige Production-Plattform, Replit nur Dev (2026-03-01)
Replit-Secrets fließen nicht in den Vercel-Build. Alle Produktions-Envvars leben in Vercel Project Settings. GitHub Actions (`flush-outbox.yml`) und Stripe-Webhooks zeigen direkt auf `https://glev.app`. Replit wird ausschließlich für Entwicklung und Agent-Tasks genutzt. **Nicht wieder öffnen:** Eine Vermischung der beiden Umgebungen (z. B. Replit Deploy) würde Webhook-Endpunkte und Cron-Jobs duplizieren und Secret-Management verkomplizieren.

---

## Fix Log

| Datum | Task-Name | Asana-GID | Beschreibung |
|-------|-----------|-----------|--------------|
| 2026-05-20 | DECISIONS.md anlegen und in Abschluss-Flow einbinden | 1209934567890123 | Initiale Anlage von DECISIONS.md, Erweiterung von finalize-task.sh um Pflicht-Check, Prozessregeln in replit.md eingetragen. |
| 2026-05-20 | Backfill key architecture decisions into DECISIONS.md | 416 | 6 Entscheidungen (D-001–D-006) in ## Decisions eingetragen: Supabase, Capacitor, Kein-Dosis-Imperativ, next-intl, Pump-Ausschluss, Vercel-als-Prod. |
| 2026-05-20 | Keep the architecture decision log up to date automatically | 417 | finalize-task.sh um Architektur-Grenz-Check erweitert (supabase/, capacitor.config, middleware.ts, lib/emails/, next.config, .github/workflows/, pnpm-workspace.yaml, package.json): bei Treffer Reminder ohne Exit-Code-Fehler. Self-Assessment-Checkliste in replit.md § Agent Workflow Rules (Regel 3) eingetragen. |

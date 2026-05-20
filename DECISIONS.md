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

### D-007 · Engine-Algorithmus: gewichteter k-NN-Ansatz statt LLM-only (2026-05-20)

**Warum kein LLM-only-Approach?**
Ein LLM könnte prinzipiell aus dem Freitext-Meal-Log direkt eine Dosisempfehlung generieren. Das wurde bewusst verworfen:
- **Nicht deterministisch:** Gleiche Eingabe, unterschiedliche Ausgabe — bei klinischen Empfehlungen nicht akzeptabel.
- **Nicht personalisierbar:** Ein generisches LLM kennt nicht das individuelle ICR, die Insulinsensitivität oder das Tageszeit-Muster des Nutzers.
- **Nicht auditierbar:** Der Reasoning-Pfad eines LLM ist für Compliance-Zwecke (MDR) nicht hinreichend dokumentierbar.
- **Latenz & Kosten:** Jede Dosisempfehlung würde einen API-Call erfordern; beim gewichteten Ansatz ist das eine lokale Pure-Funktion.

**Gewählter Ansatz: personalisierter, gewichteter Durchschnitt (k-NN-ähnlich)**
Die Engine lernt den ICR des Nutzers aus finalisierten Mahlzeiten (`carbs / insulin`) und gewichtet schlechtere Outcomes (OVERDOSE, UNDERDOSE → 0.3; SPIKE → 0.7) geringer als GOOD (1.0). Das ist konzeptionell verwandt mit einem gewichteten k-Nearest-Neighbour, aber ohne explizite Feature-Distanz — der Nutzungskontext (Tageszeit, Meal-Type) wird über separate Buckets abgedeckt, nicht über eine Ähnlichkeitsmetrik.

**Was das LLM tut (und was nicht):**
- GPT (`lib/ai/systemPrompt.ts`) parst den Freitext-Meal-Log und klassifiziert die Mahlzeit in einen der vier Typen (FAST_CARBS / HIGH_FAT / HIGH_PROTEIN / BALANCED).
- GPT schlägt **niemals** eine Dosis vor und wertet **niemals** eine Dosis aus — das ist im System-Prompt explizit verboten.
- Die Klassifikation fließt in die Spike-Cutoffs (FAST_CARBS=70, HIGH_FAT=40, HIGH_PROTEIN=50, BALANCED=55 mg/dL) und die Meal-Type-Farb-/Label-Darstellung.

**Vollständige Algorithmus-Dokumentation:** `docs/engine-algorithm.md`

**Nicht wieder öffnen:** Solange Glev kein Klasse-IIb-Medizinprodukt ist und keine klinische Validierung eines LLM-Dosierungsmodells vorliegt, bleibt die deterministische, auditierbare Pure-Function-Pipeline die einzige Dosis-Logik.

### D-008 · Engine-Schwellenwerte als exportierte Konstanten mit Doc-Sync-Check (2026-05-20)

Alle klinisch relevanten numerischen Schwellenwerte der Engine-Pipeline werden als `export const` in ihren jeweiligen Quelldateien gepflegt und sind nicht mehr als Inline-Literale vergraben:

- `lib/engine/evaluation.ts`: `HYPO_THRESHOLD`, `SPIKE_CUTOFF_FAST_CARBS`, `SPIKE_CUTOFF_HIGH_FAT`, `SPIKE_CUTOFF_HIGH_PROTEIN`, `SPIKE_CUTOFF_BALANCED` (neu); `SPEED_SPIKE_MGDL_PER_MIN`, `SPEED_SPIKE_STRONG_MGDL_PER_MIN`, `SPIKE_STRONG_MAGNITUDE_MULTIPLIER` waren bereits exportiert.
- `lib/engine/recommendation.ts`: `DEFAULT_ICR`, `DEFAULT_CF`, `DEFAULT_TARGET`, `SAFETY_BG_MIN`, `MAX_DOSE_UNITS` (neu exportiert).
- `lib/engine/adaptiveICR.ts`: `MIN_BUCKET_SAMPLES`, `OUTCOME_WEIGHT` (neu exportiert).

`docs/engine-algorithm.md` enthält jetzt einen maschinenlesbaren **Threshold Index** (letzter Abschnitt) mit Konstantenname, Quelldatei und Wert. `scripts/check-engine-doc-thresholds.mjs` liest diese Tabelle und vergleicht jeden Eintrag gegen die tatsächlichen Werte im TypeScript-Source. Aufruf: `pnpm run check:engine-doc` (Exit 1 bei Abweichung).

**Warum dieser Ansatz statt reiner Inline-Kommentare?** Inline-Kommentare wie "see X in Y" erinnern nur — sie verhindern nicht, dass der Wert still falsch wird. Die maschinenlesbare Tabelle + Script schließt diese Lücke ohne einen vollständigen TypeScript-Build zu erfordern (das Script ist reines Node.js ESM mit Regex-Extraktion).

**Nicht wieder öffnen:** Wenn neue klinische Schwellenwerte zur Engine hinzugefügt werden, müssen sie (a) als `export const` definiert und (b) im Threshold Index eingetragen werden. `pnpm run check:engine-doc` sollte in CI-Pipelines und vor jedem Release-Build laufen.

---

## Fix Log

| Datum | Task-Name | Asana-GID | Beschreibung |
|-------|-----------|-----------|--------------|
| 2026-05-20 | DECISIONS.md anlegen und in Abschluss-Flow einbinden | 1209934567890123 | Initiale Anlage von DECISIONS.md, Erweiterung von finalize-task.sh um Pflicht-Check, Prozessregeln in replit.md eingetragen. |
| 2026-05-20 | Backfill key architecture decisions into DECISIONS.md | 416 | 6 Entscheidungen (D-001–D-006) in ## Decisions eingetragen: Supabase, Capacitor, Kein-Dosis-Imperativ, next-intl, Pump-Ausschluss, Vercel-als-Prod. |
| 2026-05-20 | Keep the architecture decision log up to date automatically | 417 | finalize-task.sh um Architektur-Grenz-Check erweitert (supabase/, capacitor.config, middleware.ts, lib/emails/, next.config, .github/workflows/, pnpm-workspace.yaml, package.json): bei Treffer Reminder ohne Exit-Code-Fehler. Self-Assessment-Checkliste in replit.md § Agent Workflow Rules (Regel 3) eingetragen. |
| 2026-05-20 | Document the Glev Engine recommendation algorithm so future changes don't break its logic | 418 | `docs/engine-algorithm.md` angelegt mit vollständiger Beschreibung aller Engine-Schichten (Klassifikation, Lifecycle, Evaluation, Adaptive ICR, Dose Recommendation, Pattern Detection) inkl. aller Schwellenwerte, Invarianten und Safety-Gates. D-007 in DECISIONS.md: begründet warum gewichteter k-NN-Ansatz statt LLM-only. |
| 2026-05-20 | Telegram-Bot Phase 1: Message-Bus + Notify-Script | 1214985739346044 | Supabase-Migration `20260520_agent_messages.sql` (agent_messages-Tabelle, RLS service-role-only), `scripts/notify-telegram.mjs` (ESM, Realtime-Subscription, 10-min-Timeout), npm-Script `telegram:notify` in package.json ergänzt. |
| 2026-05-20 | Keep the Engine algorithm doc automatically in sync when thresholds change | 422 | Alle numerischen Schwellenwerte aus evaluation.ts, recommendation.ts und adaptiveICR.ts als exportierte Konstanten herausgezogen (HYPO_THRESHOLD, SPIKE_CUTOFF_*, SAFETY_BG_MIN, MAX_DOSE_UNITS, DEFAULT_ICR/CF/TARGET, MIN_BUCKET_SAMPLES). docs/engine-algorithm.md mit Konstantennamen annotiert und einen maschinenlesbaren "## Threshold Index" ergänzt. scripts/check-engine-doc-thresholds.mjs prüft, ob die Werte in der Tabelle mit den exportierten Konstanten übereinstimmen; läuft via `pnpm run check:engine-doc`. D-008 in ## Decisions. |

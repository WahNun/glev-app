# AGENTS.md — Instructions for AI Coding Agents

This file is loaded by any AI agent working on this repository (Replit, Claude Code, Cursor, etc.). Read it before making any changes. Only append to existing sections or add new sections — never restructure.

## ⚠️ PROTECTED FILES — DO NOT DELETE

Removing any of these files without explicit Lucas approval (in a dedicated commit with explanation) breaks production builds, fails CI, and may break App Store submission:

- `ios/App/App/Info.plist` — iOS app metadata + usage descriptions
- `ios/App/App/PrivacyInfo.xcprivacy` — iOS 17+ Privacy Manifest (App Store submission requirement)
- `ios/App/App/App.entitlements` — iOS capabilities (HealthKit, Critical Alerts, Push)
- `ios/App/App/AppDelegate.swift` — iOS entry point
- `ios/App/App.xcodeproj/project.pbxproj` — Xcode project config
- `capacitor.config.ts` — Capacitor cross-platform config
- `DECISIONS.md` — Decision audit log (D-XXX entries + Fix Log table)
- `AGENTS.md` — this file
- `package.json` — npm dependencies
- `supabase/config.toml` — Supabase project config

CI check (`.github/workflows/required-files-check.yml`) blocks merges if any are missing.

## ⚠️ MANDATORY iOS STRINGS — DO NOT REMOVE

Inside `ios/App/App/Info.plist`:
- `NSHealthShareUsageDescription` — required for Apple Health read
- `NSHealthUpdateUsageDescription` — required for Apple Health write

Inside `ios/App/App/App.entitlements`:
- `com.apple.developer.healthkit` — required for Apple Health access
- `com.apple.developer.usernotifications.critical-alerts` — required for life-critical alarms

CI verifies these grep-matches on every push.

## HealthKit Conventions

Bei JEDEM `Health.requestAuthorization()` oder `Health.queryAggregated()` oder `Health.querySamples()` Call:

- Verwende DOMAIN-STRINGS, NICHT raw HKQuantityTypeIdentifier
- Richtig: `"steps"`, `"calories"`, `"glucose"`, `"weight"`, `"height"`
- Falsch: `"stepCount"`, `"activeEnergyBurned"`, `"bloodGlucose"`, `"bodyMass"`
- Bei neuen Datentypen: erst in `node_modules/@capgo/capacitor-health/ios/Plugin/HealthPlugin.swift` in der Funktion `parseTypesWithWorkouts` bzw. `parseSampleType` nachschauen welche string-keys das Plugin mapped
- Symptom bei falschen Strings: kein iOS-Permission-Dialog, requestAuthorization-Promise hängt OHNE Fehler

Begründung: am 2026-06-08 vier Builds und mehrere Stunden Debug verschwendet bevor diese Konvention klar wurde (siehe DECISIONS.md Fix-Log Eintrag vom selben Tag).

## DECISIONS.md Convention

After any code change, append a Fix Log entry at the END of the table (NOT at the top — to avoid merge conflicts with parallel writers):

| YYYY-MM-DD | [type]: short title | [marker] explanation, compliance note if any |

Marker is `[CC]` for Claude Code, `[RE]` for Replit, `[XC]` for Xcode-Claude, or your own identifier.

For architectural decisions, append a D-XXX entry to the `## Decisions` section (find the next available number, do not reuse).

## Compliance Wording (NEVER USE)

Glev is positioned as "Dokumentations-App, kein Medizinprodukt". Never use these words in UI text, copy, marketing, descriptions:

- "Insulinhilfe" / "insulin decision support" / "decision support"
- "Entscheidungshilfe" / "Therapieempfehlung" / "Diagnose"
- "Empfehlung" in a clinical/therapy context
- "Präzision" in a clinical context (e.g., "Bolus-Präzision")
- "stark" / "gut" / "schlecht" as judgment of therapy success

Use these instead:
- "Dokumentations-App" / "Tagebuch" / "Werkzeug"
- "Mahlzeiten loggen" / "CGM-Daten zusammenführen" / "Muster erkennen"
- "Konsistenz" / "Verlauf" / "Aufbau" / "stabil"

## Disallowed Workflows

- DO NOT run `supabase db push` (140 untracked migrations would catastrophically re-apply). Use Supabase MCP `apply_migration` per-file with verification.
- DO NOT force-push to main without Lucas approval.
- DO NOT auto-resolve merge conflicts. STOP and surface them to Lucas.
- DO NOT delete `ios/App/App/Resources/Sounds/*.wav` files (alarm sounds bundled for APNs).

## Required Approvals for Major Changes

- Schema migrations affecting `user_settings`, `meal_entries`, `cgm_samples`, `pro_subscriptions`, `cancellation_feedback`, `user_feedback` → require Lucas approval
- Capacitor plugin add/remove → require Lucas approval
- Public-facing Datenschutzerklärung / AGB / Impressum edits → require Lucas approval
- Apple Developer Portal capability changes → require Lucas approval
- Stripe webhook secret/key changes → require Lucas approval

## On Build Tooling

- Lucas's Mac uses pnpm; Replit uses npm. `ios/App/CapApp-SPM/Package.swift` gets rewritten on each `cap sync` per-machine. Do NOT commit machine-specific path changes to this file.
- After any Capacitor plugin addition that requires custom-class registration: the `capacitor.config.json` (gitignored, auto-generated) is the source of truth. The `packageClassList` in `capacitor.config.ts` is documentation only (Capacitor CLI ignores it).

## Reach Out

For questions, ambiguity, or anything that touches Lucas's strategic positioning: stop and ask. Better one extra Lucas-ping than one production regression.

---

End of AGENTS.md.

# AGENTS.md — Glev Agent Conventions

Dieses File dokumentiert Konventionen, die für alle Agents (Replit, Claude Code, etc.) gelten.
Nur append am Ende bestehender Sektionen oder neue Sektionen anhängen — niemals umstrukturieren.

---

## HealthKit Conventions

Bei JEDEM `Health.requestAuthorization()` oder `Health.queryAggregated()` oder `Health.querySamples()` Call:

- Verwende DOMAIN-STRINGS, NICHT raw HKQuantityTypeIdentifier
- Richtig: `"steps"`, `"calories"`, `"glucose"`, `"weight"`, `"height"`
- Falsch: `"stepCount"`, `"activeEnergyBurned"`, `"bloodGlucose"`, `"bodyMass"`
- Bei neuen Datentypen: erst in `node_modules/@capgo/capacitor-health/ios/Plugin/HealthPlugin.swift` in der Funktion `parseTypesWithWorkouts` bzw. `parseSampleType` nachschauen welche string-keys das Plugin mapped
- Symptom bei falschen Strings: kein iOS-Permission-Dialog, requestAuthorization-Promise hängt OHNE Fehler

Begründung: am 2026-06-08 vier Builds und mehrere Stunden Debug verschwendet bevor diese Konvention klar wurde (siehe DECISIONS.md Fix-Log Eintrag vom selben Tag).

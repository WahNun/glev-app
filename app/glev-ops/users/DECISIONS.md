# UsersTable — Decisions

## Sortierbare Spalten (2026-06-25)

**Sortierbare Spalten:** E-Mail, Name, Plan, Letzter Login, Angelegt.  
Status, CGM, Sprache, Currency, Land sind nicht sortierbar — zu wenig Mehrwert, zu viele Null-Werte.

**Null-Werte ans Ende** (unabhängig von asc/desc), damit fehlende Daten nie die Sortierung dominieren.

**Klick auf aktive Spalte** togglet asc ↔ desc. Klick auf neue Spalte setzt desc als Start (neueste zuerst = häufigster Use-case).

**Default:** `last_sign_in_at` desc — zeigt zuletzt aktive User oben.

**Sortierung clientseitig** auf dem bereits gefilterten Array — kein Server-Roundtrip nötig, da die Gesamtmenge durch `pageSize` begrenzt ist.

## cancelAndBan + clearManualPlan — vollständiger Override-Reset (2026-06-25)

**cancelAndBanAction:** Beim Sperren wurden `plan` und `subscription_status` zurückgesetzt, aber die vier `manual_plan_*`-Felder blieben stehen. Ein gebannter User hätte so weiterhin einen aktiven Override im Profil, der nach einem eventuellen Restore sofort wieder greifen würde. Fix: alle vier Felder (`manual_plan_override`, `manual_plan_expires_at`, `manual_plan_note`, `manual_plan_set_at`) im selben Update-Call auf `null` setzen.

**clearManualPlanAction:** `manual_plan_expires_at` wurde beim Löschen des Overrides nicht geleert — das Datum blieb stehen, obwohl kein Override mehr existierte. Fix: `manual_plan_expires_at: null` zum bestehenden Update-Patch ergänzt.

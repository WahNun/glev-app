# UsersTable — Decisions

## Sortierbare Spalten (2026-06-25)

**Sortierbare Spalten:** E-Mail, Name, Plan, Letzter Login, Angelegt.  
Status, CGM, Sprache, Currency, Land sind nicht sortierbar — zu wenig Mehrwert, zu viele Null-Werte.

**Null-Werte ans Ende** (unabhängig von asc/desc), damit fehlende Daten nie die Sortierung dominieren.

**Klick auf aktive Spalte** togglet asc ↔ desc. Klick auf neue Spalte setzt desc als Start (neueste zuerst = häufigster Use-case).

**Default:** `last_sign_in_at` desc — zeigt zuletzt aktive User oben.

**Sortierung clientseitig** auf dem bereits gefilterten Array — kein Server-Roundtrip nötig, da die Gesamtmenge durch `pageSize` begrenzt ist.

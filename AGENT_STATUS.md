# Agent Status

## Last Task: Compliance-Page (Datenschutz + AGB) + Footer-Link

**Done:**
- `app/legal/page.tsx` — neue Public-Page mit Tab-Switcher (Datenschutzerklärung + AGB), Inhalt 1:1 aus `attached_assets/datenschutzerklaerung_1777410421430.html` übernommen.
- CSS vollständig auf `.glev-legal`-Wrapper gescopt → keine Kollision mit `app/globals.css` Dark-Theme. Light-Theme der Compliance-Doku bleibt erhalten.
- Tab-State via `useState`, `window.scrollTo({top:0})` beim Wechsel (Parität zum Original-Script).
- Footer hat zusätzlich `Zurück zur Startseite`-Link.
- `app/page.tsx` Footer (L627-636): „Datenschutz · AGB" Link zwischen Copyright und „Brand", gleiches dezentes Styling (`color:inherit`, kein Underline, " · "-Trenner).
- `npx tsc --noEmit`: clean.
- Workflow restart: clean.
- `curl http://localhost:5000/legal`: HTTP 200, Content rendert (Datenschutzerklärung, Rechtliche Dokumente, glev-legal, tab-panel alle im HTML).

**Routen:**
- `/legal` (public, kein Auth) — Tabs: dse (default) / agb.

**Bewusst NICHT gemacht:**
- Kein Code-Review (statische Content-Page, keine Logik).
- Kein git push, kein deploy-Vorschlag (per Projekt-Vorgabe).
- Keine i18n-Integration — Compliance-Text ist DACH-spezifisch deutsch und sollte juristisch nicht über GPT/i18n übersetzt werden.

## Open / Pending (aus früheren Sessions)
- /insights, /entries, /history Audit
- PDF i18n review
- IOB-Berechnung review
- ICR/CF/targetBg in Postgres `user_settings` migrieren (aktuell nur localStorage — siehe vorheriger Diagnose-Report)
- Konsolidierung der zwei Bolus-Engines (`runGlevEngine` vs `recommendDose`)
- Stripe `STRIPE_BETA_PRICE_ID` in Vercel-Env fehlt

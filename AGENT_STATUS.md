# Agent Status

## Last Task: Dexcom Partnership Mockups (PNG)

**Done:**
- `scripts/generate-mockups.js` — Node-Script, generiert beide PNGs aus reinem Canvas-Code (keine Browser/Puppeteer).
- `public/mockup-consent-flow.png` — 390×780 (iPhone-Hochformat), Dark UI, Header mit Back-Arrow, glev-Wordmark, Karten „Welche Daten?" (Lock-Icon) und „Deine Rechte" (Clipboard-Icon), Primary-Button „Verbindung erlauben", Ghost-Button „Ablehnen", Footer „Datenschutz · AGB".
- `public/mockup-data-flow.png` — 900×500 (Querformat), Titel + Subtitle, 4 Boxen Row 1 (Dexcom Sensor → Dexcom Web API → Glev Backend → Supabase) mit beschrifteten Pfeilen, 1 Box Row 2 (Glev App) mit vertikalem Pfeil „WebSocket / Push" von Glev Backend, Legende unten rechts mit Lock-Icon „Alle Verbindungen TLS 1.3 · Daten verlassen die EU nicht".
- Beide Boxen-Style identisch zum Brief: bg `#1C1C28`, border `#4F6EF7` 2px, radius 10, padding 20.
- Verifiziert: `file public/mockup-*.png` → korrekte Dimensionen (390×780 + 900×500) und PNG-RGBA.

**Technische Abweichung:**
- User-Brief hat `npm install canvas` vorgegeben — schlug fehl wegen fehlender System-Libs (`libuuid.so.1`) auf NixOS. Switche auf `@napi-rs/canvas` (drop-in API, prebuilt Rust-Binaries, keine cairo/pango Pflicht). Funktional 1:1 äquivalent.
- Emoji-Icons (🔒, 📋) durch nativ gezeichnete Vektor-Shapes ersetzt — System hat keine Emoji-Fonts (nur DejaVu Sans), Emojis würden als Boxen rendern.

**DevDep:**
- `@napi-rs/canvas` als devDependency hinzugefügt (2 Pakete).

**Nicht gemacht:**
- Kein git push, kein Commit (per Brief: „Kein git add / commit nötig").
- Workflow-Restart hat zwischendurch Port-5000-Konflikt geworfen (alter Prozess hatte Port nicht freigegeben) — beim zweiten Restart sauber durchgelaufen.

## Open / Pending (aus früheren Sessions)
- /insights, /entries, /history Audit
- PDF i18n review
- IOB-Berechnung review
- ICR/CF/targetBg in Postgres `user_settings` migrieren (aktuell nur localStorage)
- Konsolidierung der zwei Bolus-Engines (`runGlevEngine` vs `recommendDose`)
- Stripe `STRIPE_BETA_PRICE_ID` in Vercel-Env fehlt

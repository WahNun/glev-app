STATUS: DONE (i18n Foundation + initiale String-Replacements)
LAST_DONE:
  Spec "Bilinguale App (DE/EN) mit next-intl" Schritte 1-7 (Schritt 7 partial — wizard-chrome only).
  Zwei technische Abweichungen von der Spec (mit Absicht):
    1. Spec wollte deprecated @supabase/auth-helpers-nextjs → habe stattdessen den existierenden lib/supabase.ts Singleton genutzt (basiert auf @supabase/ssr + @supabase/supabase-js).
    2. Spec's i18n.ts gab IMMER 'de' zurück → das wäre kaputt weil next-intl Messages server-side beim Request lädt; Client-Context allein wechselt die Sprache nicht. Habe stattdessen Cookie-basierte Locale-Source implementiert (NEXT_LOCALE Cookie, server liest in i18n/request.ts, Client setzt + reload bei Sprachwechsel).

  Konkret gemacht:
  ─── Foundation ───
  • supabase/migrations/20260427_add_profiles_language.sql → angewandt (profiles.language text DEFAULT 'de')
  • npm install next-intl
  • messages/de.json + messages/en.json mit nav/log/engine/history/settings/common namespaces (45+ keys)
  • i18n/request.ts → liest NEXT_LOCALE Cookie, default 'de', lädt entsprechendes JSON
  • next.config.ts → withNextIntl wrapper hinzu
  • app/layout.tsx → async, holt locale+messages server-side, wrappt children mit NextIntlClientProvider; html lang={locale} dynamisch
  • lib/locale.ts → setLocale(lang) helper: schreibt Cookie, persistiert in profiles.language, location.reload()
  • components/LanguageSync.tsx → mounted in protected layout; reconciliert beim Login DB-Sprache mit Cookie und reloadet falls divergent (Cross-Device-Sync)

  ─── UI ───
  • app/(protected)/settings/page.tsx → Sprache-Toggle Card als ERSTES Element im "settings" Tab. Zwei Buttons (🇩🇪 Deutsch / 🇬🇧 English), aktive Sprache hervorgehoben in ACCENT-Farbe. setCurrentLocale optimistisch + setLocale() trigger persist+reload.

  ─── String-Replacements ───
  • app/(protected)/log/page.tsx: title h1, STEP_KEYS array (statt hardcoded STEP_LABELS), pill aria-label, pill labels, chat_intro, alle 3 WizardNav nextLabel/primaryLabel/nextHint
  • components/Layout.tsx: 3 mobile-nav labels (Dashboard / History / Settings) → tNav("dashboard"|"history"|"settings")

  Bug während Implementation: de.json hatte invalid JSON in chat_placeholder weil ich „...„ mit normalen " als Schließzeichen gemixt habe. Sofort gefixt mit \" escapes. node JSON.parse jetzt clean auf beiden Files.

  tsc clean. Workflow restart. Ready zum Sprache-Toggeln.

NEXT (offen — separate Runden):
  a) USER testen: Settings → "settings" Tab → Englisch klicken → Reload → Pills/Nav/Buttons jetzt Englisch?
  b) Restliche /log-Strings: Field-Labels (Glukose vorher, Mahlzeit-Zeit, Carbs/Protein/Fat/Fiber/Calories), Klassifikations-Chip-Texte, "Speichere…" Toast, Korrektur-Bolus Sektion, Recommendation Card. Alle Reasoning-Strings (von runGlevEngine + GPT) bleiben absichtlich auf DE — die werden vom Engine generiert nicht aus Messages geholt.
  c) /history, /dashboard, /insights Strings — separate Runden
  d) Zwei NICHT-i18n-Restpunkte aus voriger Runde: /engine cleanen + /log?type=insulin/exercise Sub-Flow (von vor zwei Runden, noch offen)
  e) Push nach main (User-Auth erforderlich)

QUESTION:
  Sprache-Toggle in Settings testen? Wenn das funktioniert: alle Restpunkte (b-e) priorisieren?

TIMESTAMP: 23:46

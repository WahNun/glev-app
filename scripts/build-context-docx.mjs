import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  PageBreak,
  LevelFormat,
  convertInchesToTwip,
} from "docx";
import { writeFileSync, mkdirSync } from "node:fs";

const COLOR = {
  text: "1A1A1A",
  muted: "555555",
  accent: "1F3FA8",
  borderLight: "DDDDDD",
  shadeHeader: "EFEFF3",
  code: "F4F4F8",
};

const FONT = "Calibri";
const MONO = "Consolas";

const p = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: 120, line: 300 },
    ...opts,
    children: Array.isArray(text)
      ? text
      : [new TextRun({ text, font: FONT, size: 22, color: COLOR.text })],
  });

const h1 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [
      new TextRun({ text: t, bold: true, font: FONT, size: 36, color: COLOR.accent }),
    ],
  });

const h2 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [
      new TextRun({ text: t, bold: true, font: FONT, size: 28, color: COLOR.accent }),
    ],
  });

const h3 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [
      new TextRun({ text: t, bold: true, font: FONT, size: 24, color: COLOR.text }),
    ],
  });

const bullet = (parts, level = 0) =>
  new Paragraph({
    spacing: { after: 80, line: 280 },
    numbering: { reference: "bullets", level },
    children: Array.isArray(parts)
      ? parts
      : [new TextRun({ text: parts, font: FONT, size: 22, color: COLOR.text })],
  });

const numbered = (parts, level = 0) =>
  new Paragraph({
    spacing: { after: 80, line: 280 },
    numbering: { reference: "numbered", level },
    children: Array.isArray(parts)
      ? parts
      : [new TextRun({ text: parts, font: FONT, size: 22, color: COLOR.text })],
  });

const code = (text) =>
  text.split("\n").map(
    (line) =>
      new Paragraph({
        spacing: { after: 0, line: 260 },
        shading: { type: ShadingType.SOLID, color: COLOR.code, fill: COLOR.code },
        children: [
          new TextRun({ text: line || " ", font: MONO, size: 18, color: COLOR.text }),
        ],
      }),
  );

const inlineCode = (t) =>
  new TextRun({ text: t, font: MONO, size: 20, color: COLOR.text });
const txt = (t, opts = {}) =>
  new TextRun({ text: t, font: FONT, size: 22, color: COLOR.text, ...opts });
const bold = (t) => txt(t, { bold: true });

const cell = (children, opts = {}) =>
  new TableCell({
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    ...opts,
    children: Array.isArray(children) ? children : [p(children)],
  });

const headerCell = (text, width) =>
  new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: { type: ShadingType.SOLID, color: COLOR.shadeHeader, fill: COLOR.shadeHeader },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, font: FONT, size: 22, color: COLOR.text })],
      }),
    ],
  });

const simpleTable = (headers, rows, widths) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.borderLight },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.borderLight },
      left: { style: BorderStyle.SINGLE, size: 4, color: COLOR.borderLight },
      right: { style: BorderStyle.SINGLE, size: 4, color: COLOR.borderLight },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: COLOR.borderLight },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: COLOR.borderLight },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => headerCell(h, widths?.[i])),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c) => cell(c)),
          }),
      ),
    ],
  });

const cover = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 1200, after: 200 },
    children: [
      new TextRun({ text: "Glev", bold: true, font: FONT, size: 96, color: COLOR.accent }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: "Kontext-Report",
        bold: true,
        font: FONT,
        size: 44,
        color: COLOR.text,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [
      new TextRun({
        text: "Type-1-Diabetes Insulin Decision-Support",
        font: FONT,
        size: 26,
        color: COLOR.muted,
        italics: true,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [
      new TextRun({ text: "Stand: 24. April 2026", font: FONT, size: 22, color: COLOR.muted }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text:
          "Vollständiger Übergabe-Report an eine neue Claude-Instanz, die ohne Vorwissen einsteigt.",
        font: FONT,
        size: 22,
        color: COLOR.text,
        italics: true,
      }),
    ],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

const sec1 = [
  h1("1. Projektziel"),
  p([
    bold("Glev"),
    txt(
      " ist eine Entscheidungs\u00adhilfe-App f\u00fcr Menschen mit Typ-1-Diabetes. Sie unterst\u00fctzt das t\u00e4gliche Insulinmanagement, indem sie:",
    ),
  ]),
  numbered(
    "Mahlzeiten per Sprache oder Text erfasst, Makros (Kohlenhydrate, Protein, Fett, Ballaststoffe) per AI parst und dazu eine Insulindosis vorschl\u00e4gt.",
  ),
  numbered(
    "Glukosewerte vor und nach der Mahlzeit aufzeichnet und auswertet (GOOD / LOW / HIGH / SPIKE).",
  ),
  numbered(
    "Aus der Historie \u00e4hnlicher Mahlzeiten (\u201eGlev Engine\u201c) konkrete Dosis-Empfehlungen ableitet.",
  ),
  numbered(
    "Live-Glukosedaten von einem CGM-Sensor (Abbott FreeStyle Libre \u00fcber LibreLinkUp) anzeigt und automatisch in das Mahlzeitenprotokoll einf\u00fcllt.",
  ),
  p([
    txt(
      "Endnutzer ist aktuell prim\u00e4r der Eigent\u00fcmer Lucas; die App ist aber bereits so gebaut, dass weitere Nutzer sich registrieren und ihre eigenen Daten pflegen k\u00f6nnen. Live-Domain: ",
    ),
    inlineCode("https://glev.app"),
    txt(" (Vercel-Deployment)."),
  ]),
];

const sec2 = [
  h1("2. Technischer Stand"),
  h2("2.1 Stack"),
  simpleTable(
    ["Schicht", "Technologie", "Version"],
    [
      ["Runtime", "Node.js 24", "—"],
      ["Framework", "Next.js App Router (Turbopack)", "16.2.4"],
      ["Sprache", "TypeScript", "5.9"],
      ["UI", "React (Inline-Styles, kein Tailwind)", "19.1"],
      ["Auth + DB", "Supabase (Postgres + Auth)", "@supabase/supabase-js 2.104, @supabase/ssr 0.10"],
      [
        "AI",
        "OpenAI via Replit AI Integrations Proxy",
        "openai 6.34 — env: AI_INTEGRATIONS_OPENAI_*",
      ],
      ["Tabellen-Import", "Google Sheets API", "googleapis 171"],
      ["Drag & Drop", "dnd-kit core/sortable/utilities", "6.3 / 10 / 3.2"],
      ["HTTP", "axios (LibreLinkUp-Calls)", "1.15"],
      ["Hosting", "Vercel (Production)", "—"],
      ["Dev", "Replit Workspace, npm run dev", "Port 5000"],
    ],
    [22, 48, 30],
  ),
  p([
    bold("Wichtig: "),
    txt("Trotz veralteter Hinweise in "),
    inlineCode("replit.md"),
    txt(" ist das Projekt "),
    bold("kein pnpm-Monorepo"),
    txt(". Es ist eine "),
    bold("flache Next.js-App im Repo-Root"),
    txt(", "),
    bold("rein npm-basiert"),
    txt(". Pfade liegen unter "),
    inlineCode("app/"),
    txt(", "),
    inlineCode("components/"),
    txt(", "),
    inlineCode("lib/"),
    txt(" — nicht "),
    inlineCode("src/"),
    txt("."),
  ]),

  h2("2.2 Architektur"),
  ...code(`Repo-Root
\u251c\u2500 app/                       Next.js App Router
\u2502  \u251c\u2500 layout.tsx              Root-Layout (Viewport, <PreventZoom/>, Inter-Font)
\u2502  \u251c\u2500 globals.css             Globale Styles inkl. iOS-Zoom-Patches
\u2502  \u251c\u2500 page.tsx                Landing
\u2502  \u251c\u2500 login/                  Login + Signup
\u2502  \u251c\u2500 auth/
\u2502  \u2502  \u251c\u2500 callback/route.ts    GET-Handler: tauscht Supabase ?code=\u2026 gegen Session
\u2502  \u2502  \u2514\u2500 auth-error/page.tsx  Fallback nach gescheiterter E-Mail-Best\u00e4tigung
\u2502  \u251c\u2500 (protected)/            geschuetzte Routen (Middleware-Check)
\u2502  \u2502  \u251c\u2500 layout.tsx           Wrapper inkl. <CgmAutoFillProvider/>
\u2502  \u2502  \u251c\u2500 dashboard/page.tsx
\u2502  \u2502  \u251c\u2500 log/page.tsx
\u2502  \u2502  \u251c\u2500 entries/page.tsx
\u2502  \u2502  \u251c\u2500 insights/page.tsx
\u2502  \u2502  \u251c\u2500 engine/page.tsx
\u2502  \u2502  \u251c\u2500 import/page.tsx
\u2502  \u2502  \u2514\u2500 settings/page.tsx    Tabs: overview / settings / CGM / import
\u2502  \u251c\u2500 api/
\u2502  \u2502  \u251c\u2500 cgm/                 credentials, latest, history, status, _helpers.ts
\u2502  \u2502  \u251c\u2500 chat-macros, parse-food, transcribe   AI-Endpunkte
\u2502  \u2502  \u251c\u2500 import/sheets, sheets/sync, log       Google-Sheets-Sync
\u2502  \u2502  \u251c\u2500 preferences          Karten-Reihenfolge laden/speichern
\u2502  \u2502  \u2514\u2500 whoami, debug/*      Diagnose-Routen
\u2502  \u2514\u2500 mockups/dark-cockpit    UI-Sandbox (kein Insertion-Pfad)
\u251c\u2500 components/                React-Komponenten
\u251c\u2500 lib/                       Domain-Logik (meals, cgm, sheets, engine, ...)
\u251c\u2500 supabase/migrations/       SQL-Migrationen
\u251c\u2500 public/                    Icons, Manifest
\u251c\u2500 scripts/gen-icons.mjs      generiert Favicons/PWA-Icons aus icon.svg
\u2514\u2500 middleware.ts (proxy.ts)   schuetzt /(protected)/*`),

  h2("2.3 Datenbankschema (Supabase Postgres)"),
  h3("meals — Mahlzeiten (RLS aktiv)"),
  ...code(`id              uuid PK default gen_random_uuid()
user_id         uuid FK -> auth.users
input_text      text
parsed_json     jsonb     [{name, grams, carbs, protein, fat, fiber}, ...]
glucose_before  int4
glucose_after   int4
carbs_grams     int4
protein_grams   int4
fat_grams       int4
fiber_grams     int4
insulin_units   numeric(5,2)
meal_type       text      FAST_CARBS | HIGH_PROTEIN | HIGH_FAT | BALANCED
evaluation      text      GOOD | LOW | HIGH | SPIKE  (alt: OVERDOSE/UNDERDOSE rueckwaertskompatibel)
created_at      timestamptz default now()`),
  p([
    txt("Migration "),
    inlineCode("supabase/migrations/20260423_add_meal_macros.sql"),
    txt(" ergaenzt "),
    inlineCode("glucose_after, meal_type, protein_grams, fat_grams, fiber_grams"),
    txt(". Robust: "),
    inlineCode("lib/meals.ts:insertMealsWithFallback"),
    txt(
      " parst \u201emissing column\u201c-Fehler und droppt fehlende optionale Spalten automatisch.",
    ),
  ]),
  h3("cgm_credentials — verschluesselte LibreLinkUp-Zugangsdaten"),
  ...code(`user_id                       uuid PK -> auth.users
llu_email                     text
llu_password_encrypted        text     "iv:tag:ciphertext" (AES-256-GCM hex)
llu_region                    text     "eu" | "us"
cached_token                  text
cached_token_expires          timestamptz
cached_patient_id             text
cached_account_id_hash        text
updated_at                    timestamptz`),

  h3("user_preferences — Karten-Reihenfolge pro Nutzer"),
  ...code(`user_id                  uuid PK -> auth.users
dashboard_card_order     jsonb default '[]'
insights_card_order      jsonb default '[]'
updated_at               timestamptz`),
  p([
    bold("Achtung: "),
    txt(
      "Die SQL fuer diese Tabelle existiert in replit.md, muss aber vom Nutzer manuell im Supabase SQL-Editor ausgefuehrt werden. ",
    ),
    inlineCode("/api/preferences"),
    txt(" hat einen PGRST205-Fallback, der gracefully [] liefert solange die Tabelle fehlt."),
  ]),

  h2("2.4 Authentifizierung"),
  bullet("Supabase Email/Password."),
  bullet([
    bold("Browser-Client: "),
    inlineCode("lib/supabase.ts"),
    txt(" (singleton, NEXT_PUBLIC_SUPABASE_URL + _ANON_KEY)."),
  ]),
  bullet([
    bold("Server-Routen "),
    txt("("),
    inlineCode("api/cgm/*, auth/callback"),
    txt("): "),
    inlineCode("_helpers.ts \u2192 authenticate(req)"),
    txt(
      " versucht zuerst die Cookie-Session, faellt dann auf einen Authorization: Bearer <jwt>-Header zurueck. Damit funktioniert dieselbe Route fuer Web und kuenftige Mobile-Clients.",
    ),
  ]),
  bullet([
    inlineCode("lib/auth.ts \u2192 signUp"),
    txt(" setzt seit 24.04. "),
    inlineCode("options.emailRedirectTo = ${origin}/auth/callback"),
    txt("."),
  ]),
  bullet([
    bold("Service-Role-Operationen "),
    txt(
      "(Tabellen-Inserts unter Umgehung der RLS, nur nachdem der User-JWT verifiziert wurde): \u00fcber ",
    ),
    inlineCode("SUPABASE_SERVICE_ROLE_KEY"),
    txt("."),
  ]),
  bullet([
    bold("Geschuetzt: "),
    inlineCode("proxy.ts"),
    txt(" (vormals "),
    inlineCode("middleware.ts"),
    txt(" — Next 16 deprecated den Namen, Funktionalitaet identisch)."),
  ]),

  h2("2.5 AI-Integration"),
  bullet("Alle AI-Calls laufen ueber den Replit-Proxy (kein eigener OpenAI-Key in der App)."),
  bullet([
    inlineCode("POST /api/parse-food"),
    txt(
      " — Freitext / Audio-Transkript \u2192 strukturiertes Mahlzeiten-JSON mit Makros pro Lebensmittel.",
    ),
  ]),
  bullet([
    inlineCode("POST /api/transcribe"),
    txt(" — Audio \u2192 Text (Web-Speech-API serverseitig oder OpenAI Whisper-Fallback)."),
  ]),
  bullet([
    inlineCode("POST /api/chat-macros"),
    txt(" — interaktive Korrektur einzelner Makro-Werte."),
  ]),
  bullet([
    txt("Hilfsbibliothek: "),
    inlineCode("lib/ai/"),
    txt(" und "),
    inlineCode("lib/macroEnrich.ts"),
    txt("."),
  ]),

  h2("2.6 CGM-Anbindung (LibreLinkUp)"),
  p([txt("Vollstaendig serverseitig in "), inlineCode("lib/cgm/"), txt(":")]),
  bullet([
    bold("llu.ts"),
    txt(
      " — Axios-Client (Keep-Alive, 3s Timeout, 1\u00d7 Retry), Login mit Region-Redirect + ToU-Step, getLatest, getHistory. Zwei-stufiger Session-Cache: ",
    ),
    bold("L1"),
    txt(" in-process Map, "),
    bold("L2"),
    txt(" Spalten in cgm_credentials. Bei 401: beide Stufen leeren, einmal neu loggen, Call wiederholen."),
  ]),
  bullet([
    bold("crypto.ts"),
    txt(" — AES-256-GCM, Schluessel ueber env "),
    inlineCode("ENCRYPTION_KEY"),
    txt(" (32 Byte hex)."),
  ]),
  bullet([bold("supabase.ts"), txt(" — adminClient() (Service-Role), verifyJwt().")]),
  p([bold("Routen:")]),
  bullet([
    inlineCode("POST /api/cgm/credentials"),
    txt(
      " — Speichern + Verschluesseln (kein sofortiger Login \u2014 Login passiert lazy beim ersten getLatest/getHistory).",
    ),
  ]),
  bullet([inlineCode("DELETE /api/cgm/credentials"), txt(" — Zeile + L1-Cache loeschen.")]),
  bullet([inlineCode("GET /api/cgm/latest"), txt(" — letzter Wert.")]),
  bullet([inlineCode("GET /api/cgm/history"), txt(" — letzter Wert + 12h-Graph.")]),
  bullet([
    inlineCode("GET /api/cgm/status"),
    txt(" — "),
    bold("neu seit heute"),
    txt(": leichter Read auf llu_email + llu_region fuer die Settings-UI; ruft LLU "),
    bold("nicht"),
    txt(" auf."),
  ]),
  p([bold("Client-Konsumenten:")]),
  bullet([
    inlineCode("components/CgmFetchButton.tsx"),
    txt(" — manueller \u201ejetzt holen\u201c-Button im Log."),
  ]),
  bullet([inlineCode("components/CurrentDayGlucoseCard.tsx"), txt(" — Heute-Chart.")]),
  bullet([
    inlineCode("components/CgmAutoFillProvider.tsx"),
    txt(" + "),
    inlineCode("lib/postMealCgmAutoFill.ts"),
    txt(
      " — plant fuer jede frisch geloggte Mahlzeit setTimeout-Slots (60/90/120 min) und reconciliert beim Tab-Aktivieren mit der LLU-History (30 s Client-Cache, \u00b115 min Match-Fenster).",
    ),
  ]),
  bullet([
    inlineCode("components/CgmSettingsCard.tsx"),
    txt(" — "),
    bold("neu seit heute"),
    txt(": deutsche Settings-UI fuer Verbinden/Testen/Trennen."),
  ]),

  h2("2.7 Mobile / PWA"),
  bullet([
    inlineCode("app/layout.tsx"),
    txt(" setzt "),
    inlineCode("viewport.userScalable = false"),
    txt(", "),
    inlineCode("viewportFit = cover"),
    txt("."),
  ]),
  bullet([
    inlineCode("components/PreventZoom.tsx"),
    txt(
      " (im Root-Body) blockt iOS-Pinch-Zoom (gesturestart/change/end) und Doppel-Tap-Zoom (300 ms Touchend-Collapse). iOS Safari ignoriert ",
    ),
    inlineCode("user-scalable=no"),
    txt(" im Meta-Viewport seit iOS 10, daher der JS-Patch."),
  ]),
  bullet([
    inlineCode("globals.css"),
    txt(": "),
    inlineCode("touch-action: manipulation"),
    txt(", "),
    inlineCode("-webkit-text-size-adjust: 100%"),
    txt(", alle "),
    inlineCode("input/textarea/select"),
    txt(" haben "),
    inlineCode("font-size: 16px"),
    txt(" (verhindert iOS-Auto-Zoom on Focus)."),
  ]),
  bullet([
    inlineCode("app/(protected)/layout.tsx"),
    txt(" respektiert "),
    inlineCode("safe-area-inset-top"),
    txt(" fuer den Mobile-Header."),
  ]),
];

const sec3 = [
  h1("3. Offene Probleme / Challenges"),
  numbered([
    bold("user_preferences SQL nicht ausgefuehrt. "),
    txt(
      "Solange Lucas die in replit.md dokumentierte SQL nicht im Supabase-SQL-Editor laufen laesst, liefert /api/preferences immer []. Karten-Reihenfolge geht beim Reload verloren.",
    ),
  ]),
  numbered([
    bold("Diagnose-console.log "),
    txt(
      "in /api/cgm/credentials loggt Service-Role-Keylaenge bei jedem Aufruf. Vor staerkerem Roll-out entfernen.",
    ),
  ]),
  numbered([
    bold("Drei unabhaengige Client-Caller auf /api/cgm/* "),
    txt(
      "(CurrentDayGlucoseCard, CgmAutoFillProvider, CgmFetchButton) \u2014 kein gemeinsamer Cache. Bei Tab-Switching kann es zu drei parallelen LLU-Calls kommen. Nur postMealCgmAutoFill hat einen 30-s-Cache.",
    ),
  ]),
  numbered([
    bold("Kein Rate-Limit auf /api/cgm/*. "),
    txt(
      "LLU drosselt selbst (429), wird aktuell als generischer 502 LLU upstream 429 ausgeliefert \u2014 UI kann das nicht unterscheiden.",
    ),
  ]),
  numbered([
    bold("ENCRYPTION_KEY-Rotation nicht vorgesehen. "),
    txt(
      "Ciphertext-Format enthaelt keine Key-Version \u2192 Rotation = Re-Encrypt aller Zeilen in einem Schritt.",
    ),
  ]),
  numbered([
    bold("Single Source of Truth fuer Glukose: nur LLU. "),
    txt(
      "Kein Dexcom, kein Nightscout, kein BLE-Fallback. Wenn LLU down ist, sind alle Glukose-Features still tot.",
    ),
  ]),
  numbered([
    bold("Trend-Mapping "),
    txt(
      "in lib/cgm/llu.ts ignoriert LLU-Code 0 (unknown) \u2192 wird zu \u201estable\u201c gemappt, was irrefuehrend ist.",
    ),
  ]),
  numbered([
    bold("Stale replit.md "),
    txt(
      "\u2014 referenziert src/...-Pfade, pnpm-Monorepo, seedMealsIfEmpty. Nichts davon stimmt heute.",
    ),
  ]),
  numbered([
    bold("/auth/callback Supabase-Konfiguration: "),
    txt(
      "Lucas muss in Supabase Dashboard \u2192 Authentication \u2192 URL Configuration eintragen: Site URL = https://glev.app, Redirect URLs = https://glev.app/auth/callback. Solange das nicht gesetzt ist, landet der Verifizierungs-Link auf /auth/auth-error.",
    ),
  ]),
  numbered([
    bold("HOLD-Ticket aus frueherer Session: "),
    txt(
      "Falls in der urspruenglichen Roadmap noch ein drittes Issue existierte (\u201eGoogle Sheets service account auth\u201c), wurde der Spec abgeschnitten und das Feature ist nicht implementiert.",
    ),
  ]),
];

const sec4 = [
  h1("4. Getroffene Entscheidungen (juengste Session)"),
  bullet([
    bold("Logo: "),
    txt(
      "Erst Glukose-Tropfen-Variante als 2000\u00d72000 PNG erzeugt, auf Wunsch zur urspruenglichen Network-Graph-Variante zurueckgekehrt; alle Favicons/Touch-Icons via scripts/gen-icons.mjs neu generiert.",
    ),
  ]),
  bullet([
    bold("Karten-Reordering "),
    txt(
      "(Dashboard / Insights) per dnd-kit + Persistenz in user_preferences (Tabelle vom Nutzer manuell anzulegen).",
    ),
  ]),
  bullet([bold("Mobile-Zoom: "), txt("JS+CSS-Combo statt nur Meta-Viewport (iOS-Workaround).")]),
  bullet([
    bold("E-Mail-Bestaetigung: "),
    txt(
      "Eigener /auth/callback-Handler mit exchangeCodeForSession und sauberer Fehlerseite /auth/auth-error. signUp setzt emailRedirectTo automatisch auf den aktuellen Origin.",
    ),
  ]),
  bullet([
    bold("Auto-Seeding entfernt: "),
    inlineCode("seedMealsIfEmpty()"),
    txt(
      " wurde komplett geloescht und seine zwei Auto-Caller (dashboard/page.tsx, entries/page.tsx) entfernt. Grund: Bei neuen Nutzern wurden Lucas\u2019 persoenliche Mahlzeiten ungewollt eingespielt. Manueller Pfad bleibt: ",
    ),
    inlineCode("reloadHistoricalEntries()"),
    txt(" ueber Settings \u2192 Reload historical entries."),
  ]),
  bullet([
    bold("CGM-Settings-Tab "),
    txt(
      "(Settings \u2192 CGM): Vollstaendige deutsche UI mit Status-Karte, Form, Help-Block. Unterstuetzung fuer Dexcom/Nightscout sichtbar (disabled placeholders) \u2014 bewusst extensible.",
    ),
  ]),
  bullet([
    bold("Datenbank-Triggers: "),
    txt(
      "Per pg_trigger und pg_proc verifiziert, dass keine server-seitigen Trigger oder Funktionen Mahlzeiten einfuegen. Alle Inserts laufen aus dem App-Code.",
    ),
  ]),
  h2("Konventionen / Style"),
  bullet([
    bold("Inline-Styles "),
    txt(
      "statt CSS-Frameworks; gemeinsame Tokens (#09090B, #111117, #4F6EF7, #22D3A0, #FF2D78, #FF9500, rgba(255,255,255,0.08)).",
    ),
  ]),
  bullet([bold("Deutsch "), txt("fuer alle nutzerseitigen Texte (App ist primaer fuer Lucas).")]),
  bullet([
    bold("Server-Routen "),
    txt("immer "),
    inlineCode('runtime: "nodejs"'),
    txt(" + "),
    inlineCode('dynamic: "force-dynamic"'),
    txt(" (Supabase-Cookies + Crypto)."),
  ]),
  bullet([
    bold("Keine Geheimnisse im Client. "),
    txt("AES-Key, Service-Role-Key, OpenAI-Key sind alle server-only."),
  ]),
];

const sec5 = [
  h1("5. Naechste Schritte (zuletzt geplant)"),
  simpleTable(
    ["Prio", "Aufgabe"],
    [
      ["A", "Lucas: Supabase Dashboard URL Configuration setzen (Site URL + Redirect URL fuer /auth/callback)."],
      ["A", "Lucas: SQL fuer user_preferences (siehe replit.md) im Supabase SQL-Editor ausfuehren."],
      [
        "A",
        "Lucas: in der live-deployten App unter Settings \u2192 CGM echte LibreLinkUp-Follower-Zugangsdaten eingeben und \u201eVerbindung testen\u201c pruefen.",
      ],
      ["B", "Alten console.log in /api/cgm/credentials entfernen."],
      [
        "B",
        "Gemeinsamen Client-Cache fuer /api/cgm/history (z.B. SWR/React-Query oder Modul-Singleton) statt drei separater Fetches.",
      ],
      ["C", "replit.md aktualisieren (Pfade, npm vs. pnpm, geloeschte Funktionen)."],
      ["C", "LLU-Trend-Code 0 \u2192 eigenes \u201eunknown\u201c mappen, in der UI darstellen."],
      ["C", "Strategie fuer Key-Rotation und Fallback-CGM-Quellen."],
      [
        "Open",
        "Falls in der urspruenglichen Roadmap noch ein nicht spezifiziertes \u201eIssue 3\u201c verbleibt, muss es neu definiert werden. Im juengsten Spec-Anhang war es als \u201eGoogle Sheets service account auth\u201c angekuendigt, aber die Anweisungen waren abgeschnitten und wurden nicht nachgereicht.",
      ],
    ],
    [10, 90],
  ),
];

const sec6 = [
  h1("6. Wichtige Details & Spezifika"),
  h2("LibreLinkUp-API (inoffiziell, Reverse-Engineering)"),
  bullet([
    bold("Base URL: "),
    inlineCode("https://api-{region}.libreview.io"),
    txt(" (Regionen: eu, us, optional weitere \u2014 LLU sendet bei falscher Region einen redirect)."),
  ]),
  p([bold("App-Identifikations-Header (zwingend, sonst 401):")]),
  ...code(`product: llu.android
version: 4.16.0
Accept-Encoding: gzip`),
  p([bold("Endpunkte:")]),
  bullet([
    inlineCode("POST /llu/auth/login"),
    txt(
      " \u2014 Body {email, password}. Antwort kann step.type === \u201etou\u201c enthalten \u2192 POST /auth/continue/tou mit Bearer <ticket.token>.",
    ),
  ]),
  bullet([
    inlineCode("GET /llu/connections"),
    txt(" \u2014 Liste der gefolgten Patienten + jeweils letzter Glukosewert."),
  ]),
  bullet([
    inlineCode("GET /llu/connections/{patientId}/graph"),
    txt(" \u2014 letzter Wert + 12-h-Graph (5-Minuten-Aufloesung)."),
  ]),
  bullet([
    bold("Authed-Header: "),
    inlineCode("Authorization: Bearer <token>"),
    txt(", "),
    inlineCode("Account-Id: <sha256(user.id)>"),
    txt("."),
  ]),
  bullet("Ticket-Lifetime: ~50 Minuten; wir cachen expires und nutzen 60 s Sicherheitspuffer."),
  bullet([
    bold("Mess-Format: "),
    inlineCode("{ Value, ValueInMgPerDl, Timestamp, TrendArrow \u2208 {1..5} }"),
    txt(". TrendArrow-Mapping: 1=fallingQuickly, 2=falling, 3=stable, 4=rising, 5=risingQuickly."),
  ]),

  h2("Datenmodell ParsedFood"),
  ...code(
    `interface ParsedFood { name: string; grams: number; carbs: number; protein: number; fat: number; fiber: number; }`,
  ),
  p([
    txt("Wird in "),
    inlineCode("meals.parsed_json"),
    txt(
      " als Array gespeichert. Aggregierte Summen liegen zusaetzlich denormalisiert in carbs_grams, protein_grams, fat_grams, fiber_grams.",
    ),
  ]),

  h2("Engine-Heuristik"),
  bullet([
    txt("Sucht historische Mahlzeiten mit "),
    bold("\u00b112 g Carbs"),
    txt(" UND "),
    bold("\u00b135 mg/dL Glukose"),
    txt(" Aehnlichkeit."),
  ]),
  bullet([txt("\u22653 GOOD-Matches \u2192 "), bold("HIGH"), txt("-Confidence (historischer Mittelwert).")]),
  bullet([txt("1\u20132 Matches \u2192 "), bold("MEDIUM"), txt(" (gemischt).")]),
  bullet([txt("0 Matches \u2192 "), bold("LOW"), txt(" (reine ICR-Formel).")]),

  h2("Insulin-Formeln"),
  bullet([inlineCode("computeCalories(c, p, f) = 4\u00b7c + 4\u00b7p + 9\u00b7f"), txt(".")]),
  bullet([
    bold("classifyMeal: "),
    txt(
      "FAST_CARBS wenn carbs \u2265 45 g; sonst HIGH_PROTEIN (protein \u2265 25 g und dominant), HIGH_FAT (fat \u2265 20 g und dominant), sonst BALANCED.",
    ),
  ]),
  bullet([
    bold("computeEvaluation(carbs, units, glucoseBefore): "),
    inlineCode("estimated = carbs/15 + max(0,(glucose-110)/50)"),
    txt("; ratio = units/estimated. 0.65 \u2264 ratio \u2264 1.35 \u2192 GOOD; >1.35 \u2192 HIGH (Ueberdosis); <0.65 \u2192 LOW (Unterdosis)."),
  ]),

  h2("Erforderliche Environment-Variablen"),
  simpleTable(
    ["Variable", "Nutzung"],
    [
      ["NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY", "Browser-Supabase-Client"],
      ["SUPABASE_URL / SUPABASE_ANON_KEY", "Server-Routen (JWT-Verify)"],
      ["SUPABASE_SERVICE_ROLE_KEY", "Service-Role-Inserts (CGM-credentials, Preferences)"],
      ["ENCRYPTION_KEY", "AES-256-GCM (32 Byte hex) fuer LLU-Passwort"],
      ["AI_INTEGRATIONS_OPENAI_BASE_URL / _API_KEY", "OpenAI-Proxy fuer AI-Routen"],
      ["SESSION_SECRET", "Vorgesehen (env vorhanden), aktuell nicht aktiv genutzt"],
      ["Google-Sheets", "ueber Replit-Connector google-sheet (kein App-Secret)"],
    ],
    [40, 60],
  ),

  h2("Workflow / Build"),
  bullet([
    txt("Replit-Workflow \u201eStart application\u201c = "),
    inlineCode("npm run dev"),
    txt(" (Port 5000)."),
  ]),
  bullet([bold("Type-Check: "), inlineCode("npx tsc --noEmit"), txt(" (~30 s, sauber).")]),
  bullet([
    bold("Build: "),
    inlineCode("npm run build"),
    txt(" (Turbopack), erzeugt 28 Routen, davon 11 statisch."),
  ]),
  bullet([
    bold("Auto-Checkpoint: "),
    txt(
      "Replit committet automatisch nach jedem Agenten-Turn auf den lokalen Branch. Push nach GitHub (fuer Vercel-Deploy) macht der Nutzer manuell aus dem Git-Pane. Der Agent darf kein git commit/push/reset direkt ausfuehren \u2014 destruktive Git-Ops muessen ueber Project Tasks delegiert werden.",
    ),
  ]),
];

const sec7 = [
  h1("7. Codestand"),
  h2("Existiert und funktioniert"),
  bullet("Vollstaendiger App-Flow: Signup \u2192 E-Mail-Bestaetigung \u2192 Dashboard \u2192 Logging \u2192 Entries \u2192 Insights \u2192 Engine \u2192 Settings."),
  bullet("AI-Mahlzeitenerfassung (Voice + Text) mit Makro-Aufschluesselung."),
  bullet("CGM-Komplettpfad (Credentials speichern, Latest/History-Reads, Auto-Fill nach Mahlzeit)."),
  bullet("Karten-Reordering mit Server-Persistenz (Code fertig; Tabelle muss noch angelegt werden)."),
  bullet("Google-Sheets-Import + Sync (manuell ueber /import oder Settings \u2192 Import)."),
  bullet("Mobile-Optimierung: Zoom-Block, Safe-Area, 16px-Inputs."),
  bullet("Email-Confirmation-Callback."),
  bullet("CGM-Settings-Tab mit allen drei Workflows (verbinden / testen / trennen)."),
  bullet("Build clean, TypeScript clean."),

  h2("Fehlt / TODO"),
  bullet([bold("user_preferences-Tabelle "), txt("in der Supabase-DB nicht angelegt (Code wartet darauf).")]),
  bullet([bold("Supabase-Dashboard URL Configuration "), txt("fuer Production-Domain glev.app nicht gesetzt.")]),
  bullet([
    bold("Diagnose-console.log "),
    txt("in /api/cgm/credentials/route.ts (Service-Role-Key-Laenge) noch drin."),
  ]),
  bullet("Kein gemeinsamer Client-Cache fuer CGM-Fetches."),
  bullet("Keine Tests (Unit/E2E)."),
  bullet("Kein Rate-Limit / Throttling auf API-Routen."),
  bullet([inlineCode("replit.md"), txt(" veraltet (referenziert src/, pnpm, geloeschte Seed-Funktion).")]),
  bullet(
    "Kein Fallback fuer CGM (Dexcom/Nightscout sind als \u201ecoming soon\u201c-Placeholder in der UI sichtbar).",
  ),
  bullet(
    "Falls aus dem urspruenglichen 3-Issue-Spec ein drittes Issue offen war (\u201eGoogle Sheets service account auth\u201c), wurde der Spec abgeschnitten und das Feature ist nicht implementiert.",
  ),

  h2("Zentrale Source-Files (wichtig fuer eine Folge-Instanz)"),
  simpleTable(
    ["Datei", "Zweck"],
    [
      ["app/layout.tsx", "Root-Layout, Viewport, PreventZoom-Mount"],
      ["app/globals.css", "iOS-Patches"],
      ["app/(protected)/layout.tsx", "Protected-Wrapper, mountet <CgmAutoFillProvider/>"],
      ["app/(protected)/settings/page.tsx", "Tab-Settings (overview/settings/CGM/import)"],
      ["components/CgmSettingsCard.tsx", "CGM-UI"],
      ["components/CgmAutoFillProvider.tsx", "Background-Reconcile"],
      ["components/PreventZoom.tsx", "iOS-Zoom-Block"],
      ["lib/cgm/llu.ts", "LibreLinkUp-Client + Session-Cache"],
      ["lib/cgm/crypto.ts", "AES-GCM-Helpers"],
      ["lib/cgm/supabase.ts", "adminClient + verifyJwt"],
      ["lib/postMealCgmAutoFill.ts", "Timer + History-Reconcile-Logik"],
      [
        "lib/meals.ts",
        "Mahlzeit-CRUD, Klassifikation, Eval, reloadHistoricalEntries (manuell), HISTORICAL_SEEDS (statische Lucas-Daten)",
      ],
      ["lib/auth.ts", "signUp/signIn/signOut (mit emailRedirectTo)"],
      ["lib/sheets.ts", "Google-Sheets-Adapter"],
      ["app/api/cgm/_helpers.ts", "authenticate() + errResponse()"],
      ["app/auth/callback/route.ts", "Supabase code-exchange"],
      ["app/auth/auth-error/page.tsx", "Fehlerseite"],
      ["proxy.ts (vorm. middleware.ts)", "Route-Protection"],
    ],
    [38, 62],
  ),
];

const tldr = [
  h1("Zusammengefasst fuer die naechste Instanz"),
  new Paragraph({
    spacing: { after: 120, line: 320 },
    shading: { type: ShadingType.SOLID, color: "F6F8FF", fill: "F6F8FF" },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: COLOR.accent, space: 6 },
    },
    children: [
      txt("Du uebernimmst "),
      bold("Glev"),
      txt(
        " \u2014 eine Next.js-16-App im Repo-Root (npm, Port 5000), deployed auf glev.app via Vercel. Backend = Supabase + OpenAI-Proxy + LibreLinkUp. Letzte Themenbloecke: Mobile-iOS-Zoom-Fix, Email-Confirmation-Callback, Bug-Fix gegen versehentliches Auto-Seeding fremder Mahlzeiten, neue ",
      ),
      bold("CGM-Settings-Tab"),
      txt(
        ". Direkt anstehend: Lucas muss zwei manuelle Setup-Schritte erledigen (Supabase Auth-URLs setzen, user_preferences-SQL ausfuehren), dann live mit echten LLU-Daten testen. Groesste unausgesprochene Baustelle: das im letzten Spec-Anhang abgeschnittene ",
      ),
      bold("Google Sheets service account auth"),
      txt("-Issue \u2014 bitte beim Nutzer rueckfragen, falls relevant. Beachte: "),
      bold("Niemals direkt git commit/push ausfuehren"),
      txt(", der Workspace uebernimmt Auto-Checkpoints, der Nutzer macht den Push selbst."),
    ],
  }),
];

const doc = new Document({
  creator: "Glev",
  title: "Glev Kontext-Report",
  description: "Uebergabe-Report fuer eine neue Claude-Instanz",
  styles: {
    default: {
      document: { run: { font: FONT, size: 22 } },
    },
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.2) } },
            },
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: "\u25E6",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: convertInchesToTwip(0.6), hanging: convertInchesToTwip(0.2) } },
            },
          },
        ],
      },
      {
        reference: "numbered",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } },
            },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.9),
            bottom: convertInchesToTwip(0.9),
            left: convertInchesToTwip(0.9),
            right: convertInchesToTwip(0.9),
          },
        },
      },
      children: [
        ...cover,
        ...sec1,
        ...sec2,
        ...sec3,
        ...sec4,
        ...sec5,
        ...sec6,
        ...sec7,
        ...tldr,
      ],
    },
  ],
});

const buf = await Packer.toBuffer(doc);
mkdirSync("exports", { recursive: true });
const out = "exports/glev-kontext-report.docx";
writeFileSync(out, buf);
console.log("wrote", out, buf.length, "bytes");

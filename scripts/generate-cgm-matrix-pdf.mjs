import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, renderToFile } from '@react-pdf/renderer';
import path from 'node:path';

// Brand wordmark — the proper "glev." with the green dot. Lucas'
// hard requirement: never render the brand as plain text again. We
// load the white variant from public/help-assets/ (copied from the
// brand-book PNG attached on 2026-05-15).
const LOGO_PATH = path.resolve('public/help-assets/glev-wordmark-white.png');

// Brand tokens (BB v1 · April 2026)
const BRAND = '#4F6EF7';
const PAGE_BG = '#09090B';
const SURFACE = '#111117';
const SURFACE_ALT = '#141420';
const T_PRIMARY = '#FFFFFF';
const T_STRONG = '#FFFFFFD9';
const T_SECONDARY = '#FFFFFFBF';
const T_MUTED = '#FFFFFF80';
const T_TERTIARY = '#FFFFFF59';
const BORDER = '#FFFFFF14';
const SANS = 'Helvetica';
const SANS_B = 'Helvetica-Bold';
const MONO = 'Courier';

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 36, fontSize: 9.5, color: T_STRONG, fontFamily: SANS, lineHeight: 1.45, backgroundColor: PAGE_BG },

  hdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  // Wordmark logo — keep aspect ratio (source PNG 720×253, ratio
  // ~2.85). Height 18 → width 51.3, fits cleanly in the header band
  // alongside the right-aligned meta date.
  logo: { width: 51, height: 18 },
  hdrMeta: { fontFamily: MONO, fontSize: 8, color: T_TERTIARY },

  // h1: explicit lineHeight 1.18 + larger marginBottom prevent the
  // descenders of the title from colliding with the first line of
  // sub (the 1.45 page default + tight letterSpacing made react-pdf
  // collapse the title's vertical box, the bug Lucas flagged with
  // the screenshot from 2026-05-15).
  h1: { fontFamily: SANS_B, fontSize: 26, color: T_PRIMARY, letterSpacing: -0.6, lineHeight: 1.18, marginBottom: 14 },
  sub: { fontSize: 11, color: T_SECONDARY, marginTop: 4, marginBottom: 22, lineHeight: 1.55 },

  h2: { fontFamily: SANS_B, fontSize: 13, color: T_PRIMARY, marginTop: 10, marginBottom: 8, letterSpacing: -0.2, lineHeight: 1.25 },
  kicker: { fontFamily: SANS_B, fontSize: 8.5, color: BRAND, letterSpacing: 1.5, marginBottom: 6 },

  card: { backgroundColor: SURFACE, borderRadius: 6, padding: 0, overflow: 'hidden', marginBottom: 4 },
  trH: { flexDirection: 'row', backgroundColor: SURFACE_ALT, paddingVertical: 8, paddingHorizontal: 8, borderBottom: `1pt solid ${BORDER}` },
  tr:  { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, borderBottom: `0.5pt solid ${BORDER}`, minHeight: 22 },
  th:  { fontFamily: SANS_B, fontSize: 7.5, color: T_MUTED, letterSpacing: 1 },
  td:  { fontSize: 8.5, color: T_STRONG, paddingRight: 4 },
  tdStrong: { fontFamily: SANS_B, fontSize: 8.5, color: T_PRIMARY, paddingRight: 4 },
  tdMono: { fontFamily: MONO, fontSize: 8.5, color: T_PRIMARY, paddingRight: 4 },

  // 5-column layout: Sensor | Quell-App | Glev-Quelle | Wert alle | Wann ist er sichtbar
  c1: { width: '13%' },
  c2: { width: '24%' },
  c3: { width: '14%' },
  c4: { width: '14%' },
  c5: { width: '35%' },

  callout: { backgroundColor: SURFACE, borderLeft: `2pt solid ${BRAND}`, padding: 10, marginTop: 12, marginBottom: 8, fontSize: 9.5, color: T_STRONG, borderRadius: 3, lineHeight: 1.55 },

  srcCard: { backgroundColor: SURFACE, borderRadius: 6, padding: 12, marginBottom: 8, borderLeft: `2pt solid ${BRAND}` },
  srcLabel: { fontFamily: SANS_B, fontSize: 10.5, color: T_PRIMARY, marginBottom: 4, letterSpacing: -0.1 },
  srcBody: { fontSize: 9.5, color: T_SECONDARY, lineHeight: 1.55 },

  bullet: { flexDirection: 'row', marginBottom: 5 },
  bulletDot: { width: 12, color: BRAND, fontSize: 10, fontFamily: SANS_B },
  bulletText: { flex: 1, fontSize: 9.5, color: T_STRONG, lineHeight: 1.5 },

  helpRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  helpKey: { width: '22%', fontFamily: SANS_B, fontSize: 9.5, color: BRAND },
  helpVal: { flex: 1, fontSize: 9.5, color: T_STRONG, lineHeight: 1.5 },

  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, paddingTop: 8 },
  footerLine1: { fontSize: 7.5, color: T_TERTIARY, marginBottom: 2 },
  footerLine2: { fontSize: 7, color: T_MUTED, lineHeight: 1.4 },
});

const Cell = (text, base, w, key) => React.createElement(Text, { style: [base, w], key }, text);

const TableRow = (cols, i) => React.createElement(View, { style: s.tr, key: `r${i}`, wrap: false }, [
  Cell(cols[0], s.tdStrong, s.c1, 'a'),
  Cell(cols[1], s.td,       s.c2, 'b'),
  Cell(cols[2], s.tdStrong, s.c3, 'c'),
  Cell(cols[3], s.tdMono,   s.c4, 'd'),
  Cell(cols[4], s.td,       s.c5, 'e'),
]);

const Bullet = (txt, k) => React.createElement(View, { style: s.bullet, key: k }, [
  React.createElement(Text, { style: s.bulletDot, key: 'd' }, '•'),
  React.createElement(Text, { style: s.bulletText, key: 't' }, txt),
]);

const SrcCard = (label, body, k) => React.createElement(View, { style: s.srcCard, key: k, wrap: false }, [
  React.createElement(Text, { style: s.srcLabel, key: 'l' }, label),
  React.createElement(Text, { style: s.srcBody, key: 'b' }, body),
]);

const HelpRow = (k, v, key) => React.createElement(View, { style: s.helpRow, key }, [
  React.createElement(Text, { style: s.helpKey, key: 'k' }, k),
  React.createElement(Text, { style: s.helpVal, key: 'v' }, v),
]);

// ---------- CONTENT (DE) ----------
const DE = {
  metaRight: 'v3 · 15.05.2026',
  h1: 'Wie kommen deine Glukose-Werte in Glev?',
  sub: 'Glev liest deinen Sensor nicht selbst aus. Es bekommt die Werte von einer App auf deinem Handy. Welche App du nutzt, entscheidet, wie oft du in Glev einen neuen Wert siehst.',
  kicker: 'HILFE · CGM-QUELLEN',
  th2a: 'Übersicht: was passt zu deinem Setup?',
  thCols: ['SENSOR', 'APP AUF DEM HANDY', 'GLEV-QUELLE', 'NEUER WERT', 'WAS DU SIEHST'],
  rows: [
    ['Libre 2',       'LibreLink',                       'LLU',          'alle ~2 min', 'Live-Wert von Abbott alle 2 Minuten + 12h Backfill in 15-Min-Schritten. Sehr kurze Tiefs unter 2 min können fehlen.'],
    ['Libre 2',       'xDrip4iOS / iAPS / Loop',         'Apple Health', 'jede Minute', 'Lückenlose Kurve in Echtzeit.'],
    ['Libre 2',       'xDrip4iOS / iAPS / Loop',         'Nightscout',   'jede Minute', 'Lückenlose Kurve in Echtzeit.'],
    ['Libre 3',       'LibreLink (Deutschland)',         'LLU',          'alle ~2 min', 'Wie Libre 2: Live-Wert alle ~2 Minuten + 15-Min-Backfill.'],
    ['Libre 3',       'xDrip4iOS / Juggluco',            'Health od. NS','jede Minute', 'Lückenlose Kurve in Echtzeit.'],
    ['Dexcom G6',     'Dexcom-App',                      'Apple Health', 'alle 5 min',  'Sehr gute Auflösung — der Sensor selbst misst nur alle 5 Minuten.'],
    ['Dexcom G7',     'Dexcom-App',                      'Apple Health', 'alle 5 min',  'Wie G6. G7 ist nur kleiner und schneller einsatzbereit, nicht „genauer".'],
    ['Dexcom G6/G7',  'Loop / Loop Follow / xDrip',      'Nightscout',   'alle 5 min',  'Wie über Apple Health, nur via Nightscout-Server.'],
    ['Medtronic Guardian 3/4', 'Guardian Connect + CareLink-Bridge', 'Nightscout', 'alle 5 min', 'Funktioniert nur über eine kleine Bridge-Software (carelink-uploader o. ä.) zu Nightscout.'],
    ['Medtronic Simplera',     'Simplera-App + CareLink-Bridge',     'Nightscout', 'alle 5 min', 'Wie Guardian: Bridge nötig, dann saubere 5-Minuten-Werte.'],
    ['Medtronic 770G/780G',    'CareLink (Pumpe als Quelle)',        'Nightscout', 'alle 5 min', 'Pumpen-Werte fließen über CareLink → Bridge → Nightscout. Latenz oft 10-15 min.'],
  ],
  callout: 'Glev holt sich seit Mai 2026 alle 2 Minuten neue Werte von deiner Quelle (vorher alle 5). Bei LLU speichert Glev jetzt zusätzlich den Live-Wert aus jedem Poll — Libre-Nutzer sehen damit alle ~2 Minuten einen frischen Punkt statt nur alle 15 Minuten. Apple Health und Nightscout liefern weiterhin in der Auflösung deiner Quell-App.',
  th2b: 'Die drei Glev-Quellen, einfach erklärt',
  src: [
    ['1. LLU — der einfachste Weg (Live-Wert alle ~2 min)',
     'LLU steht für „LibreLinkUp", die kostenlose Familien-App von Abbott. Du fügst Glev wie ein Familienmitglied hinzu und Glev darf deine Werte mitlesen. Vorteil: keine extra Software, in 5 Minuten eingerichtet. Seit Mai 2026 holt Glev alle 2 Minuten den aktuellen Live-Wert von Abbott ab und speichert ihn — du siehst also fast in Echtzeit was passiert. Plus die letzten 12 Stunden als Backfill in 15-Min-Schritten. Nachteil: ganz kurze Hypos unter 2 Minuten zwischen zwei Polls bleiben unsichtbar; im historischen Backfill bleibt die Auflösung 15 Minuten.'],
    ['2. Apple Health — die beste Auflösung auf dem iPhone',
     'Apple Health ist die Gesundheits-App von Apple, die alle deine Apps gemeinsam nutzen können. Eine andere App (z. B. xDrip oder die Dexcom-App) liest deinen Sensor live aus und legt jeden Wert in Apple Health ab. Glev liest die Werte von dort. Vorteil: jeder Wert ist sofort da, lückenlos, ohne Cloud-Umweg. Nachteil: nur auf dem iPhone, du musst einmal die andere App einrichten und Glev die Berechtigung geben.'],
    ['3. Nightscout — die offene Lösung für iPhone und Android',
     'Nightscout ist ein kleiner Server, den du dir selbst (oder mit Hilfe der Diabetes-Community) einmalig aufsetzt. Eine Uploader-App auf deinem Handy schickt deine Werte dorthin, Glev liest sie ab. Vorteil: funktioniert auf iPhone und Android und du hast deine Daten unter Kontrolle. Nachteil: einmalig 2-4 Stunden Einrichtung. Ideal wenn du schon mit Loop, AAPS oder xDrip arbeitest.'],
  ],
  th2c: 'Gut zu wissen',
  bullets: [
    'Wenn du in Deutschland einen Libre 2 oder Libre 3 hast und nur die LibreLink-App nutzt, hast du seit Mai 2026 in Glev fast Echtzeit-Werte (alle ~2 Minuten ein frischer Live-Punkt). Der historische Backfill bleibt aber in 15-Minuten-Schritten — wenn du dir alte Tage anschaust, siehst du keine Sub-15-Minuten-Tiefs.',
    'Dexcom-Sensoren messen prinzipbedingt alle 5 Minuten — egal welchen Weg du wählst. Das ist eine Hardware-Eigenschaft, keine Software-Einstellung.',
    'Medtronic-Nutzer: Glev hat aktuell keinen Direkt-Anschluss an CareLink (Medtronics Cloud). Realistisch ist Nightscout über eine kleine Bridge-Software wie carelink-uploader (Docker / Synology) oder 600SeriesAndroidUploader. Wer schon mit AndroidAPS oder Loop arbeitet hat das meist sowieso laufen. Wenn du Hilfe beim Setup brauchst, schreib uns an hello@glev.app.',
    'Manuelle Fingerstick-Werte, die du in Glev einträgst, werden immer berücksichtigt und im Diagramm als kleines Quadrat markiert. Wenn du auf LLU bist und einen Verdacht auf Unterzucker hast, miss kurz mit dem Finger und trage es ein.',
    'Die Hypo-Erkennung in Insights kann nur das zählen, was sie sieht. Live-LLU-Werte (alle ~2 min) erwischen die meisten Tiefs; im 15-Minuten-Backfill werden nur Tiefs erfasst, die mindestens 15 Minuten dauern oder zufällig auf einen Messpunkt fallen.',
    'Die Glev-Engine arbeitet mit allen drei Quellen gleich gut — sie nutzt für Empfehlungen den Wert, der zur Mahlzeit am nächsten dran liegt.',
  ],
  th2d: 'Welche Quelle passt zu dir?',
  help: [
    ['LLU',          'Du willst loslegen ohne Bastelei. Seit Mai 2026 fast in Echtzeit (~2-Min-Live-Werte). Klassisch und einfachster Weg für DACH-Libre-Nutzer.'],
    ['Apple Health', 'Du hast ein iPhone und nutzt schon eine Live-App wie xDrip, Loop, iAPS oder die Dexcom-App. Beste Kombination aus Komfort und Auflösung.'],
    ['Nightscout',   'Du hast Android (oder willst plattformunabhängig sein), bist technikaffin oder läufst sowieso schon mit Loop/AAPS/xDrip. Volle Datenhoheit.'],
  ],
  footer1: 'Glev · Hilfe · CGM-Quellen · Stand 15.05.2026',
  footer2: 'Glev ist ein Dokumentations- und Organisations-Tool, kein Medizinprodukt. Therapieentscheidungen triffst du gemeinsam mit deinem Arzt. · hello@glev.app',
};

// ---------- CONTENT (EN) ----------
const EN = {
  metaRight: 'v3 · 2026-05-15',
  h1: 'How your glucose values reach Glev',
  sub: "Glev doesn't read your sensor directly. It picks up the values from another app on your phone. Which app you use decides how often you see a new value in Glev.",
  kicker: 'HELP · CGM SOURCES',
  th2a: 'Overview: what fits your setup?',
  thCols: ['SENSOR', 'APP ON YOUR PHONE', 'GLEV SOURCE', 'NEW VALUE', 'WHAT YOU SEE'],
  rows: [
    ['Libre 2',       'LibreLink',                       'LLU',          'every ~2 min','Live value from Abbott every 2 min + 12h backfill in 15-min steps. Very short lows under 2 min can be missed.'],
    ['Libre 2',       'xDrip4iOS / iAPS / Loop',         'Apple Health', 'every minute','Smooth, gap-free curve in real time.'],
    ['Libre 2',       'xDrip4iOS / iAPS / Loop',         'Nightscout',   'every minute','Smooth, gap-free curve in real time.'],
    ['Libre 3',       'LibreLink (DACH)',                'LLU',          'every ~2 min','Same as Libre 2: live value every ~2 min + 15-min backfill.'],
    ['Libre 3',       'xDrip4iOS / Juggluco',            'Health or NS', 'every minute','Smooth, gap-free curve in real time.'],
    ['Dexcom G6',     'Dexcom app',                      'Apple Health', 'every 5 min', 'Very good resolution — the sensor itself only measures every 5 minutes.'],
    ['Dexcom G7',     'Dexcom app',                      'Apple Health', 'every 5 min', 'Same as G6. G7 is only smaller and faster to warm up, not "more accurate".'],
    ['Dexcom G6/G7',  'Loop / Loop Follow / xDrip',      'Nightscout',   'every 5 min', 'Same as via Apple Health, but through a Nightscout server.'],
    ['Medtronic Guardian 3/4', 'Guardian Connect + CareLink bridge', 'Nightscout', 'every 5 min', 'Only works via a small bridge tool (carelink-uploader or similar) into Nightscout.'],
    ['Medtronic Simplera',     'Simplera app + CareLink bridge',     'Nightscout', 'every 5 min', 'Same as Guardian: bridge needed, then clean 5-minute values.'],
    ['Medtronic 770G/780G',    'CareLink (pump as source)',          'Nightscout', 'every 5 min', 'Pump values flow via CareLink → bridge → Nightscout. Latency often 10-15 min.'],
  ],
  callout: "Since May 2026 Glev pulls new values from your source every 2 minutes (used to be every 5). For LLU, Glev now also stores the live value from each poll — Libre users see a fresh point every ~2 minutes instead of only every 15. Apple Health and Nightscout keep delivering at whatever resolution your source app produces.",
  th2b: 'The three Glev sources, plain English',
  src: [
    ['1. LLU — the easiest path (live value every ~2 min)',
     "LLU stands for \"LibreLinkUp\", Abbott's free family app. You add Glev like a family member and Glev gets to read your values along with you. Upside: no extra software, set up in 5 minutes. Since May 2026 Glev pulls Abbott's live value every 2 minutes and stores it — so you see what's happening almost in real time. Plus the last 12 hours as backfill in 15-min steps. Downside: very short hypos under 2 min between two polls stay invisible; the historical backfill stays at 15-minute resolution."],
    ['2. Apple Health — the best resolution on iPhone',
     "Apple Health is Apple's health app that all your apps can share. Another app (e.g. xDrip or the Dexcom app) reads your sensor live and stores every value in Apple Health. Glev reads the values from there. Upside: every value arrives instantly, gap-free, no cloud detour. Downside: iPhone only, you have to set up the other app once and grant Glev permission."],
    ['3. Nightscout — the open solution for iPhone and Android',
     'Nightscout is a small server that you (or someone from the diabetes community) sets up once. An uploader app on your phone sends your values there, Glev reads them. Upside: works on iPhone and Android and you stay in control of your data. Downside: 2-4 hours of one-time setup. Ideal if you already use Loop, AAPS or xDrip.'],
  ],
  th2c: 'Good to know',
  bullets: [
    "If you're in Germany/Austria/Switzerland with a Libre 2 or Libre 3 and only use the LibreLink app, since May 2026 you get near real-time values in Glev (a fresh live point every ~2 minutes). The historical backfill still runs at 15-minute steps though — when you look at past days you won't see sub-15-minute lows.",
    "Dexcom sensors only measure every 5 minutes by design — no matter which path you choose. That's a hardware property, not a software setting.",
    "Medtronic users: Glev currently has no direct connection to CareLink (Medtronic's cloud). The realistic path is Nightscout via a small bridge tool like carelink-uploader (Docker / Synology) or 600SeriesAndroidUploader. If you already run AndroidAPS or Loop you most likely have this in place. Drop us a line at hello@glev.app if you need help with setup.",
    "Manual fingerstick values that you log in Glev are always counted and shown as a small square on the chart. If you're on LLU and suspect a low, take a quick fingerstick and log it.",
    "The hypo detection in Insights can only count what it sees. Live LLU values (every ~2 min) catch most lows; in the 15-minute backfill only lows that last at least 15 minutes (or land exactly on a measurement point) are detected.",
    "The Glev engine works equally well with all three sources — for recommendations it uses the value closest in time to the meal.",
  ],
  th2d: 'Which source fits you?',
  help: [
    ['LLU',          "You want to start without tinkering. Since May 2026 it's near real-time (~2-min live values). The classic and simplest path for DACH Libre users."],
    ['Apple Health', 'You have an iPhone and already use a live app like xDrip, Loop, iAPS or the Dexcom app. Best mix of comfort and resolution.'],
    ['Nightscout',   'You have Android (or want platform independence), are tech-minded, or already run Loop/AAPS/xDrip. Full data sovereignty.'],
  ],
  footer1: 'Glev · Help · CGM sources · As of 2026-05-15',
  footer2: 'Glev is a documentation and organisation tool, not a medical device. Therapy decisions are made together with your doctor. · hello@glev.app',
};

const buildDoc = (C) => React.createElement(Document, {},
  React.createElement(Page, { size: 'A4', style: s.page }, [
    React.createElement(View, { style: s.hdr, key: 'hdr' }, [
      React.createElement(Image, { style: s.logo, src: LOGO_PATH, key: 'w' }),
      React.createElement(Text, { style: s.hdrMeta, key: 'm' }, C.metaRight),
    ]),
    React.createElement(Text, { style: s.kicker, key: 'k' }, C.kicker),
    React.createElement(Text, { style: s.h1, key: 'h1' }, C.h1),
    React.createElement(Text, { style: s.sub, key: 'sub' }, C.sub),

    React.createElement(Text, { style: s.h2, key: 'h2a' }, C.th2a),
    React.createElement(View, { style: s.card, key: 'tbl' }, [
      React.createElement(View, { style: s.trH, key: 'thr' }, [
        Cell(C.thCols[0], s.th, s.c1, 'a'),
        Cell(C.thCols[1], s.th, s.c2, 'b'),
        Cell(C.thCols[2], s.th, s.c3, 'c'),
        Cell(C.thCols[3], s.th, s.c4, 'd'),
        Cell(C.thCols[4], s.th, s.c5, 'e'),
      ]),
      ...C.rows.map(TableRow),
    ]),

    // Callout is `wrap={false}` so its borderLeft never splits across
    // a page boundary (Lucas-spec 2026-05-15: previously the blue
    // accent stripe leaked as a ghost on the following page).
    React.createElement(View, { style: s.callout, key: 'co', wrap: false },
      React.createElement(Text, {}, C.callout),
    ),

    // Heading flows naturally; minPresenceAhead keeps it from being
    // orphaned right above a page break.
    React.createElement(Text, { style: s.h2, minPresenceAhead: 100, key: 'h2b' }, C.th2b),
    ...C.src.map(([l, b], i) => SrcCard(l, b, `src${i}`)),

    React.createElement(Text, { style: s.h2, minPresenceAhead: 60, key: 'h2c' }, C.th2c),
    ...C.bullets.map((b, i) => Bullet(b, `bul${i}`)),

    React.createElement(Text, { style: s.h2, minPresenceAhead: 60, key: 'h2d' }, C.th2d),
    ...C.help.map(([k, v], i) => HelpRow(k, v, `hp${i}`)),

    React.createElement(View, { style: s.footer, fixed: true, key: 'f' }, [
      React.createElement(Text, { style: s.footerLine1, key: 'f1' }, C.footer1),
      React.createElement(Text, { style: s.footerLine2, key: 'f2' }, C.footer2),
    ]),
  ]),
);

// Output to public/help/ so the Settings → Hilfe & Feedback row can
// link directly to /help/cgm-quellen-de.pdf without going through any
// auth/route. Keeping the legacy exports/ copies too so nothing
// outside the repo breaks if someone bookmarked them.
await renderToFile(buildDoc(DE), 'public/help/cgm-quellen-de.pdf');
console.log('OK → public/help/cgm-quellen-de.pdf');
await renderToFile(buildDoc(EN), 'public/help/cgm-sources-en.pdf');
console.log('OK → public/help/cgm-sources-en.pdf');
await renderToFile(buildDoc(DE), 'exports/glev-cgm-quellen-matrix-de.pdf');
console.log('OK → exports/glev-cgm-quellen-matrix-de.pdf');
await renderToFile(buildDoc(EN), 'exports/glev-cgm-source-matrix-en.pdf');
console.log('OK → exports/glev-cgm-source-matrix-en.pdf');

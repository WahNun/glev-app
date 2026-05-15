import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToFile } from '@react-pdf/renderer';

// Brand tokens (BB v1 · April 2026)
const BRAND = '#4F6EF7';
const BRAND_GLOW = '#4F6EF740';
const IN_RANGE = '#22D3A0';
const HYPER = '#FF9500';
const HYPO = '#FF2D78';
const PAGE_BG = '#09090B';
const SURFACE = '#111117';
const SURFACE_ALT = '#141420';
const T_PRIMARY = '#FFFFFF';
const T_STRONG = '#FFFFFFD9';
const T_SECONDARY = '#FFFFFFBF';
const T_MUTED = '#FFFFFF80';
const T_TERTIARY = '#FFFFFF59';
const BORDER = '#FFFFFF14';
// Brand wants Inter; @react-pdf ships Helvetica (Inter-class sans). Brandbook explicitly
// requires "always include system fallback so flash-of-unstyled-text uses a sane local font" —
// Helvetica is that fallback. Mono uses Courier as JetBrains-Mono fallback (data only).
const SANS = 'Helvetica';
const SANS_B = 'Helvetica-Bold';
const MONO = 'Courier';
const MONO_B = 'Courier-Bold';

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 36, fontSize: 9.5, color: T_STRONG, fontFamily: SANS, lineHeight: 1.45, backgroundColor: PAGE_BG },

  // header band
  hdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  word: { fontFamily: SANS_B, fontSize: 18, color: BRAND, letterSpacing: -0.5 },
  hdrMeta: { fontFamily: MONO, fontSize: 8, color: T_TERTIARY },

  h1: { fontFamily: SANS_B, fontSize: 26, color: T_PRIMARY, letterSpacing: -0.6, marginBottom: 6 },
  sub: { fontSize: 11, color: T_SECONDARY, marginBottom: 18, lineHeight: 1.5 },

  h2: { fontFamily: SANS_B, fontSize: 13, color: T_PRIMARY, marginTop: 18, marginBottom: 10, letterSpacing: -0.2 },
  kicker: { fontFamily: SANS_B, fontSize: 8.5, color: BRAND, letterSpacing: 1.5, marginBottom: 6 },

  // table — surface card
  card: { backgroundColor: SURFACE, borderRadius: 6, padding: 0, overflow: 'hidden', marginBottom: 4 },
  trH: { flexDirection: 'row', backgroundColor: SURFACE_ALT, paddingVertical: 8, paddingHorizontal: 8, borderBottom: `1pt solid ${BORDER}` },
  tr:  { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, borderBottom: `0.5pt solid ${BORDER}`, minHeight: 22 },
  th:  { fontFamily: SANS_B, fontSize: 7.5, color: T_MUTED, letterSpacing: 1 },
  td:  { fontSize: 8.5, color: T_STRONG, paddingRight: 4 },
  tdMuted: { fontSize: 8.5, color: T_MUTED, paddingRight: 4 },
  tdStrong: { fontFamily: SANS_B, fontSize: 8.5, color: T_PRIMARY, paddingRight: 4 },
  tdMono: { fontFamily: MONO, fontSize: 8.5, color: T_PRIMARY, paddingRight: 4 },
  tdMonoMuted: { fontFamily: MONO, fontSize: 8.5, color: T_SECONDARY, paddingRight: 4 },

  c1: { width: '13%' },
  c2: { width: '21%' },
  c3: { width: '14%' },
  c4: { width: '18%' },
  c5: { width: '16%' },
  c6: { width: '18%' },

  callout: { backgroundColor: SURFACE, borderLeft: `2pt solid ${BRAND}`, padding: 10, marginTop: 12, marginBottom: 8, fontSize: 9.5, color: T_STRONG, borderRadius: 3 },

  // glev "source" cards
  srcCard: { backgroundColor: SURFACE, borderRadius: 6, padding: 12, marginBottom: 8, borderLeft: `2pt solid ${BRAND}` },
  srcLabel: { fontFamily: SANS_B, fontSize: 10.5, color: T_PRIMARY, marginBottom: 4, letterSpacing: -0.1 },
  srcBody: { fontSize: 9.5, color: T_SECONDARY, lineHeight: 1.55 },

  // bullets
  bullet: { flexDirection: 'row', marginBottom: 5 },
  bulletDot: { width: 12, color: BRAND, fontSize: 10, fontFamily: SANS_B },
  bulletText: { flex: 1, fontSize: 9.5, color: T_STRONG, lineHeight: 1.5 },

  // help-card grid
  helpRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  helpKey: { width: '20%', fontFamily: SANS_B, fontSize: 9.5, color: BRAND },
  helpVal: { flex: 1, fontSize: 9.5, color: T_STRONG, lineHeight: 1.5 },

  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, paddingTop: 8, borderTop: `0.5pt solid ${BORDER}` },
  footerLine1: { fontSize: 7.5, color: T_TERTIARY, marginBottom: 2 },
  footerLine2: { fontSize: 7, color: T_MUTED, lineHeight: 1.4 },
});

const Cell = (text, base, w, key) => React.createElement(Text, { style: [base, w], key }, text);

const TableRow = (cols, i) => React.createElement(View, { style: s.tr, key: `r${i}`, wrap: false }, [
  Cell(cols[0], s.tdStrong,    s.c1, 'a'),
  Cell(cols[1], s.td,          s.c2, 'b'),
  Cell(cols[2], s.tdStrong,    s.c3, 'c'),
  Cell(cols[3], s.tdMono,      s.c4, 'd'),
  Cell(cols[4], s.tdMonoMuted, s.c5, 'e'),
  Cell(cols[5], s.tdMuted,     s.c6, 'f'),
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
  date: '15.05.2026',
  metaRight: 'v1 · 15.05.2026',
  h1: 'CGM-Quellen-Matrix',
  sub: 'Welche zeitliche Auflösung sieht der Nutzer in Glev — abhängig vom Sensor, der Quell-App auf dem Phone und der gewählten Glev-Quelle.',
  kicker: 'INTERNES REFERENZ-DOKUMENT',
  th2a: 'Quick-Lookup',
  thCols: ['SENSOR', 'QUELL-APP AUF DEM PHONE', 'GLEV-QUELLE', 'PUNKTE / STUNDE', 'LATENZ', 'LÜCKEN-RISIKO'],
  rows: [
    ['Libre 2',      'LibreLink',                        'LLU',          '4 / 15 min',  '2-4 min',     'mittel — Hypos zwischen Ticks unsichtbar'],
    ['Libre 2',      'xDrip4iOS / iAPS / Loop',          'Apple Health', '60 / 1 min',  '30 s - 2 min', 'niedrig (solange Phone in BLE-Reichweite)'],
    ['Libre 2',      'xDrip4iOS / iAPS / Loop',          'Nightscout',   '60 / 1 min',  '30 s - 1 min', 'niedrig'],
    ['Libre 3',     'LibreLink (DACH)',                  'LLU',          '4 / 15 min',  '2-4 min',     'mittel — Abbott aggregiert für Share-API'],
    ['Libre 3',     'LibreLink (USA/UK, älter)',         'Apple Health', '60 / 1 min',  '30 s - 2 min', 'niedrig'],
    ['Libre 3',     'xDrip4iOS / Juggluco',              'AH oder NS',   '60 / 1 min',  '30 s - 2 min', 'niedrig'],
    ['Dexcom G6',   'Dexcom-App',                        'Apple Health', '12 / 5 min',  '5-7 min',     'niedrig (Hardware-Limit)'],
    ['Dexcom G7',   'Dexcom-App',                        'Apple Health', '12 / 5 min',  '5-7 min',     'niedrig'],
    ['Dexcom G6/G7','Loop / Loop Follow / xDrip',        'Nightscout',   '12 / 5 min',  '1-3 min',     'niedrig'],
  ],
  callout: 'Wichtig: Glev refreshed die UI alle 60 s (mit 30 s Client-Cache). Selbst bei 1-Minuten-Datenquellen sieht der Nutzer maximal einen neuen Punkt pro Minute — die Datenquelle entscheidet aber, wie viel echte Auflösung dahinter steckt.',
  th2b: 'Was bedeuten die drei Glev-Quellen technisch?',
  src: [
    ['1. LLU (LibreLinkUp) — Cloud, alle 15 min',
     'Glev fragt Abbotts Share-with-Caregivers-API alle 60 s. Abbott liefert den aktuellen Wert (live) plus die letzten ca. 12 h als 15-Minuten-Aggregate. Kurze Hypos oder Hyper, die zwischen zwei 15-min-Ticks bottomen, sind für Glev nicht sichtbar — egal welcher Libre-Sensor. Vorteil: null Setup. Nachteil: 15-Minuten-Auflösung ist klinisch grob.'],
    ['2. Apple Health — lokal, Auflösung = was die Quell-App reinschreibt',
     'Glev liest aus der iOS-Health-Datenbank. Die Cadence ist 1:1 die der schreibenden App. LibreLink → Health funktioniert in DACH NICHT mehr (Abbott hat den Toggle 2023 entfernt). Dexcom-App → Health schreibt nativ alle 5 min. xDrip4iOS / iAPS / Loop / Juggluco → Health = 1 min, weil sie den Sensor direkt via BLE auslesen. Vorteil: keine Cloud-Latenz. Nachteil: Setup nötig (Quell-App, Permissions, Glev-iOS-Shell mit HealthKit-Recht).'],
    ['3. Nightscout — eigener Server, Auflösung = was Uploader-App pusht',
     'Glev pollt einen Nightscout-Endpunkt alle 60 s. xDrip / Loop / Juggluco → NS = 1 min (Libre) oder 5 min (Dexcom-Hardware-Limit). LibreLink → NS geht nicht direkt, brauchst eine Mittelschicht. Vorteil: Quelle der Wahrheit liegt beim Nutzer, plattform-agnostisch (iOS und Android). Nachteil: Server-Hosting (kostenlos auf Vercel oder Railway, aber 2-4 h Setup).'],
  ],
  th2c: 'Caveats für die Nutzer-Kommunikation',
  bullets: [
    'DACH-Libre-2- oder Libre-3-Nutzer ohne xDrip oder Nightscout sind auf 15-Minuten-LLU-Auflösung festgenagelt. Der Apple-Health-Pfad ist für sie de facto tot. Das ist nicht Glevs Fehler — das ist Abbotts Geschäftsentscheidung.',
    'Dexcom-Nutzer haben nie 1-Minuten-Auflösung, egal welcher Pfad — der Sensor selbst sampled nur alle 5 min. Hardware, nicht Software.',
    'G7 ist nicht „besser" als G6 in Sachen Auflösung — G7 ist nur kleiner und schneller im Warm-up.',
    'Latenz ist nicht gleich Auflösung. Eine LLU-Kurve mit 15-Minuten-Punkten kann den letzten Wert schon nach 2 min zeigen (geringe Latenz), die Lücken zwischen den Ticks bleiben aber leer.',
    'Hypo-Erkennung in Insights zählt nur Punkte unter 70 mg/dL die im Datenstrom auftauchen. Bei 15-min-LLU also nur Hypos die zufällig auf einen Tick fallen oder mindestens 15 min dauern. Bei 1-Minuten-Quellen praktisch alles.',
    'Manuelle Fingersticks umgehen die Auflösungs-Limits — werden immer gezählt und im Graph als Quadrat eingezeichnet. Wer auf LLU sitzt und ein verdächtiges Tief vermutet sollte zusätzlich einen Fingerstick loggen.',
  ],
  th2d: 'Vorgeschlagene Hilfetexte für die Settings-CGM-Auswahl',
  help: [
    ['LLU',          'Auflösung 15 min. Einfachste Anbindung, aber kurze Hypos können fehlen — bei Verdacht zusätzlich Fingerstick loggen.'],
    ['Apple Health', 'Auflösung gleich deine Quell-App (z. B. xDrip = 1 min, Dexcom-App = 5 min). Erfordert HealthKit-Berechtigung in der Glev-iOS-App.'],
    ['Nightscout',   'Auflösung gleich dein Uploader (xDrip = 1 min, Loop = 5 min). Erfordert eigenen Nightscout-Server.'],
  ],
  footer1: 'Glev · CGM-Quellen-Matrix · 15.05.2026',
  footer2: 'Glev ist ein Dokumentations- und Organisations-Tool, kein Medizinprodukt. Therapieentscheidungen triffst du in Absprache mit deinem Arzt. · hello@glev.app',
};

// ---------- CONTENT (EN) ----------
const EN = {
  date: '2026-05-15',
  metaRight: 'v1 · 2026-05-15',
  h1: 'CGM source matrix',
  sub: 'What time resolution the user actually sees inside Glev — depending on sensor, the source app on their phone, and the chosen Glev source.',
  kicker: 'INTERNAL REFERENCE DOCUMENT',
  th2a: 'Quick lookup',
  thCols: ['SENSOR', 'SOURCE APP ON PHONE', 'GLEV SOURCE', 'POINTS / HOUR', 'LATENCY', 'GAP RISK'],
  rows: [
    ['Libre 2',      'LibreLink',                        'LLU',          '4 / 15 min',  '2-4 min',     'medium — hypos between ticks invisible'],
    ['Libre 2',      'xDrip4iOS / iAPS / Loop',          'Apple Health', '60 / 1 min',  '30 s - 2 min', 'low (as long as phone is in BLE range)'],
    ['Libre 2',      'xDrip4iOS / iAPS / Loop',          'Nightscout',   '60 / 1 min',  '30 s - 1 min', 'low'],
    ['Libre 3',     'LibreLink (DACH)',                  'LLU',          '4 / 15 min',  '2-4 min',     'medium — Abbott aggregates for Share API'],
    ['Libre 3',     'LibreLink (US/UK, older)',          'Apple Health', '60 / 1 min',  '30 s - 2 min', 'low'],
    ['Libre 3',     'xDrip4iOS / Juggluco',              'AH or NS',     '60 / 1 min',  '30 s - 2 min', 'low'],
    ['Dexcom G6',   'Dexcom app',                        'Apple Health', '12 / 5 min',  '5-7 min',     'low (hardware limit)'],
    ['Dexcom G7',   'Dexcom app',                        'Apple Health', '12 / 5 min',  '5-7 min',     'low'],
    ['Dexcom G6/G7','Loop / Loop Follow / xDrip',        'Nightscout',   '12 / 5 min',  '1-3 min',     'low'],
  ],
  callout: 'Important: Glev refreshes its UI every 60 s (with a 30 s client cache). Even with 1-minute data sources, the user sees at most one new point per minute — but the source decides how much real resolution sits behind it.',
  th2b: 'What the three Glev sources actually mean technically',
  src: [
    ['1. LLU (LibreLinkUp) — cloud, every 15 min',
     'Glev calls Abbott\'s Share-with-caregivers API every 60 s. Abbott returns the current value (live) plus roughly the last 12 h as 15-minute aggregates. Short hypos or hypers that bottom out between two 15-min ticks are invisible to Glev — regardless of which Libre sensor. Upside: zero setup. Downside: 15-minute resolution is clinically coarse.'],
    ['2. Apple Health — local, resolution = whatever the source app writes in',
     'Glev reads from the iOS Health database. Cadence is 1:1 whatever the writing app produces. LibreLink → Health no longer works in DACH (Abbott removed the toggle in 2023). The Dexcom app → Health writes natively every 5 min. xDrip4iOS / iAPS / Loop / Juggluco → Health = 1 min, because they read the sensor directly via BLE. Upside: no cloud latency. Downside: setup needed (source app, permissions, Glev iOS shell with HealthKit entitlement).'],
    ['3. Nightscout — your own server, resolution = whatever the uploader app pushes',
     'Glev polls a Nightscout endpoint every 60 s. xDrip / Loop / Juggluco → NS = 1 min (Libre) or 5 min (Dexcom hardware limit). LibreLink → NS is not direct, you need a middleware layer. Upside: source of truth lives with the user, platform-agnostic (iOS and Android). Downside: server hosting (free on Vercel or Railway, but 2-4 h setup).'],
  ],
  th2c: 'Caveats for user communication',
  bullets: [
    'DACH Libre 2 or Libre 3 users without xDrip or Nightscout are stuck on 15-minute LLU resolution. The Apple Health path is effectively dead for them. That\'s not Glev\'s fault — it\'s Abbott\'s business decision.',
    'Dexcom users never get 1-minute resolution, regardless of path — the sensor itself only samples every 5 min. Hardware, not software.',
    'G7 is not "better" than G6 for resolution — G7 is just smaller and faster on warm-up.',
    'Latency is not the same as resolution. An LLU curve with 15-minute points can show the latest value within 2 min (low latency), but the gaps between ticks stay empty.',
    'Hypo detection in Insights only counts points below 70 mg/dL that actually appear in the data stream. With 15-min LLU that means only hypos that happen to land on a tick or last at least 15 min. With 1-minute sources, basically everything.',
    'Manual fingersticks bypass the resolution limit — they always count and are drawn as squares on the chart. If you\'re on LLU and suspect a low between ticks, log a fingerstick.',
  ],
  th2d: 'Suggested helper copy for the Settings → CGM source picker',
  help: [
    ['LLU',          '"Resolution 15 min. Simplest setup, but short hypos can be missed — log a fingerstick if you suspect one."'],
    ['Apple Health', '"Resolution = your source app (e.g. xDrip = 1 min, Dexcom app = 5 min). Requires HealthKit permission in the Glev iOS app."'],
    ['Nightscout',   '"Resolution = your uploader (xDrip = 1 min, Loop = 5 min). Requires your own Nightscout server."'],
  ],
  footer1: 'Glev · CGM source matrix · 2026-05-15',
  footer2: 'Glev is a documentation and organisation tool, not a medical device. Therapy decisions are made together with your doctor. · hello@glev.app',
};

const buildDoc = (C) => React.createElement(Document, {},
  React.createElement(Page, { size: 'A4', style: s.page }, [
    React.createElement(View, { style: s.hdr, key: 'hdr' }, [
      React.createElement(Text, { style: s.word, key: 'w' }, 'glev'),
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
        Cell(C.thCols[5], s.th, s.c6, 'f'),
      ]),
      ...C.rows.map(TableRow),
    ]),

    React.createElement(View, { style: s.callout, key: 'co' },
      React.createElement(Text, {}, C.callout),
    ),

    React.createElement(Text, { style: s.h2, key: 'h2b' }, C.th2b),
    ...C.src.map(([l, b], i) => SrcCard(l, b, `src${i}`)),

    React.createElement(Text, { style: s.h2, key: 'h2c' }, C.th2c),
    ...C.bullets.map((b, i) => Bullet(b, `bul${i}`)),

    React.createElement(Text, { style: s.h2, key: 'h2d' }, C.th2d),
    ...C.help.map(([k, v], i) => HelpRow(k, v, `hp${i}`)),

    React.createElement(View, { style: s.footer, fixed: true, key: 'f' }, [
      React.createElement(Text, { style: s.footerLine1, key: 'f1' }, C.footer1),
      React.createElement(Text, { style: s.footerLine2, key: 'f2' }, C.footer2),
    ]),
  ]),
);

await renderToFile(buildDoc(DE), 'exports/glev-cgm-quellen-matrix-de.pdf');
console.log('OK → exports/glev-cgm-quellen-matrix-de.pdf');
await renderToFile(buildDoc(EN), 'exports/glev-cgm-source-matrix-en.pdf');
console.log('OK → exports/glev-cgm-source-matrix-en.pdf');

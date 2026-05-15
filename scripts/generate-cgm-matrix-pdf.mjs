import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToFile } from '@react-pdf/renderer';

const ACCENT = '#3DD68C';
const INK = '#0E1116';
const DIM = '#566076';
const LINE = '#E2E5EA';
const SOFT = '#F7F8FA';
const WARN_BG = '#FFF7E6';
const WARN_BORDER = '#F5C16C';

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 40, fontSize: 9.5, color: INK, fontFamily: 'Helvetica', lineHeight: 1.45 },
  brand: { fontSize: 11, fontWeight: 700, color: ACCENT, letterSpacing: 1.5, marginBottom: 4 },
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 6, color: INK },
  sub: { fontSize: 9.5, color: DIM, marginBottom: 18 },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 8, color: INK, borderBottom: `1pt solid ${LINE}`, paddingBottom: 4 },
  p:  { marginBottom: 6, color: INK },

  trH: { flexDirection: 'row', backgroundColor: INK, color: 'white', paddingVertical: 6, paddingHorizontal: 4 },
  tr:  { flexDirection: 'row', borderBottom: `0.5pt solid ${LINE}`, paddingVertical: 5, paddingHorizontal: 4, minHeight: 22 },
  trA: { flexDirection: 'row', borderBottom: `0.5pt solid ${LINE}`, paddingVertical: 5, paddingHorizontal: 4, backgroundColor: SOFT, minHeight: 22 },
  th:  { fontSize: 8, fontWeight: 700, color: 'white', letterSpacing: 0.5 },
  td:  { fontSize: 8.5, color: INK, paddingRight: 4 },
  tdMuted: { fontSize: 8.5, color: DIM, paddingRight: 4 },
  tdStrong: { fontSize: 8.5, color: INK, fontWeight: 700, paddingRight: 4 },
  c1: { width: '13%' },
  c2: { width: '21%' },
  c3: { width: '14%' },
  c4: { width: '18%' },
  c5: { width: '16%' },
  c6: { width: '18%' },

  callout: { backgroundColor: WARN_BG, borderLeft: `2pt solid ${WARN_BORDER}`, padding: 8, marginTop: 8, marginBottom: 8, fontSize: 9 },

  srcRow: { marginTop: 4, marginBottom: 6, paddingLeft: 8, borderLeft: `2pt solid ${ACCENT}` },
  srcLabel: { fontSize: 9.5, fontWeight: 700, color: INK, marginBottom: 2 },
  srcBody: { fontSize: 9.5 },

  bullet: { flexDirection: 'row', marginBottom: 4 },
  bulletDot: { width: 10, color: ACCENT, fontSize: 10, fontWeight: 700 },
  bulletText: { flex: 1, fontSize: 9.5, color: INK },

  footer: { position: 'absolute', bottom: 25, left: 40, right: 40, fontSize: 7.5, color: DIM, textAlign: 'center', borderTop: `0.5pt solid ${LINE}`, paddingTop: 6 },
});

const ROWS = [
  ['Libre 2',       'LibreLink',                        'LLU',           '4 (alle 15 min)',  '2–4 min',     'mittel — Hypos zwischen Ticks unsichtbar'],
  ['Libre 2',       'xDrip4iOS / iAPS / Loop',          'Apple Health',  '60 (alle 1 min)',  '30 s – 2 min', 'niedrig (solange Phone in BLE-Reichweite)'],
  ['Libre 2',       'xDrip4iOS / iAPS / Loop',          'Nightscout',    '60 (alle 1 min)',  '30 s – 1 min', 'niedrig'],
  ['Libre 3',       'LibreLink (DACH)',                 'LLU',           '4 (alle 15 min)',  '2–4 min',     'mittel — Abbott aggregiert die 1-min-Werte für die Share-API'],
  ['Libre 3',       'LibreLink (USA/UK, älter)',        'Apple Health',  '60 (alle 1 min)',  '30 s – 2 min', 'niedrig'],
  ['Libre 3',       'xDrip4iOS / Juggluco',             'AH oder NS',    '60 (alle 1 min)',  '30 s – 2 min', 'niedrig'],
  ['Dexcom G6',     'Dexcom-App',                       'Apple Health',  '12 (alle 5 min)',  '5–7 min',     'niedrig (Hardware-Limit)'],
  ['Dexcom G7',     'Dexcom-App',                       'Apple Health',  '12 (alle 5 min)',  '5–7 min',     'niedrig'],
  ['Dexcom G6/G7',  'Loop / Loop Follow / xDrip',       'Nightscout',    '12 (alle 5 min)',  '1–3 min',     'niedrig'],
];

const Cell = (text, base, w) => React.createElement(Text, { style: [base, w] }, text);

const TableRow = (cols, i) => {
  const base = i % 2 === 0 ? s.tr : s.trA;
  return React.createElement(View, { style: base, key: `r${i}`, wrap: false }, [
    Cell(cols[0], s.tdStrong, s.c1),
    Cell(cols[1], s.td,       s.c2),
    Cell(cols[2], s.tdStrong, s.c3),
    Cell(cols[3], s.td,       s.c4),
    Cell(cols[4], s.tdMuted,  s.c5),
    Cell(cols[5], s.tdMuted,  s.c6),
  ]);
};

const Bullet = (txt, k) => React.createElement(View, { style: s.bullet, key: k }, [
  React.createElement(Text, { style: s.bulletDot, key: 'd' }, '•'),
  React.createElement(Text, { style: s.bulletText, key: 't' }, txt),
]);

const SrcBlock = (label, body, k) => React.createElement(View, { style: s.srcRow, key: k }, [
  React.createElement(Text, { style: s.srcLabel, key: 'l' }, label),
  React.createElement(Text, { style: s.srcBody, key: 'b' }, body),
]);

const Doc = React.createElement(Document, {},
  React.createElement(Page, { size: 'A4', style: s.page }, [
    React.createElement(Text, { style: s.brand, key: 'b' }, 'GLEV'),
    React.createElement(Text, { style: s.h1, key: 'h' }, 'CGM-Quellen-Matrix'),
    React.createElement(Text, { style: s.sub, key: 'su' }, 'Welche Auflösung kriegt der User in Glev — abhängig von Sensor, Quell-App und Glev-Quelle. Stand 15.05.2026.'),

    React.createElement(Text, { style: s.h2, key: 'th' }, 'Quick-Lookup'),

    React.createElement(View, { style: s.trH, key: 'thr' }, [
      Cell('SENSOR', s.th, s.c1),
      Cell('QUELL-APP AUF DEM PHONE', s.th, s.c2),
      Cell('GLEV-QUELLE', s.th, s.c3),
      Cell('PUNKTE / STUNDE', s.th, s.c4),
      Cell('LATENZ', s.th, s.c5),
      Cell('LÜCKEN-RISIKO', s.th, s.c6),
    ]),
    ...ROWS.map(TableRow),

    React.createElement(View, { style: s.callout, key: 'co' },
      React.createElement(Text, {},
        'Wichtig: Glev refreshed UI alle 60 s (mit 30 s Client-Cache). Selbst bei 1-min-Datenquellen sieht der User max. 1×/min einen neuen Punkt — die Datenquelle entscheidet aber, wie viel echte Auflösung dahinter steckt.'),
    ),

    React.createElement(Text, { style: s.h2, key: 'h2a' }, 'Was bedeuten die drei Glev-Quellen technisch?'),

    SrcBlock(
      '1. LLU (LibreLinkUp) — Cloud, alle 15 min',
      'Glev fragt Abbotts „Share-with-caregivers"-API alle 60 s. Abbott liefert den aktuellen Wert (live) plus die letzten ~12 h als 15-Minuten-Aggregate. Kurze Hypos/Hyper, die zwischen zwei 15-min-Ticks bottomen, sind für Glev nicht sichtbar — egal welcher Libre-Sensor. Vorteil: Null Setup. Nachteil: 15-min-Auflösung ist klinisch grob.',
      'src1',
    ),
    SrcBlock(
      '2. Apple Health — lokal, Auflösung = was die Quell-App reinschreibt',
      'Glev liest aus der iOS-Health-DB. Cadence ist 1:1 die der schreibenden App. LibreLink → Health funktioniert in DACH NICHT mehr (Abbott hat den Toggle 2023 entfernt, MDR-Streit). Dexcom-App → Health schreibt nativ alle 5 min. xDrip4iOS / iAPS / Loop / Juggluco → Health = 1 min, weil sie den Sensor direkt via BLE auslesen. Vorteil: keine Cloud-Latenz. Nachteil: Setup nötig (Quell-App, Permissions, Glev-iOS-Shell mit HealthKit-Recht).',
      'src2',
    ),
    SrcBlock(
      '3. Nightscout — eigener Server, Auflösung = was Uploader-App pusht',
      'Glev pollt einen Nightscout-Endpunkt alle 60 s. xDrip / Loop / Juggluco → NS = 1 min (Libre) oder 5 min (Dexcom-Hardware-Limit). LibreLink → NS geht nicht direkt, brauchst eine Mittelschicht. Vorteil: Quelle der Wahrheit liegt beim User, plattform-agnostisch (iOS + Android). Nachteil: Server-Hosting (kostenlos auf Vercel/Railway, aber Setup-Aufwand 2–4 h).',
      'src3',
    ),

    React.createElement(Text, { style: s.h2, key: 'h2b' }, 'Caveats für die User-Kommunikation'),

    Bullet('DACH-Libre-2- oder Libre-3-Nutzer ohne xDrip/Nightscout sind auf 15-min-LLU-Auflösung festgenagelt. Apple-Health-Pfad ist für sie de facto tot. Das ist nicht Glevs Fehler — das ist Abbotts Geschäftsentscheidung.', 'b1'),
    Bullet('Dexcom-Nutzer haben nie 1-min-Auflösung, egal welcher Pfad — der Sensor selbst sampled nur alle 5 min. Hardware, nicht Software.', 'b2'),
    Bullet('G7 ist nicht „besser" als G6 in Sachen Auflösung — G7 ist nur kleiner und schneller im Warm-up.', 'b3'),
    Bullet('Latenz ≠ Auflösung. Eine LLU-Kurve mit 15-min-Punkten kann den letzten Wert schon nach 2 min zeigen (= geringe Latenz), die Lücken zwischen den Ticks bleiben aber leer.', 'b4'),
    Bullet('Hypo-Erkennung in Insights zählt nur Punkte unter 70 mg/dL die im Datenstrom auftauchen. Bei 15-min-LLU = nur Hypos die zufällig auf einen Tick fallen oder ≥15 min dauern. Bei 1-min-Quellen = praktisch alles.', 'b5'),
    Bullet('Manuelle Fingersticks umgehen die Auflösungs-Limits — werden immer gezählt und im Graph als Quadrat eingezeichnet. Wer auf LLU sitzt und ein verdächtiges Tief vermutet → Fingerstick loggen.', 'b6'),

    React.createElement(Text, { style: s.h2, key: 'h2c' }, 'Vorgeschlagene Hilfetexte für die Settings-CGM-Auswahl'),

    SrcBlock('LLU',          '„Auflösung 15 min. Einfachste Anbindung, aber kurze Hypos können fehlen — bei Verdacht zusätzlich Fingerstick loggen."', 'ht1'),
    SrcBlock('Apple Health', '„Auflösung = deine Quell-App (z. B. xDrip = 1 min, Dexcom-App = 5 min). Erfordert HealthKit-Berechtigung in der Glev-iOS-App."', 'ht2'),
    SrcBlock('Nightscout',   '„Auflösung = dein Uploader (xDrip = 1 min, Loop = 5 min). Erfordert eigenen Nightscout-Server."', 'ht3'),

    React.createElement(Text, { style: s.footer, fixed: true, key: 'f' }, 'Glev · CGM-Quellen-Matrix · 15.05.2026 · interner Stand zur User-Kommunikation'),
  ]),
);

await renderToFile(Doc, 'exports/glev-cgm-quellen-matrix.pdf');
console.log('OK → exports/glev-cgm-quellen-matrix.pdf');

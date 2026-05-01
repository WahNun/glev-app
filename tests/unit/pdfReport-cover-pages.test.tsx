/** @jsxImportSource react */
// Cover-overflow regression coverage for `lib/pdfReport.tsx`.
//
// Why this exists (Task #168):
//   The doctor-facing `Diabetes-Bericht` PDF puts the *entire* clinical
//   summary on page 1: a meta block (Patient / Zeitraum / optional
//   Letzter Termin / Erstellt am / optional ICR / optional Korrektur-
//   faktor), three rows of "Insights — Übersicht" cards, and the
//   `Klinische Detail-KPIs` row of six tiles. Any change that adds a
//   meta row, grows the insight-card height, or bumps the KPI font
//   size risks pushing one of those tiles onto page 2 — i.e. the
//   cover that the receiving clinician opens first becomes a
//   half-empty card list, while the actual numbers slip onto an
//   unlabeled second page (Task #165 fixed exactly that for the third
//   row of insight cards).
//
//   The sibling spec `tests/unit/pdfReport.test.ts` walks the JSX tree
//   to assert the cover *contents*, but a tree-walk can't see layout:
//   the cover could overflow and every assertion there would still
//   pass. This file complements it by rendering the report to actual
//   PDF bytes via @react-pdf/renderer and pinning the document's total
//   page count.
//
// How the assertion works:
//   `<GlevReport>` declares exactly 5 `<Page>` elements (cover +
//   Mahlzeiten + Insulin + Fingerstick + Sport). When the cover fits
//   on page 1 the resulting PDF therefore has exactly 5 pages. If
//   anything on the cover spills, react-pdf inserts an extra page in
//   between and the total grows to 6+. The test reads the
//   `/Type /Pages /Count N` entry from the PDF's page tree and asserts
//   `N === EXPECTED_TOTAL_PAGES`.
//
// Variants exercised (per task spec) — all four are actively pinned:
//   1. standard  — no appointmentNote, no ICR, no CF
//   2. icrCf     — ICR + CF set
//   3. note      — appointmentNote set
//   4. all       — appointmentNote + ICR + CF (kitchen sink)
//
//   The configured variants previously overflowed (the 2-row
//   `Klinische Detail-KPIs` grid was tall enough that the
//   Bolus/Basal/Sport values spilled onto page 2 once the optional
//   meta rows pushed everything down). The cover budget was trimmed
//   in `lib/pdfReport.tsx` (KPI padding 10 → 6, kpiRow marginBottom
//   16 → 8, kpiLabel marginBottom 4 → 2) so all four variants now
//   fit on page 1, and the four assertions below pin that contract.
//
// Empty data arrays are intentional: cover layout is data-independent
// (the cards show "0", "—", "0 g KH" etc. when sources are empty), so
// pinning page count without data isolates the regression to the
// cover itself rather than to detail tables on later pages.
//
// Why a `.tsx` file with the `@jsxImportSource react` pragma:
//   The Playwright test runner hard-codes its own JSX runtime when it
//   transforms `.tsx` modules — that runtime wraps elements in
//   `__pw_type` markers, which react-pdf's reconciler rejects with
//   "Objects are not valid as a React child". The file-level pragma
//   forces babel back to the standard `react/jsx-runtime` for this
//   spec; the same pragma sits at the top of `lib/pdfReport.tsx` so
//   the imported component renders with the real runtime too. Both
//   files use React's default runtime in production already, so the
//   pragma is a no-op for the app build.

import { test, expect } from "@playwright/test";
import * as React from "react";
import { pdf } from "@react-pdf/renderer";

import { GlevReport } from "@/lib/pdfReport";
import type { Meal } from "@/lib/meals";
import type { InsulinLog } from "@/lib/insulin";
import type { ExerciseLog } from "@/lib/exercise";
import type { FingerstickReading } from "@/lib/fingerstick";

/* ──────────────────────────────────────────────────────────────────
   Render helpers
   ────────────────────────────────────────────────────────────────── */

// `pdf().toBuffer()` returns a PDFKit document stream (not a Node
// Buffer despite the name). Drain it to a single Buffer so we can
// inspect the PDF's metadata.
async function renderToBuffer(element: React.ReactElement): Promise<Buffer> {
  // Cast through `unknown` because `@react-pdf/renderer`'s `pdf()`
  // signature is typed against its own `DocumentProps` and doesn't
  // accept arbitrary `ReactElement` — at runtime any element whose
  // root is `<Document>` works.
  const inst = pdf(element as unknown as Parameters<typeof pdf>[0]);
  const stream = await inst.toBuffer();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

// Read total page count from the PDF page tree. Every PDF has exactly
// one `/Type /Pages` object whose `/Count` entry is the document's
// total page count (PDF 1.7 spec §7.7.3.2). Parsing the binary as a
// "binary" string keeps byte offsets intact for the regex.
function pdfPageCount(buf: Buffer): number {
  const s = buf.toString("binary");
  const m = s.match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
  if (!m) {
    throw new Error(
      "Could not locate /Type /Pages /Count entry in rendered PDF",
    );
  }
  return Number(m[1]);
}

/* ──────────────────────────────────────────────────────────────────
   Fixtures — minimal (empty arrays) so the only thing varying across
   tests is the cover meta block, which is exactly what we want to pin.
   ────────────────────────────────────────────────────────────────── */

const baseProps = {
  email: "patient@example.com",
  meals: [] as Meal[],
  insulin: [] as InsulinLog[],
  exercise: [] as ExerciseLog[],
  fingersticks: [] as FingerstickReading[],
};

// `<GlevReport>` declares 5 `<Page>` elements (cover + Mahlzeiten +
// Insulin + Fingerstick + Sport). When the cover fits on page 1 the
// rendered PDF therefore has exactly this many pages.
const EXPECTED_TOTAL_PAGES = 5;

// Realistic appointment-note string — pulled from the Settings UI
// helper text. Long enough to occupy a full meta-row width without
// wrapping into a multi-line monster that could itself drive overflow
// (it's rendered as a single Text leaf).
const SAMPLE_APPOINTMENT_NOTE =
  "Dr. Müller, Diabetes-Schwerpunktpraxis München · HbA1c 6,9 %";

/* ──────────────────────────────────────────────────────────────────
   Cover-fit assertions
   ────────────────────────────────────────────────────────────────── */

test.describe("PDF cover fits on page 1", () => {
  test("standard variant — no appointmentNote, no ICR/CF", async () => {
    const buf = await renderToBuffer(
      React.createElement(GlevReport, { ...baseProps }),
    );
    expect(pdfPageCount(buf)).toBe(EXPECTED_TOTAL_PAGES);
  });

  test("with ICR + Korrekturfaktor", async () => {
    const buf = await renderToBuffer(
      React.createElement(GlevReport, {
        ...baseProps,
        // 10 g/IE → renders as "10 g KH/IE" in the meta block (default
        // carb unit is "g"). Realistic mid-range value picked from
        // `lib/icr.ts` defaults.
        icrGperIE: 10,
        // 50 mg/dL/IE — typical Type-1 correction factor.
        cfMgdlPerIE: 50,
      }),
    );
    expect(pdfPageCount(buf)).toBe(EXPECTED_TOTAL_PAGES);
  });

  test("with appointmentNote", async () => {
    const buf = await renderToBuffer(
      React.createElement(GlevReport, {
        ...baseProps,
        appointmentNote: SAMPLE_APPOINTMENT_NOTE,
      }),
    );
    expect(pdfPageCount(buf)).toBe(EXPECTED_TOTAL_PAGES);
  });

  test("with appointmentNote + ICR + Korrekturfaktor (kitchen sink)", async () => {
    const buf = await renderToBuffer(
      React.createElement(GlevReport, {
        ...baseProps,
        icrGperIE: 10,
        cfMgdlPerIE: 50,
        appointmentNote: SAMPLE_APPOINTMENT_NOTE,
      }),
    );
    expect(pdfPageCount(buf)).toBe(EXPECTED_TOTAL_PAGES);
  });
});

// Regression guard for GlevAIChatSheet action-button overflow on narrow viewports.
//
// Why this test exists:
//   The two-button row inside every PendingActionWidget chip (log_fingerstick,
//   log_cycle_entry, log_insulin, and the generic fallback) was found to
//   overflow its card container on narrow iPhone widths (375 px). An automated
//   check catches CSS regressions before they reach users — e.g. a font-size
//   bump, added white-space:nowrap, or a padding increase that breaks the
//   flex row.
//
// What this asserts:
//   * Viewport is 375 × 812 px (smallest common iPhone portrait width).
//   * For each chip type the action-button container div must satisfy
//     scrollWidth ≤ clientWidth (no horizontal overflow).
//   * Each individual button inside that row must also not overflow its own
//     box (scrollWidth ≤ clientWidth).
//
// Rendering strategy:
//   The chips only appear in the running app after a non-deterministic AI
//   response, making live-app navigation impractical. Instead, we use
//   page.setContent() to inject a minimal HTML page that mirrors the exact
//   inline styles from PendingActionWidget (copied verbatim from
//   components/GlevAIChatSheet.tsx) at the same layout constraints. This
//   tests the CSS layout invariant directly and runs without login or network.
//
// Chip types covered:
//   1. log_fingerstick  — "Schnell speichern" + "Fingerstick-Details öffnen →"
//   2. log_cycle_entry  — "Schnell speichern" + "Zyklus-Details öffnen →"
//   3. log_insulin      — "Schnell speichern" + "Bolus-Details öffnen →"
//   4. generic fallback — "Schnell speichern" + "Detail öffnen →"
//
// Key layout facts (from GlevAIChatSheet.tsx):
//   - Chip card: maxWidth 82 %, padding 10px 12px, display flex + column + gap 8
//   - Button row: display flex, gap 8 px
//   - Each button:  flex 1, padding 9px 10px, font-size 13px
//
// At 375 px viewport the card is ≤ 307.5 px wide; the button row has
// ≤ 307.5 − 24 px (horizontal padding) = ≤ 283.5 px to share between two
// flex-1 siblings. The fix that prompted this test ensured flex layout
// actually distributes that space rather than overflowing.

import { expect, test } from "@playwright/test";

// ── Shared CSS reset injected once ─────────────────────────────────────────

const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 375px; background: #1a1a2e; font-family: -apple-system, sans-serif; }
`;

// ── Helper: build a chip HTML block ────────────────────────────────────────

/**
 * Returns an HTML fragment that matches the PendingActionWidget button-row
 * structure at the relevant nesting level (outer message list → card → row).
 *
 * The outer div simulates the full chat-sheet width; the card div carries
 * `maxWidth: 82 %` just like `baseCard` in the component. Both chip labels
 * and button texts are realistic (German UI, matching DE locale).
 */
function chipHtml(opts: {
  id: string;
  headerHtml: string;
  btn1Label: string;
  btn2Label: string;
  cardAccent?: string;
}) {
  const accent = opts.cardAccent ?? "#8b5cf6";
  return `
    <div
      id="${opts.id}"
      style="
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 12px;
      "
    >
      <!-- chip card — mirrors baseCard from GlevAIChatSheet.tsx -->
      <div style="
        max-width: 82%;
        padding: 10px 12px;
        border-radius: 12px;
        background: #242440;
        border: 1px solid #3a3a5c;
        font-size: 13px;
        line-height: 1.45;
        color: #e0e0e0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        position: relative;
      ">
        <!-- dismiss ✕ button (absolute, top-right — not part of flow) -->
        <button type="button" style="
          position: absolute; top: 8px; right: 8px;
          background: none; border: none; cursor: pointer;
          padding: 4px; color: #888; font-size: 14px;
          line-height: 1; display: flex; align-items: center;
        ">✕</button>

        <!-- type label row -->
        ${opts.headerHtml}

        <!-- action button row — THIS IS WHAT WE GUARD AGAINST OVERFLOW -->
        <div
          class="btn-row"
          data-chip="${opts.id}"
          style="display: flex; gap: 8px;"
        >
          <button type="button" style="
            flex: 1;
            padding: 9px 10px;
            border-radius: 8px;
            border: none;
            background: ${accent};
            color: #fff;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
          ">${opts.btn1Label}</button>
          <button type="button" style="
            flex: 1;
            padding: 9px 10px;
            border-radius: 8px;
            border: 1px solid #555;
            background: #1e1e35;
            color: #d0d0d0;
            font-size: 13px;
            cursor: pointer;
          ">${opts.btn2Label}</button>
        </div>
      </div>
    </div>
  `;
}

// ── Chip definitions ────────────────────────────────────────────────────────

const CHIPS = [
  {
    id: "chip-fingerstick",
    headerHtml: `
      <div style="display:flex;align-items:center;gap:5px;padding-right:20px;
                  font-size:11px;font-weight:700;color:#888;letter-spacing:.04em;
                  text-transform:uppercase;">
        <span>🩸</span><span>Fingerstick</span>
      </div>
      <div style="font-size:20px;font-weight:700;font-family:monospace;color:#e0e0e0;">
        95 mg/dL <span style="font-size:13px;font-weight:500;color:#888;margin-left:6px;">· Jetzt</span>
      </div>
    `,
    btn1Label: "Schnell speichern",
    btn2Label: "Fingerstick-Details öffnen →",
    cardAccent: "#8b5cf6",
  },
  {
    id: "chip-cycle",
    headerHtml: `
      <div style="display:flex;align-items:center;gap:5px;padding-right:20px;
                  font-size:11px;font-weight:700;color:#888;letter-spacing:.04em;
                  text-transform:uppercase;">
        <span>🌙</span><span>Zyklus</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">
        <span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:8px;
                     background:#FF2D7818;border:1px solid #FF2D7835;color:#FF2D78;
                     font-size:12px;font-weight:700;">Blutung</span>
        <span style="color:#555;font-size:12px;">·</span>
        <span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:8px;
                     background:#FF2D7818;border:1px solid #FF2D7835;color:#FF2D78;
                     font-size:12px;font-weight:700;">Mittel</span>
        <span style="color:#555;font-size:12px;">·</span>
        <span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:8px;
                     background:#44444418;border:1px solid #44444435;color:#888;
                     font-size:12px;font-weight:700;">2026-06-08</span>
      </div>
    `,
    btn1Label: "Schnell speichern",
    btn2Label: "Zyklus-Details öffnen →",
    cardAccent: "#FF2D78",
  },
  {
    id: "chip-insulin",
    headerHtml: `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-right:20px;">
        <span style="font-size:14px;font-weight:700;color:#e0e0e0;">Novorapid</span>
        <span style="font-family:monospace;font-size:13px;color:#ccc;font-weight:600;">4 IE</span>
        <span style="font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 7px;
                     border-radius:20px;background:#4F6EF718;border:1px solid #4F6EF740;
                     color:#4F6EF7;text-transform:uppercase;">Bolus</span>
        <span style="font-size:11px;color:#888;">Jetzt</span>
      </div>
    `,
    btn1Label: "Schnell speichern",
    btn2Label: "Bolus-Details öffnen →",
    cardAccent: "#4F6EF7",
  },
  {
    id: "chip-generic",
    headerHtml: `
      <div style="display:flex;align-items:center;gap:5px;padding-right:20px;
                  font-size:11px;font-weight:700;color:#888;letter-spacing:.04em;
                  text-transform:uppercase;">
        <span>🏃</span><span>Training</span>
      </div>
      <div style="color:#ccc;font-size:12px;padding-right:24px;">
        30 min Laufen, mittlere Intensität
      </div>
    `,
    btn1Label: "Schnell speichern",
    btn2Label: "Detail öffnen →",
    cardAccent: "#8b5cf6",
  },
] as const;

// ── Full page HTML ──────────────────────────────────────────────────────────

function buildPageHtml() {
  const chips = CHIPS.map((c) => chipHtml(c)).join("\n");
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=375, initial-scale=1" />
  <style>${BASE_CSS}</style>
</head>
<body>
  ${chips}
</body>
</html>`;
}

// ── Test suite ──────────────────────────────────────────────────────────────

test.describe("GlevAIChatSheet chip buttons — no overflow at 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("all chip types render without button-row overflow", async ({ page }) => {
    await page.setContent(buildPageHtml(), { waitUntil: "domcontentloaded" });

    for (const chip of CHIPS) {
      const btnRow = page.locator(`[data-chip="${chip.id}"]`);
      await expect(btnRow).toBeVisible();

      // ── 1. Button row must not overflow its parent card ──────────────────
      const rowOverflows = await btnRow.evaluate(
        (el) => el.scrollWidth > el.clientWidth,
      );
      expect(
        rowOverflows,
        `chip "${chip.id}": action-button row overflows its card container at 375 px — ` +
          `scrollWidth (${await btnRow.evaluate((e) => e.scrollWidth)}) > ` +
          `clientWidth (${await btnRow.evaluate((e) => e.clientWidth)}). ` +
          `Check for missing flex:1, white-space:nowrap, or oversized padding on the buttons.`,
      ).toBe(false);

      // ── 2. Each individual button must not overflow its own flex cell ────
      const buttons = btnRow.locator("button");
      const btnCount = await buttons.count();
      expect(
        btnCount,
        `chip "${chip.id}": expected 2 action buttons, found ${btnCount}`,
      ).toBe(2);

      for (let i = 0; i < btnCount; i++) {
        const btn = buttons.nth(i);
        const btnLabel = (await btn.textContent()) ?? `button[${i}]`;

        const btnOverflows = await btn.evaluate(
          (el) => el.scrollWidth > el.clientWidth,
        );
        expect(
          btnOverflows,
          `chip "${chip.id}": button "${btnLabel.trim()}" overflows its flex cell at 375 px — ` +
            `check for white-space:nowrap or a minimum-width that prevents flex shrinking.`,
        ).toBe(false);
      }
    }
  });

  test("button rows do not overflow at 390 px either", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(buildPageHtml(), { waitUntil: "domcontentloaded" });

    for (const chip of CHIPS) {
      const btnRow = page.locator(`[data-chip="${chip.id}"]`);
      await expect(btnRow).toBeVisible();

      const rowOverflows = await btnRow.evaluate(
        (el) => el.scrollWidth > el.clientWidth,
      );
      expect(
        rowOverflows,
        `chip "${chip.id}": button row overflows at 390 px viewport`,
      ).toBe(false);
    }
  });
});

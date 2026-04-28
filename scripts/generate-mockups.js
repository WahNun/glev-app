/**
 * Generates two PNG mockups for the Dexcom Partnership Questionnaire.
 *
 *   public/mockup-consent-flow.png   390 x 780  (iPhone-portrait)
 *   public/mockup-data-flow.png      900 x 500  (landscape)
 *
 * Uses @napi-rs/canvas (drop-in canvas API, prebuilt binaries — works on
 * NixOS without cairo/pango system libs that node-canvas requires).
 * Run with:  node scripts/generate-mockups.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");

// ─── Brand palette ────────────────────────────────────────────────
const C = {
  bg:        "#111117",
  card:      "#1C1C28",
  cardBdr:   "rgba(255,255,255,0.08)",
  accent:    "#4F6EF7",
  white:     "#FFFFFF",
  dim:       "rgba(255,255,255,0.55)",
  dimmer:    "rgba(255,255,255,0.4)",
};
const FONT = "'DejaVu Sans'";

// ─── Helpers ──────────────────────────────────────────────────────
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, w, h, r, fill, stroke, lw = 1) {
  roundedRect(ctx, x, y, w, h, r);
  if (fill)   { ctx.fillStyle   = fill;   ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function text(ctx, str, x, y, { size = 14, weight = "400", color = C.white, align = "left", baseline = "alphabetic" } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

/** Tiny lock glyph drawn natively (~14x16). Used in place of 🔒 because
 *  the runtime has no emoji fonts available. */
function lockIcon(ctx, x, y, color = C.accent) {
  // shackle
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x + 7, y + 6, 4, Math.PI, 0, false);
  ctx.stroke();
  // body
  ctx.fillStyle = color;
  roundedRect(ctx, x + 1, y + 6, 12, 9, 1.5);
  ctx.fill();
  // keyhole
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.arc(x + 7, y + 10, 1.1, 0, Math.PI * 2);
  ctx.fill();
}

/** Tiny clipboard glyph drawn natively (~14x16). Used in place of 📋. */
function clipboardIcon(ctx, x, y, color = C.accent) {
  // body
  fillRoundedRect(ctx, x + 1, y + 2, 12, 13, 2, color);
  // clip
  ctx.fillStyle = color;
  roundedRect(ctx, x + 4, y, 6, 4, 1);
  ctx.fill();
  // lines
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 3.5, y + 7 + i * 2.5);
    ctx.lineTo(x + 10.5, y + 7 + i * 2.5);
    ctx.stroke();
  }
}

/** Arrow line with arrowhead. Optional label rendered above the line. */
function arrow(ctx, x1, y1, x2, y2, { color = C.accent, width = 2, label, labelOffset = -8 } = {}) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // arrowhead
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 9;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();

  if (label) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    // small backing rect so the label sits on top of the line cleanly
    ctx.font = `400 9px ${FONT}`;
    const w = ctx.measureText(label).width;
    if (Math.abs(x2 - x1) > Math.abs(y2 - y1)) {
      // horizontal arrow → label above
      ctx.fillStyle = C.bg;
      ctx.fillRect(mx - w / 2 - 4, my + labelOffset - 8, w + 8, 12);
      text(ctx, label, mx, my + labelOffset, { size: 9, color: C.dim, align: "center" });
    } else {
      // vertical arrow → label to the right
      ctx.fillStyle = C.bg;
      ctx.fillRect(mx + 6, my - 6, w + 8, 12);
      text(ctx, label, mx + 10, my + 3, { size: 9, color: C.dim, align: "left" });
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// 1) CONSENT FLOW MOCKUP — 390 x 780
// ══════════════════════════════════════════════════════════════════
function generateConsentFlow() {
  const W = 390, H = 780;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // top status-bar style line + back arrow + header label
  const headerY = 36;
  // back arrow ←
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(28, headerY);
  ctx.lineTo(20, headerY - 6);
  ctx.moveTo(28, headerY);
  ctx.lineTo(20, headerY + 6);
  ctx.moveTo(20, headerY);
  ctx.lineTo(34, headerY);
  ctx.stroke();
  text(ctx, "Verbindung einrichten", 46, headerY + 5, { size: 16, color: C.white, weight: "500" });

  // glev wordmark
  text(ctx, "glev", W / 2, 110, { size: 28, weight: "700", color: C.accent, align: "center" });

  // title + subtitle
  text(ctx, "Dexcom G7 verbinden", W / 2, 160, { size: 20, weight: "700", color: C.white, align: "center" });
  text(ctx, "Daten sicher teilen", W / 2, 184, { size: 14, color: C.dim, align: "center" });

  // ─── Card 1: Welche Daten? ──────────────────────────────────
  const cardX = 24, cardW = W - 48;
  const card1Y = 220, card1H = 132;
  fillRoundedRect(ctx, cardX, card1Y, cardW, card1H, 16, C.card, C.cardBdr);
  lockIcon(ctx, cardX + 18, card1Y + 18, C.accent);
  text(ctx, "WELCHE DATEN?", cardX + 40, card1Y + 30, { size: 12, weight: "700", color: C.accent });
  const dataItems = [
    "Glukosewerte (mg/dL · alle 5 min)",
    "Trendpfeile & Verlauf",
    "Kalibrierdaten & Sensor-Status",
  ];
  dataItems.forEach((line, i) => {
    text(ctx, "•", cardX + 22, card1Y + 60 + i * 22, { size: 13, color: C.accent });
    text(ctx, line, cardX + 36, card1Y + 60 + i * 22, { size: 12, color: C.white });
  });

  // ─── Card 2: Deine Rechte ───────────────────────────────────
  const card2Y = card1Y + card1H + 18, card2H = 132;
  fillRoundedRect(ctx, cardX, card2Y, cardW, card2H, 16, C.card, C.cardBdr);
  clipboardIcon(ctx, cardX + 18, card2Y + 18, C.accent);
  text(ctx, "DEINE RECHTE", cardX + 40, card2Y + 30, { size: 12, weight: "700", color: C.accent });
  const rightsItems = [
    "Jederzeit in Einstellungen widerrufbar",
    "Nur für deine Glev-Auswertungen genutzt",
    "DSGVO-konform · Supabase EU (Frankfurt)",
  ];
  rightsItems.forEach((line, i) => {
    text(ctx, "•", cardX + 22, card2Y + 60 + i * 22, { size: 13, color: C.accent });
    text(ctx, line, cardX + 36, card2Y + 60 + i * 22, { size: 12, color: C.white });
  });

  // ─── Primary button ─────────────────────────────────────────
  const btnY = card2Y + card2H + 36;
  const btnH = 52;
  fillRoundedRect(ctx, cardX, btnY, cardW, btnH, 12, C.accent);
  text(ctx, "Verbindung erlauben", W / 2, btnY + btnH / 2 + 6, {
    size: 16, weight: "700", color: C.white, align: "center",
  });

  // ─── Ghost button ───────────────────────────────────────────
  const ghostY = btnY + btnH + 12;
  const ghostH = 46;
  fillRoundedRect(ctx, cardX, ghostY, cardW, ghostH, 12, "transparent", "rgba(79,110,247,0.45)", 1.5);
  text(ctx, "Ablehnen", W / 2, ghostY + ghostH / 2 + 5, {
    size: 14, weight: "600", color: C.accent, align: "center",
  });

  // ─── Footer ─────────────────────────────────────────────────
  text(ctx, "Datenschutz  ·  AGB", W / 2, H - 22, {
    size: 10, color: C.dimmer, align: "center",
  });

  return canvas;
}

// ══════════════════════════════════════════════════════════════════
// 2) DATA FLOW DIAGRAM — 900 x 500
// ══════════════════════════════════════════════════════════════════
function generateDataFlow() {
  const W = 900, H = 500;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Title + subtitle (centered)
  text(ctx, "Glev — Datenfluss & Systemarchitektur", W / 2, 38, {
    size: 18, weight: "700", color: C.white, align: "center",
  });
  text(ctx, "Stand: April 2026  ·  DSGVO-konform  ·  Supabase EU (Frankfurt)", W / 2, 60, {
    size: 11, color: C.dim, align: "center",
  });

  // ─── Box geometry ───────────────────────────────────────────
  const BOX_W = 178, BOX_H = 110;
  const ROW1_Y = 110;
  const ROW2_Y = 320;
  // 4 boxes evenly spaced; gap such that total span fits centered in W
  const totalW = BOX_W * 4;
  const gap = (W - 60 - totalW) / 3;
  const xs = [
    30,
    30 + (BOX_W + gap),
    30 + 2 * (BOX_W + gap),
    30 + 3 * (BOX_W + gap),
  ];

  const boxes = [
    { title: "Dexcom G7 / ONE+", subtitle: "CGM Sensor",        detail: "BLE → Dexcom App" },
    { title: "Dexcom Web API",   subtitle: "OAuth 2.0",          detail: "HTTPS · api.dexcom.com" },
    { title: "Glev Backend",     subtitle: "Next.js API Routes", detail: "Vercel · Edge Network" },
    { title: "Supabase",         subtitle: "Postgres + Auth",    detail: "eu-central-1 (Frankfurt)" },
  ];

  function drawBox(x, y, b) {
    fillRoundedRect(ctx, x, y, BOX_W, BOX_H, 10, C.card, C.accent, 2);
    text(ctx, b.title,    x + BOX_W / 2, y + 32, { size: 13, weight: "700", color: C.accent, align: "center" });
    text(ctx, b.subtitle, x + BOX_W / 2, y + 58, { size: 11, weight: "500", color: C.white,  align: "center" });
    text(ctx, b.detail,   x + BOX_W / 2, y + 84, { size: 10, color: C.dim, align: "center" });
  }

  // Row 1
  boxes.forEach((b, i) => drawBox(xs[i], ROW1_Y, b));

  // Row 2: Glev App (centered below Box 3 / Glev Backend)
  const appBox = { title: "Glev App", subtitle: "iOS & Android", detail: "T1D Patient" };
  const appX = xs[2];
  drawBox(appX, ROW2_Y, appBox);

  // ─── Arrows between row 1 boxes ─────────────────────────────
  const midY = ROW1_Y + BOX_H / 2;
  const labels = ["BLE / HTTPS", "REST API · OAuth 2.0", "Real-time sync"];
  for (let i = 0; i < 3; i++) {
    const x1 = xs[i] + BOX_W + 6;
    const x2 = xs[i + 1] - 6;
    arrow(ctx, x1, midY, x2, midY, { label: labels[i] });
  }

  // ─── Vertical arrow: Glev Backend (box 3) ↓ Glev App ────────
  const vx = xs[2] + BOX_W / 2;
  arrow(ctx, vx, ROW1_Y + BOX_H + 6, vx, ROW2_Y - 6, { label: "WebSocket / Push" });

  // ─── Legend bottom-right ────────────────────────────────────
  const legendY = H - 50;
  const legendW = 380;
  const legendX = W - legendW - 30;
  fillRoundedRect(ctx, legendX, legendY, legendW, 32, 8, "rgba(79,110,247,0.08)", "rgba(79,110,247,0.3)", 1);
  lockIcon(ctx, legendX + 12, legendY + 8, C.accent);
  text(ctx, "Alle Verbindungen TLS 1.3  ·  Daten verlassen die EU nicht",
    legendX + 34, legendY + 20, { size: 10, weight: "500", color: C.white });

  return canvas;
}

// ─── Run ─────────────────────────────────────────────────────────
function main() {
  const outDir = path.join(__dirname, "..", "public");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const consent = generateConsentFlow();
  const consentPath = path.join(outDir, "mockup-consent-flow.png");
  fs.writeFileSync(consentPath, consent.toBuffer("image/png"));
  console.log("✓ mockup-consent-flow.png");

  const flow = generateDataFlow();
  const flowPath = path.join(outDir, "mockup-data-flow.png");
  fs.writeFileSync(flowPath, flow.toBuffer("image/png"));
  console.log("✓ mockup-data-flow.png");
}

main();

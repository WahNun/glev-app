/**
 * Generates a 2× pixel-density PNG of the Glev email signature for use as
 * a screenshot/preview in proposals, decks and partner outreach where the
 * raw HTML version cannot be embedded.
 *
 *   public/email-signature.png   1200 × ~520
 *
 * Uses @napi-rs/canvas with the founder photo from public/founder.png.
 * Run with:  node scripts/generate-email-signature.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const C = {
  bg:        "#FAFBFF",
  bodyBg:    "#f0f2f8",
  accent:    "#4F6EF7",
  accentDim: "rgba(79,110,247,0.3)",
  text:      "#1a1a2e",
  textDim:   "rgba(26,26,46,0.55)",
  textHint:  "rgba(26,26,46,0.35)",
  discText:  "#888",
  discLabel: "#555",
};
const FONT = "'DejaVu Sans'";

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const DE = "Diese E-Mail und ihre Anhänge können vertrauliche und rechtlich geschützte Informationen enthalten. Falls Sie nicht der beabsichtigte Empfänger sind, informieren Sie bitte umgehend den Absender und löschen Sie diese Nachricht. Jede unbefugte Weitergabe, Vervielfältigung oder Nutzung ist untersagt.";
const EN = "This email and any attachments may contain confidential and legally privileged information. If you are not the intended recipient, please notify the sender immediately and delete this message. Any unauthorised disclosure, copying or use is strictly prohibited.";

async function buildSignature() {
  const SCALE = 2;
  const W = 600;

  // First pass: measure how tall the disclaimer block needs to be so we
  // can size the canvas exactly. 10px font, line-height 15, 16px side
  // padding → usable width 568. First line of each block is shifted right
  // by the label width (~24px), so wrap at the more conservative 540.
  const probe = createCanvas(10, 10).getContext("2d");
  probe.font = `400 10px ${FONT}`;
  const innerW = W - 32 - 24;
  const deLines = wrapLines(probe, DE, innerW);
  const enLines = wrapLines(probe, EN, innerW);
  const lineH = 15;
  const discBodyH = (deLines.length + enLines.length) * lineH + 8;
  const discTotalH = 10 + discBodyH + 14;

  const mainH = 120;
  const sepH = 1;
  const H = mainH + sepH + discTotalH;

  const canvas = createCanvas(W * SCALE, H * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  // page background (mimics the body wrapper of the html version)
  ctx.fillStyle = C.bodyBg;
  ctx.fillRect(0, 0, W, H);

  // signature card (rounded background)
  ctx.save();
  roundedRect(ctx, 0, 0, W, H, 8);
  ctx.clip();
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // left accent bar — full card height
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, 4, H);

  // ─── Photo (round, accent border) ───────────────────────────
  const photo = await loadImage(path.join(__dirname, "..", "public", "founder.png"));
  const px = 20, py = 20, ps = 80;
  ctx.save();
  ctx.beginPath();
  ctx.arc(px + ps / 2, py + ps / 2, ps / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(photo, px, py, ps, ps);
  ctx.restore();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px + ps / 2, py + ps / 2, ps / 2, 0, Math.PI * 2);
  ctx.stroke();

  // ─── Text block ─────────────────────────────────────────────
  const tx = 120;
  ctx.textBaseline = "top";

  // Name
  ctx.fillStyle = C.text;
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText("Lucas Wahnon", tx, 26);

  // Title
  ctx.fillStyle = C.textDim;
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText("Glev Founder", tx, 50);

  // Separator below title
  ctx.fillStyle = C.accentDim;
  ctx.fillRect(tx, 72, 240, 1);

  // Contact line 1: email · website
  let cy = 80;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText("hallo@glev.app", tx, cy);
  const m1 = ctx.measureText("hallo@glev.app").width;
  ctx.fillStyle = C.textHint;
  ctx.fillText("  ·  ", tx + m1, cy);
  const m1sep = ctx.measureText("  ·  ").width;
  ctx.fillStyle = C.accent;
  ctx.fillText("glev.app", tx + m1 + m1sep, cy);

  // Contact line 2: phone (WhatsApp)
  cy = 100;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText("+351 963 004 998", tx, cy);
  const m2 = ctx.measureText("+351 963 004 998").width;
  ctx.fillStyle = C.textDim;
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText("  (WhatsApp)", tx + m2, cy);

  // ─── Wordmark top-right ─────────────────────────────────────
  ctx.font = `800 22px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.textAlign = "right";
  ctx.fillText("glev", W - 16, 24);
  ctx.textAlign = "left";

  // ─── Separator full-width ───────────────────────────────────
  ctx.fillStyle = C.accentDim;
  ctx.fillRect(16, mainH, W - 32, 1);

  // ─── Disclaimer block ───────────────────────────────────────
  let dy = mainH + 10;

  // DE
  ctx.fillStyle = C.discLabel;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText("DE:", 16, dy);
  const deLabelW = ctx.measureText("DE: ").width;
  ctx.fillStyle = C.discText;
  ctx.font = `400 10px ${FONT}`;
  ctx.fillText(deLines[0], 16 + deLabelW, dy);
  for (let i = 1; i < deLines.length; i++) {
    dy += lineH;
    ctx.fillText(deLines[i], 16, dy);
  }
  dy += lineH + 8;

  // EN
  ctx.fillStyle = C.discLabel;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText("EN:", 16, dy);
  const enLabelW = ctx.measureText("EN: ").width;
  ctx.fillStyle = C.discText;
  ctx.font = `400 10px ${FONT}`;
  ctx.fillText(enLines[0], 16 + enLabelW, dy);
  for (let i = 1; i < enLines.length; i++) {
    dy += lineH;
    ctx.fillText(enLines[i], 16, dy);
  }

  ctx.restore();
  return canvas;
}

async function main() {
  const sig = await buildSignature();
  const out = path.join(__dirname, "..", "public", "email-signature.png");
  fs.writeFileSync(out, sig.toBuffer("image/png"));
  console.log("✓ email-signature.png");
}

main().catch((e) => { console.error(e); process.exit(1); });

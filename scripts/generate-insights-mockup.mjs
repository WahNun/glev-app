import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, "../outputs/insights-mockup.png");

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

const clusters = [
  {
    id: "glucose-basics",
    title: "Glukose-Basics",
    cardCountLabel: "6 Karten",
    tint: "#4F6EF7",
    icon: "droplet",
    kpi: "98%",
    kpiLabel: "TIR diese Woche",
  },
  {
    id: "meals-bolus",
    title: "Mahlzeiten & Bolus",
    cardCountLabel: "4 Karten",
    tint: "#22D3A0",
    icon: "utensils",
    kpi: "4,5 IE",
    kpiLabel: "Ø Bolus",
  },
  {
    id: "adaptive-engine",
    title: "Adaptive Engine & Insulin",
    cardCountLabel: "3 Karten",
    tint: "#FF9500",
    icon: "brain-circuit",
    kpi: "1:12",
    kpiLabel: "Adaptive ICR",
  },
  {
    id: "workout-activity",
    title: "Workout & Aktivität",
    cardCountLabel: "7 Karten",
    tint: "#7F77DD",
    icon: "activity",
    kpi: "8.241",
    kpiLabel: "Ø Schritte/Tag",
    locked: true,
  },
  {
    id: "cycle-symptoms",
    title: "Zyklus & Symptome",
    cardCountLabel: "1 Karte",
    tint: "#FF2D78",
    icon: "moon",
    kpi: "Phase 2",
    kpiLabel: "aktuell",
  },
];

const ICONS = {
  droplet: `<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  utensils: `<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="7" y1="2" x2="7" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 15V2a5 5 0 0 0-5 5v6h3.5l-1.5 9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  moon: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "brain-circuit": `<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="13" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 13h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
  activity: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  lock: `<rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  chevron: `<polyline points="9 18 15 12 9 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
};

function svgIcon(name, size = 20, color = "currentColor") {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${color};display:block;">${ICONS[name] ?? ""}</svg>`;
}

function hex(color, alpha) {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return color + a;
}

function renderCard(c) {
  const lockedOverlay = c.locked
    ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.38);border-radius:16px;pointer-events:none;"></div>
       <div style="position:absolute;top:12px;right:12px;background:#7F77DD;color:#fff;font-size:11px;font-weight:700;letter-spacing:0.07em;padding:3px 10px;border-radius:20px;z-index:2;">GLEV+</div>`
    : "";

  const lockIcon = c.locked
    ? `<span style="margin-left:6px;opacity:0.7;">${svgIcon("lock", 15, "#fff")}</span>`
    : "";

  return `
    <div style="
      position:relative;
      background:linear-gradient(135deg, ${hex(c.tint, 0.1)} 0%, transparent 50%), #18181B;
      border-radius:16px;
      padding:20px;
      min-height:100px;
      display:flex;
      align-items:center;
      gap:16px;
      overflow:hidden;
      box-sizing:border-box;
      opacity:${c.locked ? 0.72 : 1};
    ">
      <div style="
        position:absolute;
        left:0; top:0; bottom:0;
        width:4px;
        background:${c.tint};
        border-radius:16px 0 0 16px;
      "></div>

      <div style="
        width:44px; height:44px;
        background:${hex(c.tint, 0.15)};
        border-radius:12px;
        display:flex; align-items:center; justify-content:center;
        flex-shrink:0;
        margin-left:8px;
      ">
        ${svgIcon(c.icon, 22, c.tint)}
      </div>

      <div style="flex:1; min-width:0;">
        <div style="display:flex;align-items:center;gap:4px;">
          <span style="font-size:17px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.title}</span>
          ${lockIcon}
        </div>
        <div style="font-size:13px;color:#71717A;margin-top:2px;">${c.cardCountLabel}</div>
      </div>

      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:24px;font-weight:500;color:#fff;line-height:1.1;">${c.kpi}</div>
        <div style="font-size:12px;color:#71717A;margin-top:2px;white-space:nowrap;">${c.kpiLabel}</div>
      </div>

      <div style="color:#52525B;flex-shrink:0;">${svgIcon("chevron", 18, "#52525B")}</div>

      ${lockedOverlay}
    </div>
  `;
}

const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=375, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #09090B;
    font-family: "Inter", sans-serif;
    width: 375px;
    min-height: 812px;
    -webkit-font-smoothing: antialiased;
  }
</style>
</head>
<body>
<div style="display:flex;flex-direction:column;min-height:812px;">

  <!-- Status Bar -->
  <div style="height:44px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;flex-shrink:0;">
    <span style="color:#fff;font-size:15px;font-weight:600;">9:41</span>
    <div style="display:flex;align-items:center;gap:6px;">
      <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
        <rect x="0" y="3" width="3" height="9" rx="1" fill="white" opacity="0.4"/>
        <rect x="4.5" y="2" width="3" height="10" rx="1" fill="white" opacity="0.6"/>
        <rect x="9" y="0" width="3" height="12" rx="1" fill="white"/>
        <rect x="13.5" y="1" width="3" height="10" rx="1.5" fill="white" opacity="0.9"/>
      </svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="white"><path d="M8 2.4C10.5 2.4 12.7 3.5 14.2 5.2L15.5 3.9C13.6 1.9 11 0.8 8 0.8C5 0.8 2.4 1.9 0.5 3.9L1.8 5.2C3.3 3.5 5.5 2.4 8 2.4Z" opacity="0.4"/><path d="M8 5.6C9.7 5.6 11.2 6.3 12.3 7.4L13.6 6.1C12.1 4.7 10.2 3.9 8 3.9C5.8 3.9 3.9 4.7 2.4 6.1L3.7 7.4C4.8 6.3 6.3 5.6 8 5.6Z" opacity="0.7"/><circle cx="8" cy="10.5" r="1.5"/></svg>
      <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
        <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="white" stroke-opacity="0.35"/>
        <rect x="2" y="2" width="17" height="8" rx="2" fill="white"/>
        <path d="M23 4.5v3a1.5 1.5 0 0 0 0-3Z" fill="white" fill-opacity="0.4"/>
      </svg>
    </div>
  </div>

  <!-- Top Nav -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 20px 12px;flex-shrink:0;">
    <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px;">glev.</span>
    <div style="background:rgba(34,211,160,0.15);border:1px solid rgba(34,211,160,0.35);border-radius:20px;padding:4px 12px;display:flex;align-items:center;gap:6px;">
      <div style="width:7px;height:7px;border-radius:50%;background:#22D3A0;box-shadow:0 0 6px #22D3A0;"></div>
      <span style="color:#22D3A0;font-size:12px;font-weight:600;letter-spacing:0.08em;">LIVE</span>
    </div>
  </div>

  <!-- Page Header -->
  <div style="padding:4px 20px 16px;flex-shrink:0;">
    <h1 style="font-size:28px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Insights</h1>
    <p style="font-size:13px;color:#71717A;margin-top:4px;">Karte tippen zum Eintauchen</p>
  </div>

  <!-- Cards -->
  <div style="flex:1;padding:0 16px;display:flex;flex-direction:column;gap:12px;">
    ${clusters.map(renderCard).join("\n")}
  </div>

  <!-- Bottom Nav -->
  <div style="
    height:82px;
    background:rgba(255,255,255,0.055);
    backdrop-filter:blur(24px);
    border-top:1px solid rgba(255,255,255,0.08);
    display:flex;
    align-items:center;
    justify-content:space-around;
    padding:0 4px;
    margin-top:16px;
    flex-shrink:0;
  ">
    ${["DASH", "LOG", null, "INSIGHTS", "SETTINGS"].map((label, i) => {
      if (label === null) {
        return `<div style="width:56px;height:56px;background:linear-gradient(135deg,#22D3A0,#4F6EF7);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(34,211,160,0.4),0 8px 24px rgba(0,0,0,0.4);">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.5px;">g</span>
        </div>`;
      }
      const active = label === "INSIGHTS";
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
        <span style="font-size:10px;font-weight:${active ? 700 : 500};color:${active ? "#22D3A0" : "#52525B"};letter-spacing:0.06em;">${label}</span>
        ${active ? `<div style="width:4px;height:4px;border-radius:50%;background:#22D3A0;"></div>` : ""}
      </div>`;
    }).join("")}
  </div>

</div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({
    path: OUTPUT_PATH,
    fullPage: true,
    scale: "device",
  });
  await browser.close();
  process.stderr.write(`\n✅ Mockup gespeichert: ${OUTPUT_PATH}\n\n`);
})();

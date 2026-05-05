#!/usr/bin/env node
/**
 * refresh-mockups.mjs
 *
 * Loggt sich mit dem Test-Account in die laufende Glev-Preview ein
 * und zieht frische iPhone-große Screenshots der vier Hauptscreens,
 * die als Mockups auf der öffentlichen Homepage gezeigt werden.
 *
 * Output → public/mockups/{dashboard,engine,macros,insights}.png
 *
 * Env vars (Pflicht):
 *   MOCKUP_USER_EMAIL     — Login-Email des Mockup-Users
 *   MOCKUP_USER_PASSWORD  — Passwort
 *
 * Env vars (optional):
 *   MOCKUP_BASE_URL       — defaults to http://localhost:5000
 *
 * Aufruf:
 *   MOCKUP_USER_EMAIL=… MOCKUP_USER_PASSWORD=… node scripts/refresh-mockups.mjs
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "mockups");

const BASE =
  process.env.MOCKUP_BASE_URL ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:5000");
const EMAIL = process.env.MOCKUP_USER_EMAIL;
const PASSWORD = process.env.MOCKUP_USER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("MOCKUP_USER_EMAIL und MOCKUP_USER_PASSWORD müssen gesetzt sein.");
  process.exit(1);
}

// iPhone-15-Pro-ähnlich. Aspect 393:852 ≈ 1:2.17 — passt sauber in
// die Phone-Shell auf der Homepage (320:660 ≈ 1:2.06, kommt mit
// objectFit:cover sauber durch).
const VIEWPORT = { width: 393, height: 852 };

const CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.92/bin/chromium";

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: "de-DE",
    extraHTTPHeaders: { "accept-language": "de-DE,de;q=0.9" },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  // Dark theme erzwingen — Konsistenz mit dem Hero-Phone (das ist
  // intentional dunkel) und mit den frischen Screenshots, die Lucas
  // selbst geliefert hat.
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem("glev_theme", "dark");
      document.documentElement.setAttribute("data-theme", "dark");
    } catch {}
  });

  // 1. Login
  console.log("→ login", BASE);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 45000 });
  console.log("  ok →", page.url());

  // 1b. Onboarding ggf. wegklicken — der Test-Account landet auf
  // /onboarding und blockt alle anderen Routen. "Überspringen" oben
  // rechts springt zum Dashboard.
  await page.waitForTimeout(1500);
  for (let i = 0; i < 6; i++) {
    const skip = page.locator('text=/^(Überspringen|Skip)$/').first();
    if (!(await skip.count())) break;
    await skip.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  console.log("  onboarding cleared →", page.url());

  // 2. Dashboard
  console.log("→ dashboard");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: resolve(OUT_DIR, "dashboard.png"), fullPage: false });

  // 3. Engine — Step 1 (Essen / Voice)
  console.log("→ engine step 1");
  await page.goto(`${BASE}/engine`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(OUT_DIR, "engine.png"), fullPage: false });

  // 4. History — switch via Header-Chip-Dropdown zwischen Insights
  // und Einträge. Helper, der den Chip öffnet, einen Tab anklickt
  // und das Dropdown wieder schließt.
  async function selectHistoryTab(label) {
    const chip = page.locator('header button, [role="banner"] button').filter({
      hasText: /(Insights|Einträge|Entries)/,
    }).first();
    if (!(await chip.count())) return;
    await chip.click().catch(() => {});
    await page.waitForTimeout(400);
    const item = page.locator('[role="menu"] button, [role="listbox"] button, button')
      .filter({ hasText: new RegExp(`^${label}$`) })
      .first();
    if (await item.count()) {
      await item.click().catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.mouse.click(10, 400).catch(() => {});
    await page.waitForTimeout(600);
  }

  console.log("→ history (insights)");
  await page.goto(`${BASE}/history`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2000);
  await selectHistoryTab("Insights");
  await page.screenshot({ path: resolve(OUT_DIR, "insights.png"), fullPage: false });

  console.log("→ history (einträge)");
  await selectHistoryTab("Einträge");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(OUT_DIR, "entries.png"), fullPage: false });

  await browser.close();
  console.log("\n✓ Mockups aktualisiert in public/mockups/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

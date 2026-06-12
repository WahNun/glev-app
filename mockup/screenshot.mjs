import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "footer-glass.html");
const outPath  = path.join(__dirname, "footer-glass-mockup.png");

const browser = await chromium.launch();
const page = await browser.newPage();

await page.setViewportSize({ width: 390, height: 844, deviceScaleFactor: 3 });
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(300); // let backdrop-filter settle

await page.screenshot({ path: outPath, fullPage: false });
await browser.close();

const { size } = fs.statSync(outPath);
console.log(`✅ Saved: ${outPath} (${(size / 1024).toFixed(0)} KB)`);

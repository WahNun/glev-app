import sharp from "sharp";
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";

const SRC_DIR = "public/mockups";
const OUT_DIR = "android/store-listing/screenshots";
const CANVAS_W = 1080;
const CANVAS_H = 1920;
const BG = { r: 10, g: 10, b: 15, alpha: 1 };

const SOURCES = [
  { src: "dashboard.png", out: "01-dashboard.png" },
  { src: "engine.png", out: "02-engine.png" },
  { src: "insights.png", out: "03-insights.png" },
  { src: "entries.png", out: "04-entries.png" },
];

for (const { src, out } of SOURCES) {
  const inputPath = join(SRC_DIR, src);
  const outputPath = join(OUT_DIR, out);

  const { width, height } = await sharp(inputPath).metadata();
  const scale = Math.min(CANVAS_W / width, CANVAS_H / height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const resized = await sharp(inputPath)
    .resize(newW, newH, { fit: "contain", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS_W,
      height: CANVAS_H,
      channels: 4,
      background: BG,
    },
  })
    .composite([
      {
        input: resized,
        top: Math.round((CANVAS_H - newH) / 2),
        left: Math.round((CANVAS_W - newW) / 2),
      },
    ])
    .png()
    .toFile(outputPath);

  console.log(`Wrote ${outputPath} (${CANVAS_W}x${CANVAS_H})`);
}

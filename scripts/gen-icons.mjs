import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "public");
const svgPath = path.join(root, "icon.svg");
const svg = await fs.readFile(svgPath);

const tasks = [
  { out: "icon-192.png", size: 192 },
  { out: "icon-512.png", size: 512 },
  { out: "apple-touch-icon.png", size: 180 },
  { out: "favicon-32.png", size: 32 },
  { out: "favicon-16.png", size: 16 },
];

for (const t of tasks) {
  await sharp(svg).resize(t.size, t.size).png().toFile(path.join(root, t.out));
  console.log("wrote", t.out);
}

const ico32 = await sharp(svg).resize(32, 32).png().toBuffer();
await fs.writeFile(path.join(root, "favicon.ico"), ico32);
console.log("wrote favicon.ico (32x32 PNG payload)");

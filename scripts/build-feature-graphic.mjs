import sharp from "sharp";
import { writeFileSync } from "node:fs";

const W = 1024;
const H = 500;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A0A0F"/>
      <stop offset="55%" stop-color="#11131C"/>
      <stop offset="100%" stop-color="#1B2347"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#4F6EF7" stop-opacity="0.35"/>
      <stop offset="60%" stop-color="#4F6EF7" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#4F6EF7" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- subtle grid lines (CGM trace feel) -->
  <g stroke="#4F6EF7" stroke-opacity="0.08" stroke-width="1">
    <line x1="0" y1="120" x2="${W}" y2="120"/>
    <line x1="0" y1="220" x2="${W}" y2="220"/>
    <line x1="0" y1="320" x2="${W}" y2="320"/>
    <line x1="0" y1="420" x2="${W}" y2="420"/>
  </g>

  <!-- abstract glucose curve -->
  <path d="M 0 320 C 120 240, 220 360, 340 300 S 540 220, 660 280 S 860 360, 1024 240"
        fill="none" stroke="#4F6EF7" stroke-opacity="0.55" stroke-width="3"
        stroke-linecap="round"/>

  <!-- App icon mark (mirrors public/icon.svg, scaled & repositioned) -->
  <g transform="translate(70 150) scale(6)">
    <rect width="32" height="32" rx="9" fill="#0F0F14"/>
    <line x1="16" y1="7"  x2="25" y2="12" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="25" y1="12" x2="25" y2="20" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="25" y1="20" x2="18" y2="26" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="18" y1="26" x2="9"  y2="22" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="9"  y1="22" x2="7"  y2="14" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="7"  y1="14" x2="16" y2="7"  stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="16" y1="7"  x2="16" y2="16" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="25" y1="12" x2="16" y2="16" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="25" y1="20" x2="16" y2="16" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <line x1="18" y1="26" x2="16" y2="16" stroke="#4F6EF7" stroke-width="0.9" stroke-opacity="0.55"/>
    <circle cx="16" cy="7"  r="2" fill="#4F6EF740" stroke="#4F6EF7" stroke-width="0.8"/>
    <circle cx="25" cy="12" r="2" fill="#4F6EF740" stroke="#4F6EF7" stroke-width="0.8"/>
    <circle cx="25" cy="20" r="2" fill="#4F6EF740" stroke="#4F6EF7" stroke-width="0.8"/>
    <circle cx="18" cy="26" r="2" fill="#4F6EF740" stroke="#4F6EF7" stroke-width="0.8"/>
    <circle cx="9"  cy="22" r="2" fill="#4F6EF740" stroke="#4F6EF7" stroke-width="0.8"/>
    <circle cx="7"  cy="14" r="2" fill="#4F6EF740" stroke="#4F6EF7" stroke-width="0.8"/>
    <circle cx="16" cy="16" r="3.5" fill="#4F6EF7"/>
  </g>

  <!-- Wordmark + tagline -->
  <text x="320" y="245"
        font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif"
        font-size="120" font-weight="700" fill="#FFFFFF"
        letter-spacing="-2">Glev</text>

  <text x="324" y="305"
        font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif"
        font-size="32" font-weight="500" fill="#A6B0D0">
    Typ&#160;1. Neu gedacht.
  </text>

  <text x="324" y="355"
        font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif"
        font-size="22" font-weight="400" fill="#7A85A8">
    Sprich deine Mahlzeit. Glev rechnet die Makros.
  </text>
</svg>
`;

const out = "android/store-listing/graphics/feature-graphic-1024x500.png";

await sharp(Buffer.from(svg))
  .png()
  .toFile(out);

console.log("Wrote", out);

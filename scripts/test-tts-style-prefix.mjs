#!/usr/bin/env node
/**
 * scripts/test-tts-style-prefix.mjs
 *
 * Verifies whether the Voxtral TTS style prefix improves voice quality by
 * generating two MP3 files for manual A/B listening comparison:
 *
 *   (a) with_prefix.mp3  — current stylePrefix + input text (as deployed)
 *   (b) no_prefix.mp3    — bare input text, no prefix
 *
 * Both files are saved to /tmp for manual comparison.
 *
 * Usage:
 *   GLEV_SESSION_TOKEN=<bearer-token> node scripts/test-tts-style-prefix.mjs
 *
 *   # Override server URL (default: http://localhost:3000):
 *   TTS_BASE_URL=https://glev.app node scripts/test-tts-style-prefix.mjs
 *
 *   # Override input text:
 *   TTS_TEST_TEXT="Dein Glukosewert liegt bei 6.2 mmol/L." node scripts/test-tts-style-prefix.mjs
 *
 * How to obtain GLEV_SESSION_TOKEN:
 *   1. Log in to the app in a browser.
 *   2. Open DevTools → Application → Cookies → copy the `sb-*-auth-token` value
 *      (Supabase access token, starts with "eyJ").
 *   3. Pass it as GLEV_SESSION_TOKEN.
 *
 * Output:
 *   /tmp/tts_with_prefix.mp3   — style prefix applied
 *   /tmp/tts_no_prefix.mp3     — bare text, no prefix
 *
 * After listening, document findings in docs/VOICE_ARCHITECTURE.md under
 * "Style prefix evaluation".
 */

import fs from "fs";
import path from "path";

const BASE_URL = process.env.TTS_BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.GLEV_SESSION_TOKEN ?? "";
const OUT_DIR = "/tmp";

// Representative clinical sentence in German — same language/content the TTS
// handles in production. Keep it short (< 40 words) so the vocal character
// difference is immediately audible, not masked by length.
const TEST_TEXT =
  process.env.TTS_TEST_TEXT ??
  "Dein Glukosewert liegt bei 6,2 mmol/L und ist stabil. " +
    "Basierend auf deiner letzten Mahlzeit und dem aktuellen Trend " +
    "sieht alles gut aus — kein Handlungsbedarf im Moment.";

if (!TOKEN) {
  console.error(
    "Error: GLEV_SESSION_TOKEN is not set.\n" +
      "Obtain a Supabase access token from the browser and set it:\n" +
      "  GLEV_SESSION_TOKEN=eyJ... node scripts/test-tts-style-prefix.mjs"
  );
  process.exit(1);
}

/**
 * Calls POST /api/tts/mistral and returns the raw MP3 bytes.
 *
 * @param {string} inputText    - Text to synthesize (bare — the route adds the prefix unless skipPrefix is set)
 * @param {boolean} skipPrefix  - When true, passes skip_style_prefix:true to bypass the server-side prefix
 * @returns {Promise<Buffer>}
 */
async function fetchTts(inputText, skipPrefix = false) {
  const res = await fetch(`${BASE_URL}/api/tts/mistral`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      text: inputText,
      ...(skipPrefix ? { skip_style_prefix: true } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`TTS request failed (${res.status}): ${detail}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  console.log(`TTS base URL : ${BASE_URL}`);
  console.log(`Output dir  : ${OUT_DIR}`);
  console.log(`Test text   :\n  "${TEST_TEXT}"\n`);

  // --- Variant A: with style prefix (mirrors production behaviour) ---
  // The route prepends stylePrefix server-side when skip_style_prefix is absent.
  console.log("Generating variant A: with_prefix …");
  const withPrefixBytes = await fetchTts(TEST_TEXT, false);
  const withPrefixPath = path.join(OUT_DIR, "tts_with_prefix.mp3");
  fs.writeFileSync(withPrefixPath, withPrefixBytes);
  console.log(`  ✓ Saved ${withPrefixBytes.length} bytes → ${withPrefixPath}`);

  // Small delay to avoid hitting rate limits / Mistral concurrency cap
  await new Promise((r) => setTimeout(r, 1500));

  // --- Variant B: bare text, no prefix ---
  // skip_style_prefix:true tells the route to pass text to Voxtral unchanged.
  console.log("Generating variant B: no_prefix …");
  const noPrefixBytes = await fetchTts(TEST_TEXT, true);
  const noPrefixPath = path.join(OUT_DIR, "tts_no_prefix.mp3");
  fs.writeFileSync(noPrefixPath, noPrefixBytes);
  console.log(`  ✓ Saved ${noPrefixBytes.length} bytes → ${noPrefixPath}`);

  console.log(`
────────────────────────────────────────────
A/B files ready for listening:

  ${withPrefixPath}   ← with style prefix (current production)
  ${noPrefixPath}     ← bare text, no prefix

Listen to both and note:
  1. Warmth / naturalness of tone
  2. Speaking pace / rhythm
  3. Any artefacts or robotic quality

Then document the finding in:
  docs/VOICE_ARCHITECTURE.md → "Style prefix evaluation"

If there is no audible difference:
  → Remove the stylePrefix constant from app/api/tts/mistral/route.ts
    (or keep it only when ref_audio is active, where LLM-side instructions
     may reinforce voice-clone fidelity — see note in VOICE_ARCHITECTURE.md)
────────────────────────────────────────────`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

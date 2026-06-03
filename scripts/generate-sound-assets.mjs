#!/usr/bin/env node
/**
 * scripts/generate-sound-assets.mjs
 *
 * Algorithmisch generiert `glev_low_alarm.wav` als reinen PCM-Buffer
 * (keine externen Audio-Libraries nötig) und lädt die Datei optional
 * in den Supabase-Storage-Bucket `sound-assets` hoch.
 *
 * Verwendung:
 *   node scripts/generate-sound-assets.mjs [--out-dir <pfad>] [--upload]
 *
 * Flags:
 *   --out-dir <pfad>   Zielverzeichnis (Default: ./tmp)
 *   --upload           Nach der Generierung in Supabase Storage hochladen
 *
 * Env-Variablen (für --upload):
 *   SUPABASE_URL              oder  NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const outDirIdx = args.indexOf("--out-dir");
const outDir = outDirIdx !== -1 ? args[outDirIdx + 1] : "tmp";
const doUpload = args.includes("--upload");

// ---------------------------------------------------------------------------
// WAV generation — pure Node.js, no external audio library
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

// -3 dBFS amplitude  (32767 × 10^(−3/20) ≈ 23198)
const AMPLITUDE = Math.round(32767 * Math.pow(10, -3 / 20));

// Beep pattern (all durations in seconds)
//   880 Hz  200 ms → silence 75 ms → 1046 Hz 200 ms → silence 75 ms
//   Repeat 6× → 3.3 s total
const BEEP_A_FREQ = 880;   // Hz
const BEEP_B_FREQ = 1046;  // Hz (C6 — distinct from 880 Hz = A5)
const BEEP_DURATION = 0.2; // seconds per beep
const SILENCE_SHORT = 0.075; // seconds between beeps within a pair
const SILENCE_LONG = 0.075;  // seconds between pairs (after second beep)
const REPEAT_COUNT = 6;
const RAMP_DURATION = 0.010; // 10 ms ramp to avoid clicks

function generateSine(freq, durationSec, rampSec = RAMP_DURATION) {
  const totalSamples = Math.round(durationSec * SAMPLE_RATE);
  const rampSamples = Math.round(rampSec * SAMPLE_RATE);
  const buf = Buffer.alloc(totalSamples * 2); // 16-bit = 2 bytes per sample
  for (let i = 0; i < totalSamples; i++) {
    const raw = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    let env = 1.0;
    if (i < rampSamples) env = i / rampSamples;
    else if (i > totalSamples - rampSamples) env = (totalSamples - i) / rampSamples;
    const sample = Math.round(raw * env * AMPLITUDE);
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

function generateSilence(durationSec) {
  const totalSamples = Math.round(durationSec * SAMPLE_RATE);
  return Buffer.alloc(totalSamples * 2, 0);
}

function buildWavBuffer(pcmData) {
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;
  const byteRate = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

  const header = Buffer.alloc(44);
  let off = 0;

  // RIFF chunk
  header.write("RIFF", off); off += 4;
  header.writeUInt32LE(fileSize, off); off += 4;
  header.write("WAVE", off); off += 4;

  // fmt sub-chunk
  header.write("fmt ", off); off += 4;
  header.writeUInt32LE(16, off); off += 4;           // chunk size
  header.writeUInt16LE(1, off); off += 2;            // PCM
  header.writeUInt16LE(NUM_CHANNELS, off); off += 2;
  header.writeUInt32LE(SAMPLE_RATE, off); off += 4;
  header.writeUInt32LE(byteRate, off); off += 4;
  header.writeUInt16LE(blockAlign, off); off += 2;
  header.writeUInt16LE(BITS_PER_SAMPLE, off); off += 2;

  // data sub-chunk
  header.write("data", off); off += 4;
  header.writeUInt32LE(dataSize, off);

  return Buffer.concat([header, pcmData]);
}

function generateAlarmWav() {
  const parts = [];
  for (let i = 0; i < REPEAT_COUNT; i++) {
    parts.push(generateSine(BEEP_A_FREQ, BEEP_DURATION));
    parts.push(generateSilence(SILENCE_SHORT));
    parts.push(generateSine(BEEP_B_FREQ, BEEP_DURATION));
    parts.push(generateSilence(SILENCE_LONG));
  }
  const pcm = Buffer.concat(parts);
  return buildWavBuffer(pcm);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ASSET_NAME = "glev_low_alarm.wav";

mkdirSync(outDir, { recursive: true });
const outPath = resolve(join(outDir, ASSET_NAME));

console.log(`Generating ${ASSET_NAME}...`);
console.log(`  Pattern : ${BEEP_A_FREQ} Hz / ${BEEP_B_FREQ} Hz alternating, ${REPEAT_COUNT}× double-beep`);
console.log(`  Duration: ~${((BEEP_DURATION * 2 + SILENCE_SHORT + SILENCE_LONG) * REPEAT_COUNT).toFixed(1)} seconds`);
console.log(`  Format  : 44.1 kHz, 16-bit mono WAV`);
console.log(`  Amplitude: −3 dBFS (${AMPLITUDE}/32767)`);

const wavBuffer = generateAlarmWav();
writeFileSync(outPath, wavBuffer);
console.log(`  Written : ${outPath} (${(wavBuffer.length / 1024).toFixed(1)} KB)`);

if (doUpload) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    console.error(
      "ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set for --upload.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Ensure bucket exists (ignore "already exists" error)
  const { error: bucketErr } = await supabase.storage.createBucket("sound-assets", {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5 MB
    allowedMimeTypes: ["audio/wav", "audio/x-wav"],
  });
  if (bucketErr && !bucketErr.message.includes("already exists")) {
    console.warn(`  Bucket create warning: ${bucketErr.message}`);
  }

  const fileBytes = readFileSync(outPath);
  const { error: uploadErr } = await supabase.storage
    .from("sound-assets")
    .upload(ASSET_NAME, fileBytes, {
      contentType: "audio/wav",
      upsert: true,
    });

  if (uploadErr) {
    console.error(`ERROR: Upload failed: ${uploadErr.message}`);
    process.exit(1);
  }

  const { data: urlData } = supabase.storage
    .from("sound-assets")
    .getPublicUrl(ASSET_NAME);

  console.log(`  Uploaded: ${urlData.publicUrl}`);
}

console.log("Done.");

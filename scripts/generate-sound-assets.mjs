#!/usr/bin/env node
/**
 * scripts/generate-sound-assets.mjs
 *
 * Algorithmisch generiert alle Glev-Sound-Assets als reine PCM-WAV-Buffer
 * (keine externen Audio-Libraries nötig) und lädt sie optional in den
 * Supabase-Storage-Bucket `sound-assets` hoch.
 *
 * Verwendung:
 *   node scripts/generate-sound-assets.mjs [--out-dir <pfad>] [--upload] [--only <name>]
 *
 * Flags:
 *   --out-dir <pfad>   Zielverzeichnis (Default: ./tmp)
 *   --upload           Nach der Generierung in Supabase Storage hochladen
 *   --only <name>      Nur diesen Asset-Namen generieren/uploaden
 *
 * Env-Variablen (für --upload):
 *   SUPABASE_URL              oder  NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Sound-Design:
 *   glev_low_alarm.wav      Hypo  — 880+1046 Hz, 6× dringend, −3 dBFS
 *   glev_high_alarm.wav     Hyper — 660+784 Hz,  4× mittel,   −3 dBFS
 *   glev_elevated.wav       Erhöht— 523 Hz,      3× sanft,    −6 dBFS
 *   glev_pre_check.wav      Pre-Bolus-Erinnerung — 440 Hz, 1× Ping
 *   glev_post_check.wav     Post-Bolus-Check     — 523→659 Hz aufsteigend
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
const onlyIdx = args.indexOf("--only");
const onlyName = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

// ---------------------------------------------------------------------------
// WAV primitives — pure Node.js, no external audio library
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

function dbfsAmplitude(dbfs) {
  return Math.round(32767 * Math.pow(10, dbfs / 20));
}

function generateSine(freq, durationSec, amplitude, rampSec = 0.010) {
  const totalSamples = Math.round(durationSec * SAMPLE_RATE);
  const rampSamples = Math.round(rampSec * SAMPLE_RATE);
  const buf = Buffer.alloc(totalSamples * 2);
  for (let i = 0; i < totalSamples; i++) {
    const raw = Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    let env = 1.0;
    if (i < rampSamples) env = i / rampSamples;
    else if (i > totalSamples - rampSamples) env = (totalSamples - i) / rampSamples;
    buf.writeInt16LE(Math.round(raw * env * amplitude), i * 2);
  }
  return buf;
}

function generateSweep(freqStart, freqEnd, durationSec, amplitude, rampSec = 0.010) {
  const totalSamples = Math.round(durationSec * SAMPLE_RATE);
  const rampSamples = Math.round(rampSec * SAMPLE_RATE);
  const buf = Buffer.alloc(totalSamples * 2);
  let phase = 0;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / totalSamples;
    const freq = freqStart + (freqEnd - freqStart) * t;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const raw = Math.sin(phase);
    let env = 1.0;
    if (i < rampSamples) env = i / rampSamples;
    else if (i > totalSamples - rampSamples) env = (totalSamples - i) / rampSamples;
    buf.writeInt16LE(Math.round(raw * env * amplitude), i * 2);
  }
  return buf;
}

function generateSilence(durationSec) {
  return Buffer.alloc(Math.round(durationSec * SAMPLE_RATE) * 2, 0);
}

function buildWav(pcmData) {
  const dataSize = pcmData.length;
  const byteRate = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const header = Buffer.alloc(44);
  let o = 0;
  header.write("RIFF", o); o += 4;
  header.writeUInt32LE(36 + dataSize, o); o += 4;
  header.write("WAVE", o); o += 4;
  header.write("fmt ", o); o += 4;
  header.writeUInt32LE(16, o); o += 4;
  header.writeUInt16LE(1, o); o += 2;
  header.writeUInt16LE(NUM_CHANNELS, o); o += 2;
  header.writeUInt32LE(SAMPLE_RATE, o); o += 4;
  header.writeUInt32LE(byteRate, o); o += 4;
  header.writeUInt16LE(blockAlign, o); o += 2;
  header.writeUInt16LE(BITS_PER_SAMPLE, o); o += 2;
  header.write("data", o); o += 4;
  header.writeUInt32LE(dataSize, o);
  return Buffer.concat([header, pcmData]);
}

// ---------------------------------------------------------------------------
// Sound generators — one per asset
// ---------------------------------------------------------------------------

/**
 * glev_low_alarm.wav — Hypo-Alarm
 * 880 Hz + 1046 Hz alternierend, 6× Doppel-Beep, −3 dBFS
 * Sehr dringend — sofortige Aufmerksamkeit nötig
 */
function generateLowAlarm() {
  const amp = dbfsAmplitude(-3);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push(generateSine(880, 0.20, amp));
    parts.push(generateSilence(0.075));
    parts.push(generateSine(1046, 0.20, amp));
    parts.push(generateSilence(0.075));
  }
  return buildWav(Buffer.concat(parts));
}

/**
 * glev_high_alarm.wav — Hyper-Alarm
 * 660 Hz + 784 Hz alternierend, 4× Doppel-Beep, −3 dBFS
 * Dringend aber etwas tiefer/ruhiger als Hypo
 */
function generateHighAlarm() {
  const amp = dbfsAmplitude(-3);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    parts.push(generateSine(660, 0.25, amp));
    parts.push(generateSilence(0.100));
    parts.push(generateSine(784, 0.25, amp));
    parts.push(generateSilence(0.200));
  }
  return buildWav(Buffer.concat(parts));
}

/**
 * glev_elevated.wav — Erhöhter BZ-Alarm
 * 523 Hz (C5) einzeln, 3× kurze Beeps, −6 dBFS
 * Sanfte Erinnerung — kein akuter Notfall
 */
function generateElevatedAlarm() {
  const amp = dbfsAmplitude(-6);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    parts.push(generateSine(523, 0.15, amp));
    parts.push(generateSilence(0.25));
  }
  return buildWav(Buffer.concat(parts));
}

// ---------------------------------------------------------------------------
// Asset registry
// ---------------------------------------------------------------------------

const ASSETS = [
  {
    name: "glev_low_alarm.wav",
    label: "Hypo-Alarm",
    description: "880+1046 Hz, 6× Doppel-Beep, −3 dBFS (~3.3 s)",
    generate: generateLowAlarm,
  },
  {
    name: "glev_high_alarm.wav",
    label: "Hyper-Alarm",
    description: "660+784 Hz, 4× Doppel-Beep, −3 dBFS (~2.6 s)",
    generate: generateHighAlarm,
  },
  {
    name: "glev_elevated.wav",
    label: "Erhöhter BZ",
    description: "523 Hz, 3× sanft, −6 dBFS (~1.2 s)",
    generate: generateElevatedAlarm,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });

const assetsToProcess = onlyName
  ? ASSETS.filter((a) => a.name === onlyName)
  : ASSETS;

if (onlyName && assetsToProcess.length === 0) {
  console.error(`ERROR: Unknown asset name "${onlyName}". Valid names: ${ASSETS.map((a) => a.name).join(", ")}`);
  process.exit(1);
}

const generatedPaths = [];

for (const asset of assetsToProcess) {
  console.log(`\nGenerating ${asset.name} (${asset.label})...`);
  console.log(`  ${asset.description}`);
  const wav = asset.generate();
  const outPath = resolve(join(outDir, asset.name));
  writeFileSync(outPath, wav);
  console.log(`  Written: ${outPath} (${(wav.length / 1024).toFixed(1)} KB)`);
  generatedPaths.push({ asset, outPath, wav });
}

if (doUpload) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for --upload.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { error: bucketErr } = await supabase.storage.createBucket("sound-assets", {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["audio/wav", "audio/x-wav"],
  });
  if (bucketErr && !bucketErr.message.includes("already exists")) {
    console.warn(`  Bucket create warning: ${bucketErr.message}`);
  }

  for (const { asset, outPath } of generatedPaths) {
    console.log(`\nUploading ${asset.name}...`);
    const fileBytes = readFileSync(outPath);
    const { error: uploadErr } = await supabase.storage
      .from("sound-assets")
      .upload(asset.name, fileBytes, { contentType: "audio/wav", upsert: true });

    if (uploadErr) {
      console.error(`  ERROR: ${uploadErr.message}`);
    } else {
      const { data: urlData } = supabase.storage.from("sound-assets").getPublicUrl(asset.name);
      console.log(`  ✓ ${urlData.publicUrl}`);
    }
  }
}

console.log("\nDone.");

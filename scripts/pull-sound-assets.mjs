#!/usr/bin/env node
/**
 * scripts/pull-sound-assets.mjs
 *
 * Lädt alle Dateien aus dem Supabase-Storage-Bucket `sound-assets` herunter
 * und legt sie in:
 *   - android/app/src/main/res/raw/
 *   - ios/App/App/
 *
 * Verwendung (vor jedem nativen Build ausführen):
 *   node scripts/pull-sound-assets.mjs
 *
 * Env-Variablen (.env.local):
 *   SUPABASE_URL              oder  NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_ANON_KEY         oder  NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Hinweis: Der Bucket ist public-read, daher reicht der Anon-Key.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const url =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "";
const key =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

if (!url || !key) {
  console.error(
    "ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY must be set.",
  );
  process.exit(1);
}

const BUCKET = "sound-assets";
const ANDROID_RAW_DIR = resolve("android/app/src/main/res/raw");
const IOS_BUNDLE_DIR = resolve("ios/App/App");

const TARGETS = [ANDROID_RAW_DIR, IOS_BUNDLE_DIR];

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Hardcoded — only alarm sounds go into the app bundle.
// Pre/Post-Check sounds are intentionally excluded (no sound for meal reminders).
const KNOWN_FILES = [
  "glev_low_alarm.wav",
  "glev_high_alarm.wav",
  "glev_elevated.wav",
];

console.log(`Pulling ${KNOWN_FILES.length} files from Supabase Storage bucket "${BUCKET}"...`);

for (const fileName of KNOWN_FILES) {
  const file = { name: fileName };

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(file.name);

  console.log(`  Downloading: ${file.name}`);
  let bytes;
  try {
    const res = await fetch(urlData.publicUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    bytes = Buffer.from(buf);
  } catch (err) {
    console.error(`  ERROR fetching ${file.name}: ${err.message}`);
    continue;
  }

  for (const dir of TARGETS) {
    if (!existsSync(dir)) {
      console.warn(`  WARN: Target directory does not exist, creating: ${dir}`);
      mkdirSync(dir, { recursive: true });
    }
    const outPath = join(dir, file.name);
    writeFileSync(outPath, bytes);
    console.log(`    → ${outPath}`);
  }
}

console.log("Done. Run 'npx cap sync' if Capacitor assets need updating.");

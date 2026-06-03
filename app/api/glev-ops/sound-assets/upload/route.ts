import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const BUCKET = "sound-assets";
const ALLOWED_MIME_TYPES = ["audio/wav", "audio/x-wav", "audio/wave"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  const authed = await isAdminAuthed();
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  const assetName = formData.get("asset_name");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file (WAV) required" }, { status: 400 });
  }
  if (!assetName || typeof assetName !== "string" || !assetName.trim()) {
    return NextResponse.json({ error: "asset_name (string) required" }, { status: 400 });
  }

  const name = assetName.trim();
  if (!name.endsWith(".wav")) {
    return NextResponse.json({ error: "Only .wav files are allowed" }, { status: 400 });
  }
  if (!/^[a-z0-9_.-]+\.wav$/.test(name)) {
    return NextResponse.json(
      { error: "asset_name must be lowercase alphanumeric with underscores/hyphens" },
      { status: 400 },
    );
  }

  if (!ALLOWED_MIME_TYPES.some((t) => file.type.startsWith(t.split("/")[0]) && file.type.includes("wav"))) {
    const effectiveType = file.type || "(unknown)";
    return NextResponse.json(
      { error: `Invalid file type: ${effectiveType}. Only WAV files are accepted.` },
      { status: 415 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Max 5 MB.` },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Validate WAV magic bytes: "RIFF" at 0, "WAVE" at 8
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return NextResponse.json(
      { error: "File is not a valid WAV (RIFF/WAVE header missing)" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(name, bytes, {
      contentType: "audio/wav",
      upsert: true,
    });

  if (uploadErr) {
    console.error("[sound-assets/upload] Supabase error:", uploadErr);
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(name);

  return NextResponse.json({
    ok: true,
    name,
    url: urlData.publicUrl,
    size: bytes.length,
  });
}

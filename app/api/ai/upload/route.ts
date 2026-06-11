import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";
import { randomUUID } from "crypto";

const BUCKET = "glev-ai-attachments";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/pdf",
]);

/**
 * POST /api/ai/upload
 *
 * Accepts multipart/form-data with a single `file` field.
 * Uploads to `glev-ai-attachments/{userId}/{yyyy-mm}/{uuid}-{filename}`.
 * Returns { url, mimeType, fileName, sizeBytes } where `url` is a
 * signed URL valid for 1 hour.
 *
 * Auth: Supabase cookie session (same as other authed routes).
 * RLS: the bucket policy ensures users can only access their own folder.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, sb } = auth;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const fileField = formData.get("file");
  if (!(fileField instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const mimeType = fileField.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${mimeType}` },
      { status: 415 },
    );
  }

  const bytes = await fileField.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 5 MB)" },
      { status: 413 },
    );
  }

  // Build storage path: {userId}/{yyyy-mm}/{uuid}-{sanitised-filename}
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const safeName = fileField.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const storagePath = `${user.id}/${ym}/${randomUUID()}-${safeName}`;

  const { error: uploadError } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error("[ai/upload]", uploadError.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: signedData, error: signError } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  if (signError || !signedData?.signedUrl) {
    console.error("[ai/upload] signed-url error", signError?.message);
    return NextResponse.json({ error: "Could not create signed URL" }, { status: 500 });
  }

  return NextResponse.json({
    url: signedData.signedUrl,
    mimeType,
    fileName: fileField.name,
    sizeBytes: bytes.byteLength,
  });
}

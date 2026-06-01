import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getAllTemplates, upsertTemplate } from "@/lib/messageTemplates";

export const runtime = "nodejs";

export async function GET() {
  const authed = await isAdminAuthed();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const templates = await getAllTemplates();
  return NextResponse.json(templates);
}

export async function PATCH(req: NextRequest) {
  const authed = await isAdminAuthed();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.key !== "string") {
    return NextResponse.json({ error: "key (string) required" }, { status: 400 });
  }

  const { key } = body;
  const updates: {
    sms_text?: string | null;
    email_subject?: string | null;
    email_intro?: string | null;
  } = {};

  if ("sms_text" in body) updates.sms_text = (body.sms_text as string | null) ?? null;
  if ("email_subject" in body) updates.email_subject = (body.email_subject as string | null) ?? null;
  if ("email_intro" in body) updates.email_intro = (body.email_intro as string | null) ?? null;

  const result = await upsertTemplate(key, updates);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

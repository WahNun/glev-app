export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";

const PUSH_KEYS = ["push_hypo", "push_hyper", "push_elevated"] as const;
type PushKey = typeof PUSH_KEYS[number];

export async function GET(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("message_templates")
      .select("key, label, push_title, push_body")
      .in("key", PUSH_KEYS);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const templates: Record<string, { push_title: string | null; push_body: string | null; label: string }> = {};
    for (const row of (data ?? [])) {
      templates[row.key] = {
        push_title: row.push_title ?? null,
        push_body: row.push_body ?? null,
        label: row.label ?? "",
      };
    }

    return NextResponse.json({ ok: true, templates });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as { key: string; push_title: string; push_body: string };
    const { key, push_title, push_body } = body;

    if (!PUSH_KEYS.includes(key as PushKey)) {
      return NextResponse.json({ error: `Ungültiger key: ${key}` }, { status: 400 });
    }
    if (typeof push_title !== "string" || typeof push_body !== "string") {
      return NextResponse.json({ error: "push_title und push_body erforderlich" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("message_templates")
      .upsert({
        key,
        label: key === "push_hypo" ? "Push-Alarm: Hypo"
          : key === "push_hyper" ? "Push-Alarm: Hyper"
          : "Push-Alarm: Erhöht",
        push_title,
        push_body,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

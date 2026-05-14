/**
 * /api/icr-schedule — GET + PUT for the per-user time-banded ICR table.
 *
 * Phase A (Matildav request, 2026-05-14): UI-driven persistence only.
 * The Adaptive Engine (lib/engine/adaptiveICR.ts) does NOT consult
 * this yet — Phase B wires it after Lucas confirms the data shape.
 *
 * The Settings sub-page calls these helpers via the Supabase client
 * directly (lib/icrSchedule.ts uses the browser supabase client),
 * but we expose this REST surface as well so future native callers
 * (iOS/Android shell, scripts) can hit a stable endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticate, errResponse } from "../cgm/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlotPayload = {
  slotIndex: number;
  label?: string | null;
  startMinute: number;
  endMinute: number;
  icrGPerUnit: number;
  enabled?: boolean;
};

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    const db = adminClient();

    const { data: settings } = await db
      .from("user_settings")
      .select("icr_schedule_enabled")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: rows, error: rErr } = await db
      .from("user_icr_schedule")
      .select("slot_index, label, start_minute, end_minute, icr_g_per_unit, enabled")
      .eq("user_id", user.id)
      .order("slot_index", { ascending: true });
    if (rErr) throw rErr;

    return NextResponse.json({
      enabled: settings?.icr_schedule_enabled === true,
      slots: (rows || []).map(r => ({
        slotIndex: r.slot_index,
        label: r.label || "",
        startMinute: r.start_minute,
        endMinute: r.end_minute,
        icrGPerUnit: r.icr_g_per_unit,
        enabled: r.enabled !== false,
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as { enabled?: boolean; slots?: SlotPayload[] };
    const enabled = body.enabled === true;
    const slots = Array.isArray(body.slots) ? body.slots : [];

    // Validate before touching the DB.
    const seenIndices = new Set<number>();
    for (const s of slots) {
      if (![1, 2, 3].includes(s.slotIndex)) return NextResponse.json({ error: "invalid slot_index" }, { status: 400 });
      if (seenIndices.has(s.slotIndex))     return NextResponse.json({ error: `duplicate slot_index ${s.slotIndex}` }, { status: 400 });
      seenIndices.add(s.slotIndex);
      if (!Number.isFinite(s.startMinute) || s.startMinute < 0 || s.startMinute > 1439) return NextResponse.json({ error: "invalid startMinute" }, { status: 400 });
      if (!Number.isFinite(s.endMinute)   || s.endMinute   < 0 || s.endMinute   > 1439) return NextResponse.json({ error: "invalid endMinute" }, { status: 400 });
      if (!Number.isFinite(s.icrGPerUnit) || s.icrGPerUnit < 1 || s.icrGPerUnit > 100)  return NextResponse.json({ error: "invalid icrGPerUnit" }, { status: 400 });
    }

    const db = adminClient();

    const { error: sErr } = await db
      .from("user_settings")
      .upsert({ user_id: user.id, icr_schedule_enabled: enabled }, { onConflict: "user_id" });
    if (sErr) throw sErr;

    if (slots.length > 0) {
      const rows = slots.map(s => ({
        user_id: user.id,
        slot_index: s.slotIndex,
        label: s.label || null,
        start_minute: s.startMinute,
        end_minute: s.endMinute,
        icr_g_per_unit: s.icrGPerUnit,
        enabled: s.enabled !== false,
        updated_at: new Date().toISOString(),
      }));
      const { error: rErr } = await db
        .from("user_icr_schedule")
        .upsert(rows, { onConflict: "user_id,slot_index" });
      if (rErr) throw rErr;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}

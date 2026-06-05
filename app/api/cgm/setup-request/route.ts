import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { authenticate } from "../_helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cgmSetupRequestHtml, cgmSetupRequestText, type CgmSetupRequestPayload } from "@/lib/emails/cgm-setup-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_BRANDS = [
  "dexcom",
  "freestyle_libre",
  "medtronic",
  "eversense",
  "sibionics",
  "other",
] as const;

const VALID_OS = ["ios", "android", "both"] as const;

const VALID_NIGHTSCOUT = [
  "none",
  "heard_of_it",
  "tried_it",
  "running_it",
] as const;

type SensorBrand = (typeof VALID_BRANDS)[number];
type DeviceOs = (typeof VALID_OS)[number];
type NightscoutStatus = (typeof VALID_NIGHTSCOUT)[number];

interface RequestBody {
  sensor_brand: SensorBrand;
  sensor_model?: string | null;
  device_os: DeviceOs;
  nightscout_status: NightscoutStatus;
  note?: string | null;
}

export async function POST(req: NextRequest) {
  const { user, error } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: error || "unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { sensor_brand, sensor_model, device_os, nightscout_status, note } = body;

  // Required field validation
  if (!sensor_brand || !device_os || !nightscout_status) {
    return NextResponse.json(
      { error: "sensor_brand, device_os, and nightscout_status are required" },
      { status: 400 },
    );
  }

  // Enum validation
  if (!VALID_BRANDS.includes(sensor_brand as SensorBrand)) {
    return NextResponse.json(
      { error: `sensor_brand must be one of: ${VALID_BRANDS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!VALID_OS.includes(device_os as DeviceOs)) {
    return NextResponse.json(
      { error: `device_os must be one of: ${VALID_OS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!VALID_NIGHTSCOUT.includes(nightscout_status as NightscoutStatus)) {
    return NextResponse.json(
      { error: `nightscout_status must be one of: ${VALID_NIGHTSCOUT.join(", ")}` },
      { status: 400 },
    );
  }

  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();

  // Insert request row
  const { data: inserted, error: insertErr } = await sb
    .from("cgm_setup_requests")
    .insert({
      user_id: user.id,
      sensor_brand,
      sensor_model: sensor_model?.trim() || null,
      device_os,
      nightscout_status,
      note: note?.trim() || null,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[cgm/setup-request] insert error", insertErr);
    return NextResponse.json({ error: "failed to save request" }, { status: 500 });
  }

  // Update profiles.last_setup_request_at
  await sb
    .from("profiles")
    .update({ last_setup_request_at: now })
    .eq("user_id", user.id);

  // Send email notification to lucas@glev.app
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      const payload: CgmSetupRequestPayload = {
        userEmail: user.email ?? user.id,
        userId: user.id,
        sensorBrand: sensor_brand,
        sensorModel: sensor_model?.trim() || null,
        deviceOs: device_os,
        nightscoutStatus: nightscout_status,
        note: note?.trim() || null,
        submittedAt: now,
        requestId: inserted.id,
      };
      await resend.emails.send({
        from: "Glev <crm@glev.app>",
        to: "lucas@glev.app",
        subject: `CGM Setup-Anfrage: ${sensor_brand} (${user.email ?? user.id})`,
        html: cgmSetupRequestHtml(payload),
        text: cgmSetupRequestText(payload),
      });
    }
  } catch (emailErr) {
    // Email failure is non-fatal — the row is already persisted
    console.error("[cgm/setup-request] email send failed", emailErr);
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}

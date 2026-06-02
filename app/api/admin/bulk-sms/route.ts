import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { shortenUrl } from "@/lib/shortLinks";
import { getTemplate, renderSms } from "@/lib/messageTemplates";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://glev.app").replace(/\/$/, "");

export type BulkSmsResult = {
  userId: string;
  email: string;
  phone: string | null;
  status: "sent" | "no_phone" | "link_error" | "sms_error";
  error?: string;
};

async function sendSms(phone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Twilio nicht konfiguriert" };

  const fd = new URLSearchParams({ From: from, To: phone, Body: body });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: fd.toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const authed = await isAdminAuthed();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional: filter by specific user IDs
  let filterUserIds: string[] | null = null;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json() as { userIds?: unknown };
      if (Array.isArray(body.userIds) && body.userIds.length > 0) {
        filterUserIds = (body.userIds as unknown[]).filter((id): id is string => typeof id === "string");
      }
    }
  } catch {
    // No body or invalid JSON — treat as "all"
  }

  const sb = getSupabaseAdmin();
  const tpl = await getTemplate("meta_lead_bulk_sms");

  // Alle Meta-Leads aus profiles holen (oder nur die gefilterten)
  let profileQuery = sb
    .from("profiles")
    .select("user_id, signup_source")
    .eq("signup_source", "meta_lead");

  if (filterUserIds) {
    profileQuery = profileQuery.in("user_id", filterUserIds);
  }

  const { data: profiles, error: profilesErr } = await profileQuery;

  if (profilesErr) {
    return NextResponse.json({ error: profilesErr.message }, { status: 500 });
  }

  // Falls explizite IDs übergeben wurden, die kein meta_lead signup haben,
  // trotzdem einbeziehen (z.B. Trial-User aus anderem Kanal)
  let userIdsToProcess = (profiles ?? []).map((p) => p.user_id);
  if (filterUserIds) {
    const fromProfiles = new Set(userIdsToProcess);
    for (const id of filterUserIds) {
      if (!fromProfiles.has(id)) userIdsToProcess.push(id);
    }
  }

  if (userIdsToProcess.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Auth-User-Daten für alle betroffenen User-IDs
  const { data: authData } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const authMap = new Map((authData?.users ?? []).map((u) => [u.id, u]));

  const results: BulkSmsResult[] = [];

  for (const userId of userIdsToProcess) {
    const u = authMap.get(userId);
    const email = u?.email ?? userId;
    const phone = (u?.user_metadata?.phone as string | null) ?? null;

    if (!phone) {
      results.push({ userId, email, phone: null, status: "no_phone" });
      continue;
    }

    // Frischen Recovery-Link generieren (idempotent, alter Link bleibt gültig bis er benutzt wird)
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: "recovery",
      email: u?.email ?? "",
      options: { redirectTo: `${APP_URL}/auth/confirm` },
    });

    const inviteUrl = linkData?.properties?.action_link ?? null;
    if (linkErr || !inviteUrl) {
      results.push({
        userId,
        email,
        phone,
        status: "link_error",
        error: linkErr?.message ?? "Kein action_link zurückgegeben",
      });
      continue;
    }

    const shortUrl = await shortenUrl(inviteUrl, "sms_bulk", email);
    const body = renderSms(tpl.sms_text ?? "", { link: shortUrl });

    const smsResult = await sendSms(phone, body);
    results.push({
      userId,
      email,
      phone,
      status: smsResult.ok ? "sent" : "sms_error",
      error: smsResult.error,
    });
  }

  return NextResponse.json({ results });
}

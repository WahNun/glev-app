import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export type BackfillPhoneResult = {
  email: string;
  phone: string;
  status: "updated" | "no_user" | "error";
  error?: string;
};

export async function POST() {
  const authed = await isAdminAuthed();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();

  // Alle Meta-Leads mit Telefonnummer aus der meta_leads Tabelle
  const { data: leads, error: leadsErr } = await sb
    .from("meta_leads")
    .select("email, phone, full_name")
    .not("phone", "is", null)
    .neq("phone", "");

  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 });
  if (!leads || leads.length === 0) return NextResponse.json({ results: [] });

  // Alle Auth-User laden und nach Email mappen
  const { data: authData } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const authByEmail = new Map(
    (authData?.users ?? []).map((u) => [u.email?.toLowerCase() ?? "", u]),
  );

  const results: BackfillPhoneResult[] = [];

  for (const lead of leads) {
    const email = (lead.email as string | null)?.toLowerCase() ?? "";
    const phone = lead.phone as string;

    const user = authByEmail.get(email);
    if (!user) {
      results.push({ email, phone, status: "no_user" });
      continue;
    }

    // Nur updaten wenn Nummer noch nicht gesetzt oder anders
    const existing = (user.user_metadata?.phone as string | null) ?? null;
    if (existing === phone) {
      results.push({ email, phone, status: "updated" });
      continue;
    }

    const { error: updateErr } = await sb.auth.admin.updateUserById(user.id, {
      user_metadata: { phone },
    });

    results.push({
      email,
      phone,
      status: updateErr ? "error" : "updated",
      error: updateErr?.message,
    });
  }

  return NextResponse.json({ results });
}

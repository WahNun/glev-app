/**
 * POST /api/admin/activate-pending-trials
 *
 * Aktiviert den 7-Tage-Trial für alle Meta-Lead-User die:
 *   - sich mindestens einmal eingeloggt haben (last_sign_in_at IS NOT NULL)
 *   - aber noch kein trial_start_at haben (Link geklickt, aber activate-trial
 *     schlug still fehl wegen fehlendem Session-Token)
 *
 * Idempotent — kann mehrfach laufen ohne Doppel-Aktivierungen.
 */
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { scheduleTrialEmails } from "@/lib/emails/drip-scheduler";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingTrialResult = {
  userId: string;
  email: string;
  status: "activated" | "skipped" | "error";
  error?: string;
};

export async function POST() {
  const authed = await isAdminAuthed();
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();

  // Alle profiles mit signup_source=meta_lead und trial_start_at IS NULL
  const { data: profiles, error: profErr } = await sb
    .from("profiles")
    .select("user_id, trial_start_at, trial_end_at")
    .eq("signup_source", "meta_lead")
    .is("trial_start_at", null);

  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  if (!profiles || profiles.length === 0) return NextResponse.json({ results: [] });

  // Auth-User laden um last_sign_in_at und email zu prüfen
  const { data: authData } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const authById = new Map((authData?.users ?? []).map((u) => [u.id, u]));

  const results: PendingTrialResult[] = [];

  for (const profile of profiles) {
    const authUser = authById.get(profile.user_id);
    if (!authUser) {
      results.push({ userId: profile.user_id, email: "?", status: "skipped" });
      continue;
    }

    // Nur aktivieren wenn der User sich tatsächlich eingeloggt hat
    if (!authUser.last_sign_in_at) {
      results.push({
        userId: authUser.id,
        email: authUser.email ?? "?",
        status: "skipped",
      });
      continue;
    }

    const trialStartAt = new Date();
    const trialEndAt = new Date(trialStartAt.getTime() + SEVEN_DAYS_MS).toISOString();

    const { error: updateErr } = await sb
      .from("profiles")
      .update({
        trial_start_at: trialStartAt.toISOString(),
        trial_end_at: trialEndAt,
      })
      .eq("user_id", authUser.id);

    if (updateErr) {
      results.push({
        userId: authUser.id,
        email: authUser.email ?? "?",
        status: "error",
        error: updateErr.message,
      });
      continue;
    }

    // Drip-Mails starten
    if (authUser.email) {
      const name = (authUser.user_metadata?.full_name as string | undefined) ?? null;
      scheduleTrialEmails(authUser.email, name, trialStartAt, "de").catch(() => {});
    }

    results.push({
      userId: authUser.id,
      email: authUser.email ?? "?",
      status: "activated",
    });
  }

  return NextResponse.json({ results });
}

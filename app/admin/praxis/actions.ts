"use server";

import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "../buyers/actions";

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
}

export async function createPracticeAction(formData: FormData): Promise<void> {
  if (!(await isAdminAuthed())) redirect("/admin/praxis?err=auth");

  const rawSlug = String(formData.get("slug") ?? "").trim();
  const name    = String(formData.get("name") ?? "").trim();
  const greeting = String(formData.get("greeting_text") ?? "").trim();
  const slug = slugify(rawSlug);

  if (!slug || !name) redirect("/admin/praxis?err=missing");

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("practice_referrals").insert({
    slug,
    name,
    greeting_text: greeting || null,
  });

  if (error) {
    const code = error.code === "23505" ? "duplicate" : "db";
    redirect(`/admin/praxis?err=${code}`);
  }

  redirect("/admin/praxis?ok=created");
}

export async function deletePracticeAction(formData: FormData): Promise<void> {
  if (!(await isAdminAuthed())) redirect("/admin/praxis?err=auth");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/admin/praxis");

  const sb = getSupabaseAdmin();
  await sb.from("practice_referrals").delete().eq("id", id);

  redirect("/admin/praxis?ok=deleted");
}

export async function togglePracticeAction(formData: FormData): Promise<void> {
  if (!(await isAdminAuthed())) redirect("/admin/praxis?err=auth");

  const id     = String(formData.get("id") ?? "").trim();
  const active = formData.get("active") === "true";
  if (!id) redirect("/admin/praxis");

  const sb = getSupabaseAdmin();
  await sb.from("practice_referrals").update({ active: !active }).eq("id", id);

  redirect("/admin/praxis");
}

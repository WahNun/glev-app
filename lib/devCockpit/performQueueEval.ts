// Dev Cockpit Phase 4 — queue-note evaluation orchestration (server-only).
//
// Invoked from a route handler (POST /glev-ops/dev-cockpit/api/evaluate-queue)
// so the long Mistral call stays off the Server-Action queue and never blocks
// other actions. Admin-guarded; scoped strictly to the note's OWN task.

import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runQueueEvaluation } from "@/lib/ai/devCockpitQueueEval";
import { QUEUE_COLUMNS, type DevQueueNote } from "@/app/glev-ops/dev-cockpit/types";

export type PerformQueueEvalResult =
  | { ok: true; note: DevQueueNote }
  | { ok: false; error: string };

export async function performQueueEval(noteId: string): Promise<PerformQueueEvalResult> {
  if (!(await isAdminAuthed())) return { ok: false, error: "auth" };
  if (!noteId) return { ok: false, error: "missing-id" };

  const sb = getSupabaseAdmin();

  // The note + its task id
  const { data: note, error: ne } = await sb
    .from("dev_cockpit_prompt_queue")
    .select(QUEUE_COLUMNS)
    .eq("id", noteId)
    .single();
  if (ne || !note) return { ok: false, error: ne?.message ?? "not-found" };
  const n = note as DevQueueNote;

  // The note's OWN task only (prompt + plan_text + status)
  const { data: task, error: te } = await sb
    .from("dev_cockpit_tasks")
    .select("title, prompt, plan_text, status")
    .eq("id", n.task_id)
    .single();
  if (te || !task) return { ok: false, error: te?.message ?? "task-not-found" };

  // This task's messages
  const { data: msgs } = await sb
    .from("dev_cockpit_messages")
    .select("role, content")
    .eq("task_id", n.task_id)
    .order("created_at", { ascending: true });
  const messages = (msgs ?? []).map((m) => ({
    role: String(m.role),
    content: String(m.content ?? ""),
  }));

  // Other queued notes of the SAME task (dedupe/context); never other tasks.
  const { data: others } = await sb
    .from("dev_cockpit_prompt_queue")
    .select("id, content, status")
    .eq("task_id", n.task_id);
  const otherNotes = (others ?? [])
    .filter((o) => o.id !== noteId && o.status === "queued")
    .map((o) => String(o.content ?? ""));

  // Mistral evaluation
  let evaluation;
  try {
    evaluation = await runQueueEvaluation({
      taskTitle: String(task.title ?? ""),
      taskPrompt: String(task.prompt ?? ""),
      taskStatus: String(task.status ?? ""),
      planText: (task.plan_text as string | null) ?? null,
      messages,
      note: n.content,
      otherNotes,
    });
  } catch {
    return { ok: false, error: "evaluation-failed" };
  }

  // Persist — status='evaluated', no task status change.
  const { data: updated, error: ue } = await sb
    .from("dev_cockpit_prompt_queue")
    .update({
      status: "evaluated",
      impact_level: evaluation.impact_level,
      recommendation: evaluation.recommendation,
      evaluation_text: evaluation.evaluation_text,
      affected_areas: evaluation.affected_areas,
      risks: evaluation.risks,
    })
    .eq("id", noteId)
    .select(QUEUE_COLUMNS)
    .single();
  if (ue) return { ok: false, error: ue.message };

  return { ok: true, note: updated as DevQueueNote };
}

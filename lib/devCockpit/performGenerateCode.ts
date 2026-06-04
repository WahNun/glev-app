// Dev Cockpit Phase 6 — Generate Code orchestration (server-only).
//
// Produces a FROZEN, versioned CODE DRAFT from the task's build plan. Invoked
// from a route handler so the long model call stays off the Server-Action queue
// (parallel, no global lock). Admin-guarded; strictly task-local input.
// PROPOSALS ONLY — no files written, no commits/branches/PRs/deploys.

import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runCodeGeneration } from "@/lib/ai/devCockpitCodeGen";
import {
  TASK_COLUMNS,
  type DevTask,
  type CodeGenerationDraft,
  type BuildExecutionPlan,
} from "@/app/glev-ops/dev-cockpit/types";

export type PerformGenerateCodeResult =
  | { ok: true; task: DevTask; draft: CodeGenerationDraft }
  | { ok: false; error: string };

export async function performGenerateCode(taskId: string): Promise<PerformGenerateCodeResult> {
  if (!(await isAdminAuthed())) return { ok: false, error: "auth" };
  if (!taskId) return { ok: false, error: "missing-id" };

  const sb = getSupabaseAdmin();

  const { data: task, error: te } = await sb
    .from("dev_cockpit_tasks")
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .single();
  if (te || !task) return { ok: false, error: te?.message ?? "not-found" };
  const t = task as DevTask;

  if (!t.build_plan) return { ok: false, error: "no-build-plan" };

  // Show generating_code immediately (spinner + status persist for parallel views).
  await sb.from("dev_cockpit_tasks").update({ status: "generating_code" }).eq("id", taskId);

  // Task-local context only. Snapshots come from the FROZEN build plan, not the
  // live queue, so the code draft matches exactly what the build plan captured.
  const bp = t.build_plan as Partial<BuildExecutionPlan>;
  const includedNotes = Array.isArray(bp.included_notes_snapshot) ? bp.included_notes_snapshot.map(String) : [];
  const excludedNotes = Array.isArray(bp.excluded_notes_snapshot) ? bp.excluded_notes_snapshot.map(String) : [];

  const { data: msgs } = await sb
    .from("dev_cockpit_messages")
    .select("role, content")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  const messages = (msgs ?? []).map((m) => ({ role: String(m.role), content: String(m.content ?? "") }));

  // Generate the code draft.
  let core;
  try {
    core = await runCodeGeneration({
      title: t.title,
      analysisPlanText: t.plan_text,
      buildPlanJson: JSON.stringify(t.build_plan),
      includedNotes,
      excludedNotes,
      messages,
    });
  } catch {
    await sb.from("dev_cockpit_tasks").update({ status: "code_failed" }).eq("id", taskId);
    await sb.from("dev_cockpit_messages").insert({
      task_id: taskId,
      role: "system",
      content: "Code generation failed.",
    });
    return { ok: false, error: "code-failed" };
  }

  // Version = prior code drafts + 1; first draft's created_at is the initial time.
  const { data: prior } = await sb
    .from("dev_cockpit_code_generations")
    .select("created_at, version")
    .eq("task_id", taskId)
    .order("version", { ascending: true });
  const priorDrafts = prior ?? [];
  const version = priorDrafts.length + 1;

  // Insert the immutable code-draft record (history; stable code_id).
  const { data: row, error: ie } = await sb
    .from("dev_cockpit_code_generations")
    .insert({
      task_id: taskId,
      version,
      status: "code_ready",
      summary: core.summary,
      files_to_create: core.files_to_create,
      files_to_modify: core.files_to_modify,
      implementation_steps: core.implementation_steps,
      generated_code_blocks: core.generated_code_blocks,
      risks: core.risks,
      estimated_change_size: core.estimated_change_size,
    })
    .select("id, created_at")
    .single();
  if (ie || !row) return { ok: false, error: ie?.message ?? "codegen-insert-failed" };

  const initialCreatedAt = priorDrafts[0]?.created_at ?? row.created_at;

  const draft: CodeGenerationDraft = {
    code_id: row.id,
    version,
    status: "code_ready",
    summary: core.summary,
    files_to_create: core.files_to_create,
    files_to_modify: core.files_to_modify,
    implementation_steps: core.implementation_steps,
    generated_code_blocks: core.generated_code_blocks,
    risks: core.risks,
    estimated_change_size: core.estimated_change_size,
    created_at: String(initialCreatedAt),
    updated_at: String(row.created_at),
  };

  const { data: updated, error: ue } = await sb
    .from("dev_cockpit_tasks")
    .update({
      status: "code_ready",
      generated_code: draft,
      code_generation_version: version,
      generated_at: row.created_at,
    })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();
  if (ue) return { ok: false, error: ue.message };

  const fileList = [...core.files_to_create.map((f) => `+ ${f}`), ...core.files_to_modify.map((f) => `~ ${f}`)].join("\n");
  await sb.from("dev_cockpit_messages").insert({
    task_id: taskId,
    role: "assistant",
    content: `Code Draft #${version} erstellt (${core.estimated_change_size}).\n\n${core.summary}\n\nDateien:\n${fileList}\n\n(Nur Vorschlag — nichts wurde geschrieben.)`,
  });

  return { ok: true, task: updated as DevTask, draft };
}

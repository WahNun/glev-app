// Dev Cockpit Phase 5 + 5.1 — Start Build orchestration (server-only).
//
// Generates a FROZEN, versioned build artifact. Invoked from a route handler so
// the long Mistral call stays off the Server-Action queue (parallel builds, no
// global lock). Admin-guarded; scoped to the task's OWN current-build queue
// notes. PLAN ONLY — no code/branches/execution.
//
// Each Start Build:
//   • captures note snapshots at generation time (never re-read later)
//   • inserts an immutable row in dev_cockpit_builds (history; stable build_id)
//   • bumps version (1, 2, 3, …)
//   • denormalizes the latest build into dev_cockpit_tasks.build_plan
//     (created_at = first build's time, updated_at = this build's time)

import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runBuildPlanGeneration } from "@/lib/ai/devCockpitBuildPlan";
import { TASK_COLUMNS, type DevTask, type BuildExecutionPlan } from "@/app/glev-ops/dev-cockpit/types";

export type PerformStartBuildResult =
  | { ok: true; task: DevTask; build_plan: BuildExecutionPlan }
  | { ok: false; error: string };

export async function performStartBuild(taskId: string): Promise<PerformStartBuildResult> {
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

  // Show planning_build immediately so the spinner + status persist for parallel
  // views / reloads while the model works.
  await sb.from("dev_cockpit_tasks").update({ status: "planning_build" }).eq("id", taskId);

  // FROZEN snapshots — captured now, never re-read from the live queue.
  //   included = current build  (status='applied' AND approved_for_current_build)
  //   excluded = after_build_pending (deferred)
  //   converted_to_task / discarded / separate_task / other tasks → excluded
  const { data: notes } = await sb
    .from("dev_cockpit_prompt_queue")
    .select("content, status, approved_for_current_build")
    .eq("task_id", taskId);
  const rows = notes ?? [];
  const includedSnapshot = rows
    .filter((n) => n.status === "applied" && n.approved_for_current_build === true)
    .map((n) => String(n.content ?? ""));
  const excludedSnapshot = rows
    .filter((n) => n.status === "after_build_pending")
    .map((n) => String(n.content ?? ""));

  // Generate the core plan.
  let core;
  try {
    core = await runBuildPlanGeneration({
      title: t.title,
      prompt: t.prompt ?? "",
      analysisPlanText: t.plan_text,
      includedNotes: includedSnapshot,
      excludedNotes: excludedSnapshot,
    });
  } catch {
    await sb.from("dev_cockpit_tasks").update({ status: "build_failed" }).eq("id", taskId);
    await sb.from("dev_cockpit_messages").insert({
      task_id: taskId,
      role: "system",
      content: "Build plan generation failed.",
    });
    return { ok: false, error: "build-failed" };
  }

  // Version = number of prior builds + 1; first build's created_at is the
  // artifact's initial creation time.
  const { data: prior } = await sb
    .from("dev_cockpit_builds")
    .select("created_at, version")
    .eq("task_id", taskId)
    .order("version", { ascending: true });
  const priorBuilds = prior ?? [];
  const version = priorBuilds.length + 1;

  // Insert the immutable build record (history; stable build_id).
  const { data: buildRow, error: be } = await sb
    .from("dev_cockpit_builds")
    .insert({
      task_id: taskId,
      version,
      status: "build_ready",
      scope: core.scope,
      steps: core.steps,
      included_notes_snapshot: includedSnapshot,
      excluded_notes_snapshot: excludedSnapshot,
      affected_areas: core.affected_areas,
      risks: core.risks,
      complexity: core.complexity,
    })
    .select("id, created_at")
    .single();
  if (be || !buildRow) return { ok: false, error: be?.message ?? "build-insert-failed" };

  const initialCreatedAt = priorBuilds[0]?.created_at ?? buildRow.created_at;

  // Denormalized latest-build artifact for the task card / page load.
  const artifact: BuildExecutionPlan = {
    build_id: buildRow.id,
    version,
    status: "build_ready",
    scope: core.scope,
    steps: core.steps,
    included_notes_snapshot: includedSnapshot,
    excluded_notes_snapshot: excludedSnapshot,
    affected_areas: core.affected_areas,
    risks: core.risks,
    complexity: core.complexity,
    created_at: String(initialCreatedAt),
    updated_at: String(buildRow.created_at),
  };

  const { data: updated, error: ue } = await sb
    .from("dev_cockpit_tasks")
    .update({ status: "build_ready", build_plan: artifact })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();
  if (ue) return { ok: false, error: ue.message };

  const stepsText = core.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const excludedText = excludedSnapshot.length
    ? `\n\nExcluded (später):\n${excludedSnapshot.map((n) => `• ${n}`).join("\n")}`
    : "";
  await sb.from("dev_cockpit_messages").insert({
    task_id: taskId,
    role: "assistant",
    content: `Build Plan #${version} erstellt (${core.complexity} Komplexität).\n\nScope: ${core.scope}\n\nSchritte:\n${stepsText}${excludedText}`,
  });

  return { ok: true, task: updated as DevTask, build_plan: artifact };
}

// Dev Cockpit Phase 5 — Start Build orchestration (server-only).
//
// Invoked from a route handler (POST /glev-ops/dev-cockpit/api/start-build) so
// the long Mistral call stays off the Server-Action queue — multiple tasks can
// be planning_build in parallel, no global lock. Admin-guarded; scoped to the
// task's OWN current-build queue notes. PLAN ONLY — no code/branches/execution.

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

  // Mark planning_build immediately so the spinner + status persist for
  // parallel views / reloads while the model works.
  await sb.from("dev_cockpit_tasks").update({ status: "planning_build" }).eq("id", taskId);

  // Build scope from this task's queue notes:
  //  • included = current build  (status='applied' AND approved_for_current_build=true)
  //  • excluded = after_build_pending (listed but NOT planned)
  //  • separate_task / others → ignored
  const { data: notes } = await sb
    .from("dev_cockpit_prompt_queue")
    .select("content, status, approved_for_current_build")
    .eq("task_id", taskId);
  const rows = notes ?? [];
  const includedNotes = rows
    .filter((n) => n.status === "applied" && n.approved_for_current_build === true)
    .map((n) => String(n.content ?? ""));
  const excludedNotes = rows
    .filter((n) => n.status === "after_build_pending")
    .map((n) => String(n.content ?? ""));

  // Generate the build plan.
  let plan: BuildExecutionPlan;
  try {
    plan = await runBuildPlanGeneration({
      title: t.title,
      prompt: t.prompt ?? "",
      analysisPlanText: t.plan_text,
      includedNotes,
      excludedNotes,
    });
  } catch {
    // Failure → status=build_failed (per Phase-5 state machine) + system message.
    await sb.from("dev_cockpit_tasks").update({ status: "build_failed" }).eq("id", taskId);
    await sb.from("dev_cockpit_messages").insert({
      task_id: taskId,
      role: "system",
      content: "Build plan generation failed.",
    });
    return { ok: false, error: "build-failed" };
  }

  // Persist plan + status=build_ready + an assistant summary message.
  const { data: updated, error: ue } = await sb
    .from("dev_cockpit_tasks")
    .update({ status: "build_ready", build_plan: plan })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();
  if (ue) return { ok: false, error: ue.message };

  const stepsText = plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const excludedText = plan.excluded_notes.length
    ? `\n\nExcluded (später):\n${plan.excluded_notes.map((n) => `• ${n}`).join("\n")}`
    : "";
  await sb.from("dev_cockpit_messages").insert({
    task_id: taskId,
    role: "assistant",
    content: `Build Plan erstellt (${plan.complexity} Komplexität).\n\nScope: ${plan.scope}\n\nSchritte:\n${stepsText}${excludedText}`,
  });

  return { ok: true, task: updated as DevTask, build_plan: plan };
}

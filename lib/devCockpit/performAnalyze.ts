// Dev Cockpit Phase 3 — analyze orchestration (server-only, plain function).
//
// Extracted from the analyzeTask server action so it can be invoked from a
// ROUTE HANDLER via fetch (POST /api/glev-ops/dev-cockpit/analyze). Route
// handlers run off the Next.js Server-Action queue, so a long Mistral analysis
// no longer blocks other server actions (cancel / archive / create / reads) —
// the UI stays responsive and parallel analyses are possible.
//
// Same behavior, prompts, and safety gate as before — only the transport
// changes. Admin-guarded; the Mistral key stays server-side.

import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  runDevCockpitAnalysis,
  formatPlanMessage,
  isTaskDestructive,
  filterOutDestructiveSafetyQuestions,
} from "@/lib/ai/devCockpitAnalysis";
import { TASK_COLUMNS, type DevTask, type BuildPlan } from "@/app/glev-ops/dev-cockpit/types";

export type PerformAnalyzeResult =
  | { ok: true; task: DevTask; plan: BuildPlan }
  | { ok: false; error: string };

export async function performAnalyze(taskId: string): Promise<PerformAnalyzeResult> {
  if (!(await isAdminAuthed())) return { ok: false, error: "auth" };
  if (!taskId) return { ok: false, error: "missing-id" };

  const sb = getSupabaseAdmin();

  // 1. Context (current task only)
  const { data: task, error: te } = await sb
    .from("dev_cockpit_tasks")
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .single();
  if (te || !task) return { ok: false, error: te?.message ?? "not-found" };
  const t = task as DevTask;

  const { data: msgs } = await sb
    .from("dev_cockpit_messages")
    .select("role, content")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  const history = (msgs ?? []).map((m) => ({
    role: String(m.role),
    content: String(m.content ?? ""),
  }));

  const { data: notes } = await sb
    .from("dev_cockpit_prompt_queue")
    .select("content, status")
    .eq("task_id", taskId);
  const queuedNotes = (notes ?? [])
    .filter((n) => n.status === "queued")
    .map((n) => String(n.content ?? ""));

  // 2. Mistral analysis
  let plan: BuildPlan;
  try {
    plan = await runDevCockpitAnalysis({
      title: t.title,
      prompt: t.prompt ?? "",
      history,
      queuedNotes,
    });
  } catch {
    await sb.from("dev_cockpit_messages").insert({
      task_id: taskId,
      role: "system",
      content: "Mistral analysis failed.",
    });
    return { ok: false, error: "analysis-failed" };
  }

  // 2b. Authoritative safety pass over the CURRENT task's user-authored context.
  const userAuthoredContext = [
    t.title,
    t.prompt ?? "",
    ...history.filter((m) => m.role === "user").map((m) => m.content),
    ...queuedNotes,
  ].join("\n");
  const destructive = isTaskDestructive(userAuthoredContext);

  let finalPlan: BuildPlan = plan;
  if (!destructive) {
    const filtered = filterOutDestructiveSafetyQuestions(plan.questions);
    finalPlan = {
      ...plan,
      questions: filtered,
      ready_to_build: filtered.length === 0 ? true : plan.ready_to_build,
    };
  }

  // eslint-disable-next-line no-console
  console.log(
    "[dev_cockpit_safety]",
    JSON.stringify({
      taskId,
      destructive,
      modelQuestions: plan.questions.length,
      finalQuestions: finalPlan.questions.length,
      ready_to_build: finalPlan.ready_to_build,
    }),
  );

  // 3. Persist plan + status + assistant message
  const nextStatus = finalPlan.ready_to_build ? "waiting_for_start" : "waiting_for_input";
  const { data: updated, error: ue } = await sb
    .from("dev_cockpit_tasks")
    .update({ status: nextStatus, plan_text: JSON.stringify(finalPlan) })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();
  if (ue) return { ok: false, error: ue.message };

  await sb.from("dev_cockpit_messages").insert({
    task_id: taskId,
    role: "assistant",
    content: formatPlanMessage(finalPlan),
  });

  return { ok: true, task: updated as DevTask, plan: finalPlan };
}

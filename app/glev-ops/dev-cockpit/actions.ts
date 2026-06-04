"use server";

// Server actions for /glev-ops/dev-cockpit (Phase 2 — persistence only).
//
// Security: EVERY action calls `requireAdmin()` first, which throws if the
// caller does not carry a valid admin session cookie. Reads/writes go through
// the service-role client (`getSupabaseAdmin()`), which bypasses RLS — the
// Dev Cockpit tables have RLS enabled with no policies, so this admin path is
// the only way in. No secrets are returned to the client; actions return only
// row data the operator is already authorised to see.
//
// These actions return values (Result<T>) rather than redirect()ing, because
// they are invoked from the interactive client component, not from <form>
// submissions. On auth failure they return { ok: false, error: "auth" } so the
// client can surface a re-login hint instead of throwing an opaque error.
//
// Phase 2 scope: persistence + task management only. NO AI calls, NO GitHub
// branches, NO Vercel previews, NO diff fetching, NO real file uploads.

import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  TASK_COLUMNS,
  QUEUE_COLUMNS,
  FILTER_STATUSES,
  type DevTask,
  type DevMessage,
  type DevAttachment,
  type DevQueueNote,
  type TaskStatus,
  type TaskFilter,
  type MessageRole,
  type QueueStatus,
  type BuildPlan,
} from "./types";
import { performAnalyze } from "@/lib/devCockpit/performAnalyze";
import { performStartBuild } from "@/lib/devCockpit/performStartBuild";
import { performGenerateCode } from "@/lib/devCockpit/performGenerateCode";
import {
  BUILD_COLUMNS,
  CODEGEN_COLUMNS,
  type BuildExecutionPlan,
  type DevBuild,
  type CodeGenerationDraft,
  type DevCodeGeneration,
} from "./types";

// ── Result envelope ─────────────────────────────────────────────────────────

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function requireAdmin(): Promise<boolean> {
  return isAdminAuthed();
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

// Valid status values, mirrored from the DB CHECK constraint, so a bad value
// from the client is rejected before it ever hits the database.
const ALL_STATUSES: TaskStatus[] = [
  "draft", "planning", "waiting_for_start", "waiting_for_input",
  "planning_build", "build_ready", "building", "build_failed", "build_complete",
  "generating_code", "code_ready", "code_failed",
  "preview_ready", "applied", "rejected", "cancelled", "archived", "backlog",
];

// ── Tasks ────────────────────────────────────────────────────────────────────

/** List tasks for a sidebar filter (default: active working set). */
export async function listTasks(
  filter: TaskFilter = "active",
): Promise<Result<DevTask[]>> {
  if (!(await requireAdmin())) return fail("auth");

  const statuses = FILTER_STATUSES[filter] ?? null;
  const sb = getSupabaseAdmin();
  let query = sb
    .from("dev_cockpit_tasks")
    .select(TASK_COLUMNS)
    .order("created_at", { ascending: false });

  if (statuses) query = query.in("status", statuses);

  const { data, error } = await query;
  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as DevTask[] };
}

/** Fetch a single task by id. */
export async function getTask(id: string): Promise<Result<DevTask>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!id) return fail("missing-id");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_tasks")
    .select(TASK_COLUMNS)
    .eq("id", id)
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevTask };
}

/**
 * Create a task. If a prompt is supplied it is stored on the task AND mirrored
 * as the first `user` message so the chat history starts populated. No AI call
 * is made — that arrives in a later phase.
 */
export async function createTask(input: {
  title?: string;
  prompt?: string;
}): Promise<Result<DevTask>> {
  if (!(await requireAdmin())) return fail("auth");

  const prompt = (input.prompt ?? "").trim();
  // Derive a sensible title from the prompt's first line when none is given.
  const title =
    (input.title ?? "").trim() ||
    (prompt ? prompt.split("\n")[0].slice(0, 80) : "") ||
    "Neue Task";

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_tasks")
    .insert({ title, prompt: prompt || null, status: "draft" })
    .select(TASK_COLUMNS)
    .single();

  if (error) return fail(error.message);
  const task = data as DevTask;

  // Mirror the initial prompt as the first user message (best-effort — a
  // message-insert failure shouldn't lose the already-created task).
  if (prompt) {
    await sb
      .from("dev_cockpit_messages")
      .insert({ task_id: task.id, role: "user", content: prompt });
  }

  return { ok: true, data: task };
}

/** Patch arbitrary editable task fields (title / prompt for Phase 2). */
export async function updateTask(
  id: string,
  patch: Partial<Pick<DevTask, "title" | "prompt">>,
): Promise<Result<DevTask>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!id) return fail("missing-id");

  const update: Record<string, unknown> = {};
  if (typeof patch.title === "string") update.title = patch.title.trim() || "Neue Task";
  if (typeof patch.prompt === "string") update.prompt = patch.prompt;
  if (Object.keys(update).length === 0) return getTask(id);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_tasks")
    .update(update)
    .eq("id", id)
    .select(TASK_COLUMNS)
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevTask };
}

/**
 * Set a task's status with guard rails:
 *   • status must be a known value
 *   • a `building` task may NOT be archived (it's still in flight — cancel
 *     it first). It MAY be cancelled. These mirror the context-menu rules.
 */
export async function updateTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<Result<DevTask>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!id) return fail("missing-id");
  if (!ALL_STATUSES.includes(status)) return fail("bad-status");

  const sb = getSupabaseAdmin();

  // Guard: building → archived is disallowed; building must be cancelled first.
  if (status === "archived") {
    const current = await getTask(id);
    if (current.ok && current.data.status === "building") {
      return fail("building-cannot-archive");
    }
  }

  const { data, error } = await sb
    .from("dev_cockpit_tasks")
    .update({ status })
    .eq("id", id)
    .select(TASK_COLUMNS)
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevTask };
}

/** Context-menu helpers — thin wrappers over updateTaskStatus. */
export async function cancelTask(id: string): Promise<Result<DevTask>> {
  return updateTaskStatus(id, "cancelled");
}

export async function archiveTask(id: string): Promise<Result<DevTask>> {
  // Applied tasks are explicitly allowed to be archived; building tasks are
  // blocked inside updateTaskStatus.
  return updateTaskStatus(id, "archived");
}

export async function moveTaskToBacklog(id: string): Promise<Result<DevTask>> {
  return updateTaskStatus(id, "backlog");
}

// ── Analyze (Phase 3 — Mistral planning) ─────────────────────────────────────

/**
 * Analyze a task with Mistral and produce a structured BuildPlan.
 *
 * Phase 3 scope: thinking + planning ONLY — no builds, branches, commits,
 * diffs, code changes, previews. The flow is:
 *   1. gather context: task prompt + title + full chat history + queued notes
 *      (status='queued' only — discarded/other notes are ignored)
 *   2. call Mistral (server-side; key never leaves the server)
 *   3. on success: persist plan to `plan_text`, switch status
 *        ready_to_build === true  → waiting_for_start
 *        ready_to_build === false → waiting_for_input
 *      and append a human-readable `assistant` message
 *   4. on failure: status stays UNCHANGED, append a `system` message
 *      "Mistral analysis failed." and return an error
 *
 * Re-Analyze is just calling this again — the model always sees the full,
 * updated chat history (including the user's answers to its questions).
 */
export async function analyzeTask(
  taskId: string,
): Promise<Result<{ task: DevTask; plan: BuildPlan }>> {
  // Delegates to the shared orchestration so the logic has a single source of
  // truth. The Dev Cockpit UI now calls the route handler
  // (POST /api/glev-ops/dev-cockpit/analyze) instead of this server action, so
  // the long analysis stays off the Server-Action queue and never blocks other
  // actions. This action is kept for non-UI / programmatic callers.
  const res = await performAnalyze(taskId);
  if (!res.ok) return fail(res.error);
  return { ok: true, data: { task: res.task, plan: res.plan } };
}

/**
 * Start Build (Phase 5) — generate a structured build plan. PLAN ONLY, no code
 * generation/execution. Delegates to the shared orchestration; the UI calls the
 * route handler (POST /glev-ops/dev-cockpit/api/start-build) so it stays off the
 * Server-Action queue. Kept for non-UI / programmatic callers.
 */
export async function startBuild(
  taskId: string,
): Promise<Result<{ task: DevTask; build_plan: BuildExecutionPlan }>> {
  const res = await performStartBuild(taskId);
  if (!res.ok) return fail(res.error);
  return { ok: true, data: { task: res.task, build_plan: res.build_plan } };
}

/** List a task's build records newest-first (build history — display only). */
export async function listBuilds(taskId: string): Promise<Result<DevBuild[]>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_builds")
    .select(BUILD_COLUMNS)
    .eq("task_id", taskId)
    .order("version", { ascending: false });

  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as DevBuild[] };
}

/**
 * Generate Code (Phase 6) — produce a sandboxed code draft from the build plan.
 * PROPOSALS ONLY: no files written, no commits/branches/PRs/deploys. Delegates
 * to the shared orchestration; the UI calls the route handler
 * (POST /glev-ops/dev-cockpit/api/generate-code) to stay off the action queue.
 */
export async function generateCode(
  taskId: string,
): Promise<Result<{ task: DevTask; draft: CodeGenerationDraft }>> {
  const res = await performGenerateCode(taskId);
  if (!res.ok) return fail(res.error);
  return { ok: true, data: { task: res.task, draft: res.draft } };
}

/** List a task's code drafts newest-first (code history — display only). */
export async function listCodeGenerations(
  taskId: string,
): Promise<Result<DevCodeGeneration[]>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_code_generations")
    .select(CODEGEN_COLUMNS)
    .eq("task_id", taskId)
    .order("version", { ascending: false });

  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as DevCodeGeneration[] };
}

// ── Messages ─────────────────────────────────────────────────────────────────

/** List a task's messages oldest-first (chat order). */
export async function listMessages(
  taskId: string,
): Promise<Result<DevMessage[]>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_messages")
    .select("id, task_id, role, content, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });

  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as DevMessage[] };
}

/** Append a message to a task. Phase 2 only writes `user` messages. */
export async function addMessage(
  taskId: string,
  role: MessageRole,
  content: string,
): Promise<Result<DevMessage>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");
  if (!["user", "assistant", "system"].includes(role)) return fail("bad-role");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_messages")
    .insert({ task_id: taskId, role, content })
    .select("id, task_id, role, content, created_at")
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevMessage };
}

// ── Prompt Queue ─────────────────────────────────────────────────────────────

/** List a task's queue notes newest-first. */
export async function listQueueNotes(
  taskId: string,
): Promise<Result<DevQueueNote[]>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_prompt_queue")
    .select(QUEUE_COLUMNS)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as DevQueueNote[] };
}

/** Add a queue note (status 'queued'). No evaluation happens in Phase 2. */
export async function addQueueNote(
  taskId: string,
  content: string,
): Promise<Result<DevQueueNote>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");
  const text = content.trim();
  if (!text) return fail("empty");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_prompt_queue")
    .insert({ task_id: taskId, content: text, status: "queued" })
    .select(QUEUE_COLUMNS)
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevQueueNote };
}

/** Update a queue note's content and/or status. */
export async function updateQueueNote(
  id: string,
  patch: { content?: string; status?: QueueStatus },
): Promise<Result<DevQueueNote>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!id) return fail("missing-id");

  const valid: QueueStatus[] = [
    "queued", "evaluated", "applied", "after_build_pending", "discarded", "converted_to_task",
  ];
  const update: Record<string, unknown> = {};
  if (typeof patch.content === "string") update.content = patch.content;
  if (patch.status) {
    if (!valid.includes(patch.status)) return fail("bad-status");
    update.status = patch.status;
  }
  if (Object.keys(update).length === 0) return fail("noop");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_prompt_queue")
    .update(update)
    .eq("id", id)
    .select(QUEUE_COLUMNS)
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevQueueNote };
}

/** Discard a queue note (soft — sets status, keeps the row for history). */
export async function discardQueueNote(
  id: string,
): Promise<Result<DevQueueNote>> {
  return updateQueueNote(id, { status: "discarded" });
}

// ── Queue note apply / convert (Phase 4 — no build logic yet) ────────────────

/**
 * Apply To Current Build — mark the note approved to be folded into the current
 * build. NO build runs yet; a later build phase can pick up rows where
 * `approved_for_current_build = true`. Sets status='applied'.
 */
export async function applyQueueNoteToCurrentBuild(
  id: string,
): Promise<Result<DevQueueNote>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!id) return fail("missing-id");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_prompt_queue")
    .update({ status: "applied", approved_for_current_build: true })
    .eq("id", id)
    .select(QUEUE_COLUMNS)
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevQueueNote };
}

/**
 * Apply After Build — defer the note to a later follow-up build. Sets
 * status='after_build_pending' so a future build phase can find it.
 */
export async function applyQueueNoteAfterBuild(
  id: string,
): Promise<Result<DevQueueNote>> {
  return updateQueueNote(id, { status: "after_build_pending" });
}

/**
 * Create New Task from a queue note: title + prompt from the note, status
 * 'draft'; the note becomes status='converted_to_task'. No build logic.
 */
export async function convertQueueNoteToTask(
  id: string,
): Promise<Result<{ task: DevTask; note: DevQueueNote }>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!id) return fail("missing-id");

  const sb = getSupabaseAdmin();

  const { data: note, error: ne } = await sb
    .from("dev_cockpit_prompt_queue")
    .select(QUEUE_COLUMNS)
    .eq("id", id)
    .single();
  if (ne || !note) return fail(ne?.message ?? "not-found");
  const n = note as DevQueueNote;

  const created = await createTask({ prompt: n.content });
  if (!created.ok) return created;

  const { data: updated, error: ue } = await sb
    .from("dev_cockpit_prompt_queue")
    .update({ status: "converted_to_task" })
    .eq("id", id)
    .select(QUEUE_COLUMNS)
    .single();
  if (ue) return fail(ue.message);

  return { ok: true, data: { task: created.data, note: updated as DevQueueNote } };
}

// ── Attachments (metadata only — no real upload in Phase 2) ──────────────────

/** List a task's attachment metadata rows. */
export async function listAttachments(
  taskId: string,
): Promise<Result<DevAttachment[]>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_attachments")
    .select("id, task_id, file_name, file_type, file_url_or_storage_path, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (error) return fail(error.message);
  return { ok: true, data: (data ?? []) as DevAttachment[] };
}

/**
 * Create an attachment METADATA placeholder. This does NOT upload a file —
 * it only records name/type/path so later phases can attach a real storage
 * object. `file_url_or_storage_path` is optional and stays null until then.
 */
export async function createAttachmentPlaceholder(
  taskId: string,
  meta: { file_name: string; file_type?: string; file_url_or_storage_path?: string },
): Promise<Result<DevAttachment>> {
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");
  const fileName = (meta.file_name ?? "").trim();
  if (!fileName) return fail("missing-file-name");

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("dev_cockpit_attachments")
    .insert({
      task_id: taskId,
      file_name: fileName,
      file_type: meta.file_type ?? null,
      file_url_or_storage_path: meta.file_url_or_storage_path ?? null,
    })
    .select("id, task_id, file_name, file_type, file_url_or_storage_path, created_at")
    .single();

  if (error) return fail(error.message);
  return { ok: true, data: data as DevAttachment };
}

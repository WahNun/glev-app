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
import { runDevCockpitAnalysis, formatPlanMessage } from "@/lib/ai/devCockpitAnalysis";

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
  "draft", "planning", "waiting_for_start", "waiting_for_input", "building",
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
  if (!(await requireAdmin())) return fail("auth");
  if (!taskId) return fail("missing-id");

  const sb = getSupabaseAdmin();

  // 1. Context gathering
  const taskRes = await getTask(taskId);
  if (!taskRes.ok) return taskRes;
  const task = taskRes.data;

  const msgRes = await listMessages(taskId);
  const history = msgRes.ok
    ? msgRes.data.map((m) => ({ role: m.role, content: m.content }))
    : [];

  const queueRes = await listQueueNotes(taskId);
  const queuedNotes = queueRes.ok
    ? queueRes.data.filter((n) => n.status === "queued").map((n) => n.content)
    : [];

  // 2. Mistral analysis
  let plan: BuildPlan;
  try {
    plan = await runDevCockpitAnalysis({
      title: task.title,
      prompt: task.prompt ?? "",
      history,
      queuedNotes,
    });
  } catch {
    // Failure path: leave status untouched, log a system message. We do NOT
    // surface the raw error (no secrets / stack traces to the client).
    await sb.from("dev_cockpit_messages").insert({
      task_id: taskId,
      role: "system",
      content: "Mistral analysis failed.",
    });
    return fail("analysis-failed");
  }

  // 3a. Persist plan + status transition
  const nextStatus: TaskStatus = plan.ready_to_build
    ? "waiting_for_start"
    : "waiting_for_input";

  const { data: updated, error: upErr } = await sb
    .from("dev_cockpit_tasks")
    .update({ status: nextStatus, plan_text: JSON.stringify(plan) })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();
  if (upErr) return fail(upErr.message);

  // 3b. Human-readable assistant message (persistent)
  await sb.from("dev_cockpit_messages").insert({
    task_id: taskId,
    role: "assistant",
    content: formatPlanMessage(plan),
  });

  return { ok: true, data: { task: updated as DevTask, plan } };
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
    .select(
      "id, task_id, content, status, impact_level, recommendation, evaluation_text, created_at, updated_at",
    )
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
    .select(
      "id, task_id, content, status, impact_level, recommendation, evaluation_text, created_at, updated_at",
    )
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
    "queued", "evaluated", "applied", "discarded", "converted_to_task",
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
    .select(
      "id, task_id, content, status, impact_level, recommendation, evaluation_text, created_at, updated_at",
    )
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

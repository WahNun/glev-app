// Dev Cockpit Phase 7 — Preview Pipeline orchestration (server-only).
//
// Creates a GitHub branch from main, applies the code blocks from the latest
// code draft in a single batch commit (Git Tree API), then saves the preview
// record to DB.  Vercel auto-deploys the branch (GitHub integration) — we poll
// the GitHub Deployments API later via pollPreviewStatus to get the URL.
//
// Security:
//   - Admin-authed only.
//   - Never touches main/master.
//   - Never auto-merges, never auto-applies.
//   - Blocked content (env files, secrets, CI, billing, auth, schema changes
//     outside build scope) causes preview_failed.

import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Octokit } from "@octokit/rest";
import {
  TASK_COLUMNS,
  PREVIEW_COLUMNS,
  type DevTask,
  type CodeGenerationDraft,
  type DevPreview,
} from "@/app/glev-ops/dev-cockpit/types";

// ── Config ────────────────────────────────────────────────────────────────────

const GITHUB_TOKEN =
  process.env.GITHUB_PAT ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "";
const REPO_OWNER = "WahNun";
const REPO_NAME  = "glev-app";
const BASE_BRANCH = "main";

// Files that must never be included in a preview branch.
const BLOCKED_PATTERNS = [
  /\.env/i,
  /secrets?\./i,
  /\.github\/workflows/i,
  /stripe/i,
  /billing/i,
  /supabase\/migrations/i,
  /auth\//i,
];

function isBlockedFile(path: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(path));
}

// ── Result type ───────────────────────────────────────────────────────────────

export type PerformCreatePreviewResult =
  | { ok: true;  task: DevTask; preview: DevPreview }
  | { ok: false; error: string };

// ── Main ──────────────────────────────────────────────────────────────────────

export async function performCreatePreview(
  taskId: string,
): Promise<PerformCreatePreviewResult> {
  if (!(await isAdminAuthed())) return { ok: false, error: "auth" };
  if (!taskId) return { ok: false, error: "missing-id" };
  if (!GITHUB_TOKEN) return { ok: false, error: "GITHUB_PAT not configured" };

  const sb  = getSupabaseAdmin();
  const oct = new Octokit({ auth: GITHUB_TOKEN });

  // ── 1. Load task + latest code draft ────────────────────────────────────────
  const { data: taskRow, error: te } = await sb
    .from("dev_cockpit_tasks")
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .single();
  if (te || !taskRow) return { ok: false, error: te?.message ?? "task-not-found" };
  const task = taskRow as DevTask;

  if (!task.generated_code) return { ok: false, error: "no-code-draft" };
  if (task.status !== "code_ready") {
    return { ok: false, error: `invalid-status:${task.status}` };
  }

  const draft = task.generated_code as CodeGenerationDraft;
  const codeBlocks = Array.isArray(draft.generated_code_blocks)
    ? draft.generated_code_blocks as Array<{ file: string; code: string }>
    : [];

  // ── 2. Security: reject blocked files ───────────────────────────────────────
  const blocked = codeBlocks.filter((b) => isBlockedFile(b.file));
  if (blocked.length > 0) {
    const files = blocked.map((b) => b.file).join(", ");
    await sb.from("dev_cockpit_tasks").update({ status: "preview_failed" }).eq("id", taskId);
    return { ok: false, error: `blocked-files: ${files}` };
  }

  // ── 3. Determine preview version (prior previews + 1) ──────────────────────
  const { data: priorPreviews } = await sb
    .from("dev_cockpit_previews")
    .select("preview_version")
    .eq("task_id", taskId)
    .order("preview_version", { ascending: false })
    .limit(1);
  const previewVersion = ((priorPreviews?.[0]?.preview_version as number | undefined) ?? 0) + 1;

  // ── 4. Branch name ──────────────────────────────────────────────────────────
  const buildVersion = task.code_generation_version ?? 1;
  const branchName = `feature/task-${taskId.slice(0, 8)}-build-${buildVersion}-preview-${previewVersion}`;

  // Safety guard: never write to main/master.
  if (branchName === "main" || branchName === "master") {
    return { ok: false, error: "branch-name-collision-main" };
  }

  // ── 5. Update task status → creating_preview ─────────────────────────────────
  await sb
    .from("dev_cockpit_tasks")
    .update({ status: "creating_preview", branch_name: branchName })
    .eq("id", taskId);

  // ── 6. Get main HEAD SHA ────────────────────────────────────────────────────
  let mainSha: string;
  try {
    const { data: refData } = await oct.git.getRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   `heads/${BASE_BRANCH}`,
    });
    mainSha = refData.object.sha;
  } catch (e) {
    await failTask(sb, taskId);
    return { ok: false, error: `github-get-main: ${(e as Error).message}` };
  }

  // ── 7. Create branch ────────────────────────────────────────────────────────
  try {
    await oct.git.createRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   `refs/heads/${branchName}`,
      sha:   mainSha,
    });
  } catch (e) {
    await failTask(sb, taskId);
    return { ok: false, error: `github-create-branch: ${(e as Error).message}` };
  }

  // ── 8. Batch commit via Git Tree API ────────────────────────────────────────
  // Creates one clean commit with all code-block changes rather than one
  // commit per file (which the Contents API would require).
  let commitSha: string;
  try {
    // 8a. Create blobs for each code block.
    const blobs = await Promise.all(
      codeBlocks.map(async (block) => {
        const { data } = await oct.git.createBlob({
          owner:    REPO_OWNER,
          repo:     REPO_NAME,
          content:  Buffer.from(block.code).toString("base64"),
          encoding: "base64",
        });
        return { path: block.file, sha: data.sha };
      }),
    );

    // 8b. Build the new tree on top of the parent tree.
    const { data: newTree } = await oct.git.createTree({
      owner:     REPO_OWNER,
      repo:      REPO_NAME,
      base_tree: mainSha,
      tree: blobs.map((b) => ({
        path:    b.path,
        mode:    "100644" as const,
        type:    "blob"   as const,
        sha:     b.sha,
      })),
    });

    // 8c. Create the commit.
    const commitMessage = [
      "Dev Cockpit Preview",
      "",
      `Task: ${task.title}`,
      `Build: ${buildVersion}`,
      `Code Draft: ${draft.version ?? buildVersion}`,
      `Preview: #${previewVersion}`,
    ].join("\n");

    const { data: commit } = await oct.git.createCommit({
      owner:   REPO_OWNER,
      repo:    REPO_NAME,
      message: commitMessage,
      tree:    newTree.sha,
      parents: [mainSha],
    });
    commitSha = commit.sha;

    // 8d. Advance the branch ref.
    await oct.git.updateRef({
      owner: REPO_OWNER,
      repo:  REPO_NAME,
      ref:   `heads/${branchName}`,
      sha:   commitSha,
    });
  } catch (e) {
    await failTask(sb, taskId);
    return { ok: false, error: `github-commit: ${(e as Error).message}` };
  }

  // ── 9. Resolve code_generation_id ──────────────────────────────────────────
  const { data: codeGenRow } = await sb
    .from("dev_cockpit_code_generations")
    .select("id, task_id")
    .eq("task_id", taskId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const codeGenId: string | null = (codeGenRow as { id: string } | null)?.id ?? null;

  // Resolve build_id from the build_plan snapshot.
  const bp = task.build_plan as Record<string, unknown> | null;
  const buildId: string | null = typeof bp?.build_id === "string" ? bp.build_id : null;

  const commitMessage = [
    "Dev Cockpit Preview",
    "",
    `Task: ${task.title}`,
    `Build: ${buildVersion}`,
    `Code Draft: ${draft.version ?? buildVersion}`,
    `Preview: #${previewVersion}`,
  ].join("\n");

  // ── 10. Save preview record ──────────────────────────────────────────────────
  const { data: previewRow, error: pie } = await sb
    .from("dev_cockpit_previews")
    .insert({
      task_id:           taskId,
      build_id:          buildId,
      code_generation_id: codeGenId,
      preview_version:   previewVersion,
      branch_name:       branchName,
      commit_sha:        commitSha,
      commit_message:    commitMessage,
      deployment_status: "queued",
    })
    .select(PREVIEW_COLUMNS)
    .single();
  if (pie || !previewRow) {
    await failTask(sb, taskId);
    return { ok: false, error: pie?.message ?? "preview-insert-failed" };
  }

  // ── 11. Update task → preview_building ──────────────────────────────────────
  const { data: updatedTask } = await sb
    .from("dev_cockpit_tasks")
    .update({
      status:             "preview_building",
      branch_name:        branchName,
      preview_status:     "queued",
      preview_commit_sha: commitSha,
      preview_created_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();

  await sb.from("dev_cockpit_messages").insert({
    task_id: taskId,
    role:    "system",
    content: `Preview #${previewVersion} erstellt.\nBranch: \`${branchName}\`\nCommit: \`${commitSha.slice(0, 7)}\`\nVercel baut …`,
  });

  return {
    ok:      true,
    task:    (updatedTask ?? task) as DevTask,
    preview: previewRow as DevPreview,
  };
}

// ── Poll Vercel deployment status via GitHub Deployments API ─────────────────
// Vercel registers each preview deployment as a GitHub Deployment.
// The `target_url` in the deployment status contains the Vercel preview URL.

export type PollPreviewResult =
  | { ok: true;  preview: DevPreview }
  | { ok: false; error: string };

export async function pollPreviewStatus(
  previewId: string,
): Promise<PollPreviewResult> {
  if (!(await isAdminAuthed())) return { ok: false, error: "auth" };
  if (!GITHUB_TOKEN) return { ok: false, error: "no-github-token" };

  const sb  = getSupabaseAdmin();
  const oct = new Octokit({ auth: GITHUB_TOKEN });

  const { data: row, error: re } = await sb
    .from("dev_cockpit_previews")
    .select(PREVIEW_COLUMNS)
    .eq("id", previewId)
    .single();
  if (re || !row) return { ok: false, error: "preview-not-found" };
  const preview = row as DevPreview;

  // Already settled — return cached.
  if (preview.deployment_status === "ready" || preview.deployment_status === "failed") {
    return { ok: true, preview };
  }

  // Find the Vercel GitHub Deployment for this branch.
  try {
    const { data: deployments } = await oct.repos.listDeployments({
      owner:       REPO_OWNER,
      repo:        REPO_NAME,
      ref:         preview.branch_name,
      environment: "Preview",
      per_page:    5,
    });

    if (deployments.length === 0) {
      // Still queued — Vercel hasn't picked it up yet.
      return { ok: true, preview };
    }

    // Use the most recent deployment.
    const deployment = deployments[0];
    const depId = deployment.id;

    const { data: statuses } = await oct.repos.listDeploymentStatuses({
      owner:         REPO_OWNER,
      repo:          REPO_NAME,
      deployment_id: depId,
      per_page:      5,
    });

    if (statuses.length === 0) {
      // Deployment exists but no status yet.
      await sb.from("dev_cockpit_previews")
        .update({ deployment_status: "building", github_deployment_id: depId })
        .eq("id", previewId);
      const updated = { ...preview, deployment_status: "building" as const, github_deployment_id: depId };
      await syncTaskPreviewStatus(sb, preview.task_id, updated);
      return { ok: true, preview: updated };
    }

    const latest = statuses[0];
    const ghState = latest.state; // "pending" | "success" | "failure" | "error" | "inactive"
    const targetUrl = typeof (latest as Record<string, unknown>).environment_url === "string"
      ? (latest as Record<string, unknown>).environment_url as string
      : (latest.target_url ?? null);

    let deployStatus: DevPreview["deployment_status"] = "building";
    if (ghState === "success") deployStatus = "ready";
    else if (ghState === "failure" || ghState === "error") deployStatus = "failed";

    const patch: Partial<DevPreview> = {
      deployment_status:     deployStatus,
      github_deployment_id:  depId,
      preview_url:           deployStatus === "ready" ? (targetUrl ?? null) : null,
    };
    await sb.from("dev_cockpit_previews").update(patch).eq("id", previewId);

    const updated = { ...preview, ...patch };
    await syncTaskPreviewStatus(sb, preview.task_id, updated);
    return { ok: true, preview: updated };

  } catch (e) {
    return { ok: false, error: `github-poll: ${(e as Error).message}` };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function failTask(sb: ReturnType<typeof getSupabaseAdmin>, taskId: string) {
  await sb
    .from("dev_cockpit_tasks")
    .update({ status: "preview_failed", preview_status: "failed" })
    .eq("id", taskId);
}

async function syncTaskPreviewStatus(
  sb: ReturnType<typeof getSupabaseAdmin>,
  taskId: string,
  preview: Partial<DevPreview>,
) {
  const taskStatus =
    preview.deployment_status === "ready"  ? "preview_ready"  :
    preview.deployment_status === "failed" ? "preview_failed" :
    "preview_building";
  await sb.from("dev_cockpit_tasks").update({
    status:         taskStatus,
    preview_status: preview.deployment_status,
    preview_url:    preview.preview_url ?? null,
  }).eq("id", taskId);
}

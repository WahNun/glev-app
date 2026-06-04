// Dev Cockpit Phase 6 — Coding Agent (sandboxed code-draft generation).
//
// Server-only, Dev Cockpit credential bucket. Turns a build plan into a
// concrete CODE DRAFT: proposed files to create/modify, ordered implementation
// steps, and actual code blocks. PROPOSALS ONLY — nothing is written to disk,
// no commits, no branches, no PRs, no deploys. Scope is strictly task-local.

import { getDevCockpitMistralClient } from "./mistralClient";
import { logAiUsage } from "./aiUsageLog";
import type { GeneratedCodeDraft, CodeBlock, ChangeSize } from "@/app/glev-ops/dev-cockpit/types";

const CODE_MODEL =
  process.env.DEV_COCKPIT_CODE_MODEL ?? process.env.DEV_COCKPIT_ANALYSIS_MODEL ?? "mistral-large-latest";

const SYSTEM_PROMPT = `You are a Senior Software Engineer implementing a task in an existing codebase. You produce a CODE DRAFT — concrete proposed file changes and code — but you ONLY propose. Nothing you output is written to disk, committed, branched, merged, or deployed. It is a sandboxed draft for human review.

Project: Next.js 16 (App Router) + TypeScript on Supabase, deployed via Vercel. Server logic via server actions / route handlers; admin tooling under app/glev-ops; shared libs under lib/. Match the project's conventions.

You receive a build plan (scope + ordered steps), the current-build note snapshot, the prior analysis, the task title and conversation. Implement the build plan and the current-build notes. Do NOT implement excluded/after-build notes or anything outside this task.

Respond with a SINGLE JSON object and nothing else, matching exactly:
{
  "summary": string,                 // 1-3 sentences: what the draft implements
  "files_to_create": string[],       // new file paths (max ~10)
  "files_to_modify": string[],       // existing file paths to change (max ~10)
  "implementation_steps": string[],  // ordered, concrete dev steps (max ~10)
  "generated_code_blocks": [         // actual proposed code, one entry per file (max ~8)
    { "file": string, "code": string }
  ],
  "risks": string[],                 // concrete risks/edge cases ([] if none, max ~5)
  "estimated_change_size": "small" | "medium" | "large"
}

Rules:
- Provide real, concrete code in generated_code_blocks (not pseudocode), consistent with the file paths.
- Keep code blocks focused; it's a draft for review, not the entire repo.
- Do NOT include shell commands, git operations, or deploy steps.
- LANGUAGE for prose fields (summary/steps/risks): the language of the task/prompt (German if German, else English). Code stays as code. Output JSON only.`;

function buildUserPrompt(input: {
  title: string;
  analysisPlanText: string | null;
  buildPlanJson: string | null;
  includedNotes: string[];
  excludedNotes: string[];
  messages: { role: string; content: string }[];
}): string {
  const parts: string[] = [];
  parts.push(`# Task title\n${input.title || "(kein Titel)"}`);
  if (input.buildPlanJson) parts.push(`# Build plan (JSON — implement this)\n${input.buildPlanJson.slice(0, 4000)}`);
  if (input.analysisPlanText) parts.push(`# Prior analysis (JSON)\n${input.analysisPlanText.slice(0, 2000)}`);
  parts.push(
    `# Current-build notes (implement)\n${input.includedNotes.length ? input.includedNotes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(keine)"}`,
  );
  parts.push(
    `# Excluded notes (DO NOT implement)\n${input.excludedNotes.length ? input.excludedNotes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(keine)"}`,
  );
  if (input.messages.length) {
    parts.push(`# Task conversation\n${input.messages.map((m) => `[${m.role}] ${m.content}`).join("\n").slice(0, 3000)}`);
  }
  parts.push("Produce the code draft JSON implementing the build plan + current-build notes.");
  return parts.join("\n\n");
}

function toStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : String(x))).map((s) => s.trim()).filter(Boolean)
    : [];
}

function toCodeBlocks(v: unknown): CodeBlock[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((b) => {
      const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
      return { file: typeof o.file === "string" ? o.file : "", code: typeof o.code === "string" ? o.code : "" };
    })
    .filter((b) => b.file || b.code);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

function normalize(raw: unknown): GeneratedCodeDraft {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const size: ChangeSize =
    o.estimated_change_size === "small" || o.estimated_change_size === "large" ? o.estimated_change_size : "medium";
  return {
    summary: typeof o.summary === "string" ? o.summary.trim() : "",
    files_to_create: toStrArray(o.files_to_create),
    files_to_modify: toStrArray(o.files_to_modify),
    implementation_steps: toStrArray(o.implementation_steps),
    generated_code_blocks: toCodeBlocks(o.generated_code_blocks),
    risks: toStrArray(o.risks),
    estimated_change_size: size,
  };
}

export async function runCodeGeneration(input: {
  title: string;
  analysisPlanText: string | null;
  buildPlanJson: string | null;
  includedNotes: string[];
  excludedNotes: string[];
  messages: { role: string; content: string }[];
}): Promise<GeneratedCodeDraft> {
  const client = getDevCockpitMistralClient();
  const startedAt = Date.now();

  let completion;
  try {
    completion = await client.chat.complete({
      model: CODE_MODEL,
      temperature: 0.2,
      maxTokens: 4000,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });
  } catch (e) {
    logAiUsage({ source: "dev_cockpit", model: CODE_MODEL, operation: "generate_code", ok: false, ms: Date.now() - startedAt });
    throw e;
  }

  const usage = (completion?.usage ?? undefined) as unknown as
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined;
  logAiUsage({
    source: "dev_cockpit",
    model: CODE_MODEL,
    operation: "generate_code",
    ok: true,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    ms: Date.now() - startedAt,
  });

  const text = extractText(completion?.choices?.[0]?.message?.content).trim();
  if (!text) throw new Error("Empty code generation response from Mistral");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Code generation did not return valid JSON");
    parsed = JSON.parse(match[0]);
  }

  return normalize(parsed);
}

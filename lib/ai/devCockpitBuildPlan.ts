// Dev Cockpit Phase 5 — Build Plan generation ("Start Build").
//
// Server-only, Dev Cockpit credential bucket. Turns a task (+ its analysis plan
// + the current-build queue notes) into a structured, ordered build plan.
// PLAN ONLY — no code generation, no branches, no diffs, no execution (Phase 6
// builds on this). Excluded (after_build) notes are listed but NOT planned;
// separate_task notes are ignored entirely.

import { getDevCockpitMistralClient } from "./mistralClient";
import { logAiUsage } from "./aiUsageLog";
import type { GeneratedBuildPlan, Complexity } from "@/app/glev-ops/dev-cockpit/types";

const BUILD_MODEL =
  process.env.DEV_COCKPIT_ANALYSIS_MODEL ?? "mistral-large-latest";

const SYSTEM_PROMPT = `You are a Senior Software Architect producing an ordered BUILD PLAN for a development task, just before implementation. You PLAN ONLY — you never write code, create branches, commits, or diffs.

Project: Next.js 16 (App Router) + TypeScript on Supabase, deployed via Vercel; server logic via server actions / route handlers; admin tooling under app/glev-ops.

You receive: the task, its prior analysis plan, and the CURRENT-BUILD notes that MUST be folded into this build. You also receive EXCLUDED notes (deferred to a later build) — do NOT plan those; they are listed for awareness only.

Produce a concrete, ordered list of build steps that delivers the task AND the current-build notes. Estimate overall complexity and surface real risks.

Respond with a SINGLE JSON object and nothing else, matching exactly:
{
  "scope": string,            // 1-3 sentences: what this build delivers (incl. current-build notes)
  "steps": string[],          // ordered, concrete build steps (max ~8)
  "affected_areas": string[], // subsystems/modules touched (max ~6)
  "risks": string[],          // concrete risks/edge cases ([] if none, max ~5)
  "complexity": "low" | "medium" | "high"
}

Rules:
- Fold every CURRENT-BUILD note into the steps/scope.
- Do NOT include excluded/after-build items or separate tasks in the steps.
- Keep steps actionable and ordered. Output JSON only.
- LANGUAGE: reply in the language of the task/prompt (German if German, else English).`;

function buildUserPrompt(input: {
  title: string;
  prompt: string;
  analysisPlanText: string | null;
  includedNotes: string[];
  excludedNotes: string[];
}): string {
  const parts: string[] = [];
  parts.push(`# Task\nTitle: ${input.title || "(kein Titel)"}\nPrompt: ${input.prompt?.trim() || "(kein Prompt)"}`);
  if (input.analysisPlanText) {
    parts.push(`# Prior analysis plan (JSON)\n${input.analysisPlanText.slice(0, 2500)}`);
  }
  parts.push(
    `# CURRENT-BUILD notes (MUST be folded into this build)\n${
      input.includedNotes.length ? input.includedNotes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(keine)"
    }`,
  );
  parts.push(
    `# EXCLUDED notes (deferred — DO NOT plan these)\n${
      input.excludedNotes.length ? input.excludedNotes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "(keine)"
    }`,
  );
  parts.push("Produce the build plan JSON for the task + current-build notes only.");
  return parts.join("\n\n");
}

function toStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : String(x))).map((s) => s.trim()).filter(Boolean)
    : [];
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

function normalize(raw: unknown): GeneratedBuildPlan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const complexity: Complexity =
    o.complexity === "high" || o.complexity === "low" ? o.complexity : "medium";
  return {
    scope: typeof o.scope === "string" ? o.scope.trim() : "",
    steps: toStrArray(o.steps),
    affected_areas: toStrArray(o.affected_areas),
    risks: toStrArray(o.risks),
    complexity,
  };
}

export async function runBuildPlanGeneration(input: {
  title: string;
  prompt: string;
  analysisPlanText: string | null;
  includedNotes: string[];
  excludedNotes: string[];
}): Promise<GeneratedBuildPlan> {
  const client = getDevCockpitMistralClient();
  const startedAt = Date.now();

  let completion;
  try {
    completion = await client.chat.complete({
      model: BUILD_MODEL,
      temperature: 0.2,
      maxTokens: 1200,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });
  } catch (e) {
    logAiUsage({ source: "dev_cockpit", model: BUILD_MODEL, operation: "start_build", ok: false, ms: Date.now() - startedAt });
    throw e;
  }

  const usage = (completion?.usage ?? undefined) as unknown as
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined;
  logAiUsage({
    source: "dev_cockpit",
    model: BUILD_MODEL,
    operation: "start_build",
    ok: true,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    ms: Date.now() - startedAt,
  });

  const text = extractText(completion?.choices?.[0]?.message?.content).trim();
  if (!text) throw new Error("Empty build plan response from Mistral");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Build plan did not return valid JSON");
    parsed = JSON.parse(match[0]);
  }

  return normalize(parsed);
}

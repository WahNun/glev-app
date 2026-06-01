// Dev Cockpit Phase 3 — Mistral-backed task analysis ("Analyze Task").
//
// Server-only. The Mistral API key lives exclusively in MISTRAL_API_KEY
// (read by getMistralClient) and never reaches the client. This module turns
// a task (prompt + chat history + queued notes) into a structured BuildPlan.
//
// Scope: thinking + planning ONLY. No builds, branches, commits, diffs, code
// changes, previews. The analysis just understands the task, flags risks,
// guesses affected areas/files, asks follow-up questions, and decides whether
// it is ready to build.

import { getMistralClient } from "./mistralClient";
import type { BuildPlan } from "@/app/glev-ops/dev-cockpit/types";

// Architect-grade model by default; override via env without a code change.
const ANALYSIS_MODEL =
  process.env.DEV_COCKPIT_ANALYSIS_MODEL ?? "mistral-large-latest";

const SYSTEM_PROMPT = `You are a Senior Software Architect reviewing a development task before any code is written.

You think and plan ONLY. You never write code, create branches, commits, builds, or diffs. Your job is to understand the request, surface risks, guess which areas/files are affected, ask clarifying questions when something is genuinely unclear, and decide whether the task is ready to build.

Project context: a Next.js 16 (App Router) + TypeScript app on Supabase, deployed via Vercel. Server logic uses server actions and route handlers. Admin tooling lives under app/glev-ops. Be concrete and reference realistic file paths/areas for a codebase of this shape when relevant.

Respond with a SINGLE JSON object and nothing else, matching exactly this schema:
{
  "summary": string,            // 2-4 sentences: what is to be built, in your own words
  "affected_areas": string[],   // subsystems/modules likely touched (e.g. "Auth", "Supabase schema", "Admin UI")
  "likely_files": string[],     // best-guess file paths that would change
  "risks": string[],            // concrete risks, edge cases, gotchas
  "questions": string[],        // open questions for the user; EMPTY array if none
  "ready_to_build": boolean     // true ONLY if questions is empty and the task is clear enough to plan a build
}

Rules:
- If you have ANY open question, set ready_to_build to false and list the questions.
- If everything is clear, set questions to [] and ready_to_build to true.
- Keep arrays focused (max ~6 items each). Use clear, professional language. Answer in the language of the task prompt.
- Output JSON only — no markdown, no prose around it.`;

function buildUserPrompt(input: {
  title: string;
  prompt: string;
  history: { role: string; content: string }[];
  queuedNotes: string[];
}): string {
  const parts: string[] = [];
  parts.push(`# Task title\n${input.title || "(kein Titel)"}`);
  parts.push(`# Task prompt\n${input.prompt?.trim() || "(kein Prompt angegeben)"}`);

  if (input.history.length) {
    const convo = input.history
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n");
    parts.push(`# Conversation so far (oldest first)\n${convo}`);
  }

  if (input.queuedNotes.length) {
    const notes = input.queuedNotes.map((n, i) => `${i + 1}. ${n}`).join("\n");
    parts.push(
      `# Queued notes (additional requests to consider; queued status only)\n${notes}`,
    );
  }

  parts.push(
    "Analyze the task above and respond with the JSON object per the schema.",
  );
  return parts.join("\n\n");
}

// Coerce whatever the model returned into a safe BuildPlan. Defensive: the
// model is instructed to return clean JSON, but we never trust it blindly.
function normalizePlan(raw: unknown): BuildPlan {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const toStrArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? x : String(x))).map((s) => s.trim()).filter(Boolean)
      : [];

  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const affected_areas = toStrArray(obj.affected_areas);
  const likely_files = toStrArray(obj.likely_files);
  const risks = toStrArray(obj.risks);
  const questions = toStrArray(obj.questions);

  // Source of truth for readiness: no open questions. We override the model's
  // boolean so the two can never contradict each other.
  const ready_to_build = questions.length === 0 && obj.ready_to_build !== false;

  return { summary, affected_areas, likely_files, risks, questions, ready_to_build };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  // Mistral may return content as an array of chunks.
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

/**
 * Run the Mistral analysis and return a validated BuildPlan.
 * Throws on transport / parse failure so the caller can keep the task status
 * unchanged and record a "Mistral analysis failed." system message.
 */
export async function runDevCockpitAnalysis(input: {
  title: string;
  prompt: string;
  history: { role: string; content: string }[];
  queuedNotes: string[];
}): Promise<BuildPlan> {
  const client = getMistralClient();

  const completion = await client.chat.complete({
    model: ANALYSIS_MODEL,
    temperature: 0.3,
    maxTokens: 1400,
    // Force a JSON object response so parsing is reliable.
    responseFormat: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const text = extractText(completion?.choices?.[0]?.message?.content).trim();
  if (!text) throw new Error("Empty analysis response from Mistral");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Last-resort: pull the first {...} block out of the text.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Mistral analysis did not return valid JSON");
    parsed = JSON.parse(match[0]);
  }

  return normalizePlan(parsed);
}

/**
 * Render a BuildPlan as a human-readable assistant chat message (NOT JSON).
 * Stored persistently as the `assistant` message after each analysis.
 */
export function formatPlanMessage(plan: BuildPlan): string {
  const lines: string[] = ["Ich habe die Aufgabe analysiert."];

  if (plan.summary) lines.push("", plan.summary);

  if (plan.affected_areas.length) {
    lines.push("", "Betroffene Bereiche:");
    for (const a of plan.affected_areas) lines.push(`• ${a}`);
  }

  if (plan.likely_files.length) {
    lines.push("", "Vermutete Dateien:");
    for (const f of plan.likely_files) lines.push(`• ${f}`);
  }

  if (plan.risks.length) {
    lines.push("", "Risiken:");
    for (const r of plan.risks) lines.push(`• ${r}`);
  }

  if (plan.questions.length) {
    lines.push("", "Offene Fragen:");
    for (const q of plan.questions) lines.push(`• ${q}`);
  }

  lines.push(
    "",
    plan.ready_to_build
      ? "✅ Bereit für Start Build — bitte beantworte ggf. Rückfragen, sonst kann gestartet werden."
      : "⏳ Ich benötige noch zusätzliche Informationen — bitte beantworte die offenen Fragen und starte dann Re-Analyze.",
  );

  return lines.join("\n");
}

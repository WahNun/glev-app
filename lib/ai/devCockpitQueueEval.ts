// Dev Cockpit Phase 4 — Mistral-backed Prompt Queue evaluation.
//
// Server-only. Uses the Dev Cockpit credential bucket (separate cost tracking).
// Decides what to do with a single queued follow-up note relative to the
// current task: fold into the current build, defer to after the build, spin off
// a separate task, or discard. Thinking/planning ONLY — no builds, branches,
// diffs, code changes.

import { getDevCockpitMistralClient } from "./mistralClient";
import { logAiUsage } from "./aiUsageLog";
import { isTaskDestructive } from "./devCockpitAnalysis";
import type { QueueEvaluation, ImpactLevel, Recommendation } from "@/app/glev-ops/dev-cockpit/types";

const EVAL_MODEL =
  process.env.DEV_COCKPIT_ANALYSIS_MODEL ?? "mistral-large-latest";

const SYSTEM_PROMPT = `You are a Senior Software Architect triaging a single follow-up note added to the queue of a development task. You decide ONLY how the note relates to the current task — you never write code, builds, branches, or diffs.

Decide two things: how big the change is (impact_level) and what should happen with it (recommendation).

impact_level + typical recommendation:
- "low"  → a tiny tweak to what is already planned (button position, copy, colour/spacing, small UI addition). Usually recommendation "current_build".
- "medium" → a small extension of the SAME feature (an extra state, an extra validation, a small extra backend query). Usually "after_build", sometimes "current_build" depending on context.
- "high" → a different feature, new database logic, new Stripe/billing logic, auth/security change, larger architecture change, destructive change, or a scope switch. Usually "separate_task".

recommendation values: "current_build" | "after_build" | "separate_task" | "discard".

Use "discard" ONLY if the note is unintelligible, completely irrelevant to the task, obviously a duplicate, or contradicts a constraint the user already decided.

SAFETY OVERRIDE (takes precedence): if the note is destructive or sensitive — deleting users, deleting DB data, changing Stripe/billing, changing auth/permissions, destructive SQL — then impact_level MUST be "high", recommendation MUST be "separate_task", and evaluation_text MUST name the security/data-loss risk. NEVER fold such a note into current_build.

Respond with a SINGLE JSON object and nothing else, matching exactly:
{
  "impact_level": "low" | "medium" | "high",
  "recommendation": "current_build" | "after_build" | "separate_task" | "discard",
  "evaluation_text": string,   // 1-3 sentences explaining the call
  "affected_areas": string[],  // subsystems the note would touch (max ~5)
  "risks": string[]            // concrete risks; [] if none (max ~5)
}

LANGUAGE: reply in the language of the queue note — German if it is German, English if English. Default German when ambiguous. Output JSON only.`;

function buildUserPrompt(input: {
  taskTitle: string;
  taskPrompt: string;
  taskStatus: string;
  planText: string | null;
  messages: { role: string; content: string }[];
  note: string;
  otherNotes: string[];
}): string {
  const parts: string[] = [];
  parts.push(`# Current task\nTitle: ${input.taskTitle || "(kein Titel)"}\nStatus: ${input.taskStatus}\nPrompt: ${input.taskPrompt?.trim() || "(kein Prompt)"}`);

  if (input.planText) {
    // plan_text is the stored BuildPlan JSON; summarise it as context.
    parts.push(`# Existing build plan (JSON)\n${input.planText.slice(0, 2000)}`);
  }

  if (input.messages.length) {
    const convo = input.messages
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n")
      .slice(0, 3000);
    parts.push(`# Task conversation\n${convo}`);
  }

  if (input.otherNotes.length) {
    parts.push(
      `# Other queued notes on this task (for dedupe/context)\n${input.otherNotes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`,
    );
  }

  parts.push(`# Queue note to evaluate\n${input.note}`);
  parts.push("Evaluate ONLY the queue note above and respond with the JSON object.");
  return parts.join("\n\n");
}

function toStrArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : String(x))).map((s) => s.trim()).filter(Boolean)
    : [];
}

function normalizeEval(raw: unknown): QueueEvaluation {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const impact: ImpactLevel =
    o.impact_level === "high" || o.impact_level === "medium" ? o.impact_level : "low";
  const recRaw = o.recommendation;
  const recommendation: Recommendation =
    recRaw === "current_build" || recRaw === "after_build" || recRaw === "separate_task" || recRaw === "discard"
      ? recRaw
      : "after_build";
  return {
    impact_level: impact,
    recommendation,
    evaluation_text: typeof o.evaluation_text === "string" ? o.evaluation_text.trim() : "",
    affected_areas: toStrArray(o.affected_areas),
    risks: toStrArray(o.risks),
  };
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

/**
 * Deterministic safety override: a destructive note can never be folded into
 * the current build. Forces high impact + separate_task and ensures the risk
 * is named. Independent of model output.
 */
function enforceQueueSafety(evaluation: QueueEvaluation, note: string): QueueEvaluation {
  if (!isTaskDestructive(note)) return evaluation;
  const risks = evaluation.risks.length
    ? evaluation.risks
    : ["Destruktive / sicherheitsrelevante Änderung (z. B. Daten-/Nutzerlöschung, Billing, Auth) — Datenverlust- bzw. Sicherheitsrisiko."];
  const evaluation_text =
    /risik|sicherheit|risk|security|datenverlust|data loss/i.test(evaluation.evaluation_text)
      ? evaluation.evaluation_text
      : `${evaluation.evaluation_text} ⚠️ Sicherheitsrisiko: destruktive/sensible Änderung — als separate Task mit Freigabe behandeln, nicht in den aktuellen Build aufnehmen.`.trim();
  return {
    ...evaluation,
    impact_level: "high",
    recommendation: "separate_task",
    evaluation_text,
    risks,
  };
}

export async function runQueueEvaluation(input: {
  taskTitle: string;
  taskPrompt: string;
  taskStatus: string;
  planText: string | null;
  messages: { role: string; content: string }[];
  note: string;
  otherNotes: string[];
}): Promise<QueueEvaluation> {
  const client = getDevCockpitMistralClient();
  const startedAt = Date.now();

  let completion;
  try {
    completion = await client.chat.complete({
      model: EVAL_MODEL,
      temperature: 0.2,
      maxTokens: 900,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    });
  } catch (e) {
    logAiUsage({ source: "dev_cockpit", model: EVAL_MODEL, operation: "evaluate_queue", ok: false, ms: Date.now() - startedAt });
    throw e;
  }

  const usage = (completion?.usage ?? undefined) as unknown as
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined;
  logAiUsage({
    source: "dev_cockpit",
    model: EVAL_MODEL,
    operation: "evaluate_queue",
    ok: true,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    ms: Date.now() - startedAt,
  });

  const text = extractText(completion?.choices?.[0]?.message?.content).trim();
  if (!text) throw new Error("Empty queue evaluation response from Mistral");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Queue evaluation did not return valid JSON");
    parsed = JSON.parse(match[0]);
  }

  return enforceQueueSafety(normalizeEval(parsed), input.note);
}

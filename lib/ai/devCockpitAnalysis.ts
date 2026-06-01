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

You think and plan ONLY. You never write code, create branches, commits, builds, or diffs. Your job is to understand the request, surface risks, guess which areas/files are affected, and decide whether the task is ready to build.

Project context: a Next.js 16 (App Router) + TypeScript app on Supabase, deployed via Vercel. Server logic uses server actions and route handlers. Admin tooling lives under app/glev-ops. Be concrete and reference realistic file paths/areas for a codebase of this shape when relevant.

DEFAULT TO PLANNING, NOT BLOCKING. You are a senior engineer: when something is merely unclear, make a reasonable, explicit assumption and KEEP PLANNING. Do NOT ask the user about things you can sensibly decide yourself. Only block when a real answer is genuinely required.

NORMAL uncertainties — make a plausible assumption, add it to "assumptions", DO NOT put it in "questions", keep ready_to_build = true:
- the exact file/location is unknown
- whether SQL or TypeScript is the better approach
- small design details are missing
- responsive behaviour is not explicitly described
- the existing data structure must be inspected first
- an extra context display would be optional / nice-to-have

REAL blockers — put a concise question in "questions" and set ready_to_build = false ONLY for these:
- the goal is internally contradictory
- a security-relevant decision is missing
- a potentially destructive DB change is unclear (data loss risk)
- payment / billing logic is unclear
- the user must choose between several strongly different product directions
- the task cannot be analyzed at all without external credentials/secrets

⛔ SAFETY OVERRIDE — this takes ABSOLUTE PRECEDENCE over the "default to planning" guidance above. NEVER treat the following as a normal assumption. If the task involves ANY of these, you MUST set ready_to_build = false and put concrete, specific safety questions in "questions" (unless the task ALREADY spells out the exact safety details — criteria, scope, dry-run, backup, batching, audit, authorization):
- deleting users or accounts
- deleting database rows / records / entries
- any irreversible or destructive data change
- billing- or subscription-based deletion logic
- changes to auth.users
- destructive SQL (DELETE, DROP, TRUNCATE, bulk UPDATE)
- bulk delete / mass update of data

For such a task, "questions" MUST contain the still-open safety questions, e.g. (for user/billing deletion):
- What exactly counts as "no active payment" / an inactive user?
- Should a dry run / preview of the affected rows be produced first?
- Which tables are allowed to be affected?
- Should a backup/export be created before deletion?
- Should the action run in batches?
- Should an audit log be created?
- Who is allowed to trigger this action?

Do NOT conclude "ready to build" for a destructive task while these are unanswered. The summary should frame it as: needs a security sign-off / exact definition before build.

Respond with a SINGLE JSON object and nothing else, matching exactly this schema:
{
  "summary": string,            // 2-4 sentences: what is to be built, in your own words
  "affected_areas": string[],   // subsystems/modules likely touched (e.g. "Auth", "Supabase schema", "Admin UI")
  "likely_files": string[],     // best-guess file paths that would change
  "assumptions": string[],      // plausible assumptions you made to keep planning (normal uncertainties go here)
  "risks": string[],            // concrete risks, edge cases, gotchas
  "questions": string[],        // ONLY real blockers (see above); EMPTY array if none
  "ready_to_build": boolean     // true unless there is a REAL blocker in questions
}

Rules:
- Put normal uncertainties in "assumptions", never in "questions".
- "questions" is non-empty ONLY for real blockers. If questions is empty, ready_to_build MUST be true.
- If (and only if) there is a real blocker, set ready_to_build = false and list it in questions.
- Keep arrays focused (max ~6 items each). Use clear, professional language.
- LANGUAGE: reply in the language the user writes in — German if the task/conversation is in German, English if in English. Default to German when ambiguous.
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
  const assumptions = toStrArray(obj.assumptions);
  const risks = toStrArray(obj.risks);
  const questions = toStrArray(obj.questions);

  // Source of truth for readiness: no REAL blocker questions. Normal
  // uncertainties live in `assumptions` and do not block. We override the
  // model's boolean so the two can never contradict each other — only a
  // non-empty `questions` list (real blockers) flips readiness to false.
  const ready_to_build = questions.length === 0 && obj.ready_to_build !== false;

  return { summary, affected_areas, likely_files, assumptions, risks, questions, ready_to_build };
}

// ── Destructive-task safety net ──────────────────────────────────────────────
//
// Belt-and-suspenders on top of the SAFETY OVERRIDE in the system prompt: if
// the task text clearly describes a destructive data operation, we never let
// the analysis come back "ready to build" with no questions. This guarantees
// the block even if the model wavers. Patterns are intentionally strong-signal
// (delete/drop/truncate/bulk + users/rows/billing/auth) to avoid blocking
// benign UI tasks like "add a delete button for a single item".
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdelete\s+(all\s+|every\s+)?(users?|accounts?|rows?|records?|entries|customers?|subscriptions?)/i,
  /\b(lösch|loesch|entfern)\w*\s+(alle\s+|sämtliche\s+|saemtliche\s+)?(nutzer|user|accounts?|konten|kunden|einträge|eintraege|datensätze|datensaetze|zeilen|abos?|subscriptions?)/i,
  /\bdrop\s+(table|column|database|schema)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\b(bulk|mass)\s+(delete|deletion|update)\b/i,
  /\bauth\.users\b/i,
  /\b(destructive|irreversible|unwiederbringlich|unwiederruflich)\b/i,
  /\b(subscription|billing|payment|zahlung|abo)\w*\b[^.\n]{0,40}\b(delete|lösch|loesch|remove|entfern|cancel|kündig|kuendig)/i,
  /\b(delete|lösch|loesch|remove|entfern)\w*\b[^.\n]{0,40}\b(subscription|billing|payment|zahlung|abo|nutzer ohne)/i,
];

// German fallback safety questions, used only when the model returned a
// destructive plan with NO questions. Normally the model produces these
// itself (in the user's language) per the SAFETY OVERRIDE.
const FALLBACK_SAFETY_QUESTIONS: string[] = [
  "Was zählt exakt als Lösch-Kriterium (z. B. keine aktive Zahlung / inaktiver Nutzer)?",
  "Soll zuerst ein Dry Run / Preview der betroffenen Datensätze erstellt werden?",
  "Welche Tabellen dürfen betroffen sein?",
  "Soll vor der Löschung ein Backup/Export erstellt werden?",
  "Soll die Aktion batchweise laufen?",
  "Soll ein Audit-Log erstellt werden?",
  "Wer darf diese Aktion auslösen (Berechtigung)?",
];

function isDestructive(text: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(text));
}

/**
 * Enforce the destructive-task safety gate. If the task text is destructive,
 * the plan can never be "ready to build" without open safety questions.
 */
function enforceSafetyBlock(plan: BuildPlan, taskText: string): BuildPlan {
  if (!isDestructive(taskText)) return plan;
  if (!plan.ready_to_build && plan.questions.length > 0) return plan; // already blocked properly
  const questions = plan.questions.length ? plan.questions : [...FALLBACK_SAFETY_QUESTIONS];
  return { ...plan, questions, ready_to_build: false };
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

  const plan = normalizePlan(parsed);
  // Safety net: destructive tasks must never come back ready-to-build silently.
  const taskText = [input.title, input.prompt, ...input.queuedNotes].join("\n");
  return enforceSafetyBlock(plan, taskText);
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

  if (plan.assumptions.length) {
    lines.push("", "Annahmen:");
    for (const a of plan.assumptions) lines.push(`• ${a}`);
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
      : "🔒 Benötigt Sicherheitsfreigabe / Definition vor Build — bitte beantworte die offenen Fragen und starte dann Re-Analyze.",
  );

  return lines.join("\n");
}

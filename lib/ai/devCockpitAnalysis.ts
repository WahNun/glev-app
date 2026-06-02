// Dev Cockpit Phase 3 — Mistral-backed task analysis ("Analyze Task").
//
// Server-only. Dev Cockpit AI uses its OWN credential bucket via
// getDevCockpitMistralClient (MISTRAL_DEV_COCKPIT_API_KEY, falling back to
// MISTRAL_API_KEY); the key never reaches the client. This module turns a task
// (prompt + chat history + queued notes) into a structured BuildPlan.
//
// Scope: thinking + planning ONLY. No builds, branches, commits, diffs, code
// changes, previews. The analysis just understands the task, flags risks,
// guesses affected areas/files, asks follow-up questions, and decides whether
// it is ready to build.

import { getDevCockpitMistralClient } from "./mistralClient";
import { logAiUsage } from "./aiUsageLog";
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

// ── Deterministic destructive-task safety gate ───────────────────────────────
//
// HARD, model-independent gate. The system-prompt SAFETY OVERRIDE is advisory;
// this is the guarantee. Rule (per spec): if the combined text (task title +
// prompt + ENTIRE chat history + queued notes) contains BOTH a destructive verb
// AND a sensitive target, ready_to_build can NEVER be true. Plus an explicit
// hardcoded phrase that must always block.
//
// Verb-AND-target (rather than adjacency) is intentionally robust: it catches
// "Lösche alle Nutzer ohne aktive Zahlung aus der Datenbank" regardless of word
// order/separation. A lone verb with no sensitive target (e.g. "Delete-Button
// für einzelne Notizen") does NOT auto-block.

const DESTRUCTIVE_VERBS: string[] = [
  "lösche", "löschen", "loesche", "loeschen", "entferne", "entfernen",
  "delete", "remove", "drop", "truncate", "purge", "wipe",
];

const SENSITIVE_TARGETS: string[] = [
  "nutzer", "user", "users", "account", "accounts", "auth.users",
  "datenbank", "database", "db", "zahlung", "zahlungen", "payment",
  "payments", "subscription", "subscriptions", "abo", "abos", "billing",
  "kunde", "kunden", "customer", "customers",
];

// Phrases that must ALWAYS hard-block, normalized (lowercase, collapsed spaces).
const HARDCODED_BLOCK_PHRASES: string[] = [
  "lösche alle nutzer ohne aktive zahlung aus der datenbank",
  "loesche alle nutzer ohne aktive zahlung aus der datenbank",
];

// Mandatory safety questions injected on every hard block (spec Pflichtfragen).
const MANDATORY_SAFETY_QUESTIONS: string[] = [
  "Was zählt exakt als „keine aktive Zahlung“?",
  "Soll zuerst ein Dry Run / Preview erstellt werden?",
  "Welche Tabellen dürfen betroffen sein?",
  "Soll ein Backup/Export vor Löschung erstellt werden?",
  "Soll die Aktion batchweise laufen?",
  "Soll ein Audit Log erstellt werden?",
  "Wer darf diese Aktion auslösen?",
];

function normalizeText(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// True when `token` appears as a standalone word in already-lowercased text.
// German letters + the dot in "auth.users" are treated as word chars so the
// token isn't matched inside a larger word (avoids "db" hitting "feedback").
function wordPresent(lowerText: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![a-z0-9äöüß.])${esc}(?![a-z0-9äöüß])`, "i");
  return re.test(lowerText);
}

/** Deterministic destructive detection: hardcoded phrase OR (verb AND target). */
export function isTaskDestructive(text: string): boolean {
  const norm = normalizeText(text);
  if (!norm) return false;
  if (HARDCODED_BLOCK_PHRASES.some((p) => norm.includes(p))) return true;
  const hasVerb = DESTRUCTIVE_VERBS.some((v) => wordPresent(norm, v));
  const hasTarget = SENSITIVE_TARGETS.some((t) => wordPresent(norm, t));
  return hasVerb && hasTarget;
}

function dedupeQuestions(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of list) {
    const key = q.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q.trim());
  }
  return out;
}

// Phrases that mark a question as a DESTRUCTIVE safety question. On a
// non-destructive task these must never survive — the model sometimes echoes
// them from an old assistant message in the chat history. Matched as
// lowercase substrings (covers DE + EN wording from MANDATORY_SAFETY_QUESTIONS).
const DESTRUCTIVE_QUESTION_PHRASES: string[] = [
  "aktive zahlung",
  "dry run",
  "preview",
  "welche tabellen",
  "backup",
  "export vor löschung",
  "export vor loeschung",
  "batchweise",
  "audit log",
  "audit-log",
  "wer darf diese aktion auslösen",
  "wer darf diese aktion ausloesen",
  "no active payment",
  "backup before deletion",
  "affected tables",
  "which tables",
];

/** Remove destructive safety questions (used only when the task is NOT destructive). */
export function filterOutDestructiveSafetyQuestions(questions: string[]): string[] {
  return questions.filter((q) => {
    const lo = q.toLowerCase();
    return !DESTRUCTIVE_QUESTION_PHRASES.some((p) => lo.includes(p));
  });
}

/**
 * Final safety gate over the plan. Two directions, both deterministic and
 * independent of model variance:
 *
 *  - DESTRUCTIVE current-task context → force ready_to_build=false and ensure
 *    the mandatory safety questions are present (deduped).
 *  - NON-destructive context → STRIP any destructive safety questions the model
 *    may have echoed from old assistant/plan text. If stripping removed the only
 *    blockers, the task becomes ready again (waiting_for_start, no 🔒 message).
 *
 * `taskText` MUST be the current task's user-authored context only (title +
 * prompt + this task's user messages + queued notes) — see runDevCockpitAnalysis.
 */
export function enforceSafetyBlock(plan: BuildPlan, taskText: string): BuildPlan {
  if (isTaskDestructive(taskText)) {
    const questions = dedupeQuestions([...plan.questions, ...MANDATORY_SAFETY_QUESTIONS]);
    return { ...plan, questions, ready_to_build: false };
  }

  // Non-destructive: a destructive safety question here is a leak — strip it.
  const filtered = filterOutDestructiveSafetyQuestions(plan.questions);
  const removedSome = filtered.length !== plan.questions.length;
  // Readiness: if stripping emptied the blockers, it's ready. Only override the
  // model's `false` when we actually removed leaked safety questions.
  const ready_to_build =
    filtered.length === 0 ? (removedSome ? true : plan.ready_to_build) : false;
  return { ...plan, questions: filtered, ready_to_build };
}

/**
 * Internal self-test for the safety gate. Returns one row per case with the
 * expected vs actual block decision. Pure + side-effect free — call it from a
 * script or log it to verify the gate without a test runner.
 */
export function runSafetyGateSelfTest(): Array<{
  input: string;
  expectedBlocked: boolean;
  blocked: boolean;
  pass: boolean;
}> {
  const cases: Array<{ input: string; expectedBlocked: boolean }> = [
    { input: "Lösche alle Nutzer ohne aktive Zahlung aus der Datenbank", expectedBlocked: true },
    { input: "Delete all inactive users from the database", expectedBlocked: true },
    { input: "Füge einen Delete-Button für einzelne Notizen hinzu", expectedBlocked: false },
    // Roles/permissions task (user-authored) must NOT be flagged — "User" is a
    // target but there is no destructive verb. (The gate scopes to user input,
    // so a plan/assistant message mentioning "delete users" cannot trip it.)
    {
      input:
        "Baue ein Rollen- und Berechtigungssystem.\nNur zwei Rollen: Admin und User. Keine Editor/Viewer-Rollen. Admin darf alles im glev-ops Bereich, User darf nur normale App-Funktionen nutzen.",
      expectedBlocked: false,
    },
  ];
  return cases.map((c) => {
    const blocked = isTaskDestructive(c.input);
    return { input: c.input, expectedBlocked: c.expectedBlocked, blocked, pass: blocked === c.expectedBlocked };
  });
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
  // Dev Cockpit uses its own credential bucket (separate cost tracking).
  const client = getDevCockpitMistralClient();

  const startedAt = Date.now();
  let completion;
  try {
    completion = await client.chat.complete({
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
  } catch (e) {
    // Centralized usage logging tagged source="dev_cockpit" (no secrets/bodies).
    logAiUsage({
      source: "dev_cockpit",
      model: ANALYSIS_MODEL,
      operation: "analyze_task",
      ok: false,
      ms: Date.now() - startedAt,
    });
    throw e;
  }

  // Read usage defensively — exact field names vary across SDK versions, and we
  // never want a token-count read to break the build or the call.
  const usage = (completion?.usage ?? undefined) as unknown as
    | { promptTokens?: number; completionTokens?: number; totalTokens?: number }
    | undefined;
  logAiUsage({
    source: "dev_cockpit",
    model: ANALYSIS_MODEL,
    operation: "analyze_task",
    ok: true,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    ms: Date.now() - startedAt,
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
  // Hard safety gate — scope is the CURRENT task's USER-AUTHORED input ONLY:
  // title + prompt + this task's `user` messages + this task's queued notes.
  // We deliberately EXCLUDE assistant/system messages: those contain prior
  // analysis output (incl. previously-injected safety questions that mention
  // "Nutzer/Zahlung/Löschung", or a plan that legitimately discusses "delete
  // users"). Scanning them would self-trigger the gate on Re-Analyze and leak
  // safety questions into non-destructive tasks. Never scans other tasks.
  const userAuthoredText = [
    input.title,
    input.prompt,
    ...input.history.filter((h) => h.role === "user").map((h) => h.content),
    ...input.queuedNotes,
  ].join("\n");
  return enforceSafetyBlock(plan, userAuthoredText);
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

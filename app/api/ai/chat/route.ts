import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { authedClient, type AuthOk, type AuthErr } from "@/app/api/insulin/_helpers";
import { getMistralChatClient } from "@/lib/ai/openaiClient";
import { GLEV_CHAT_SYSTEM_PROMPT } from "@/lib/ai/glevChatPrompt";
import { errorResponse } from "@/lib/api/errorResponse";
import { getUserFriendlyMessage } from "@/lib/ai/errorMessages";
import {
  getSystemPromptCache,
  setSystemPromptCache,
} from "@/lib/ai/systemPromptCache";
import {
  GLEV_TOOLS,
  executeGlevTool,
  isPendingActionEnvelope,
  isDualPendingActionEnvelope,
  isNavigateEnvelope,
  isSetMacroEnvelope,
  isMealPrepEnvelope,
  nowIsoWithOffset,
} from "@/lib/ai/glevTools";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { callWithRetry, defaultGetRetryAfterSec } from "@/lib/ai/retryWithRateLimit";
import { computeEffectivePlan } from "@/lib/admin/effectivePlan";
import { canAccess } from "@/lib/planFeatures";
import { EngineTrace } from "@/lib/engine/trace";

// Maximum number of sequential tool-call rounds before we stop calling
// OpenAI with `tools` and force a streamed final answer. Two is enough
// for any realistic chain ("get glucose + IOB + last meal") while
// keeping a hard ceiling against accidental tool-loop runaways.
const MAX_TOOL_ROUNDS = 2;

// ── Timeout ───────────────────────────────────────────────────────────
// Hard ceiling for OpenAI round-trips inside the SSE stream.
// If the stream hasn't produced [DONE] within this window the handler
// emits a CHAT_TIMEOUT SSE error frame and closes the stream.
// Kept as a named constant so tests can override it via ChatDeps.timeoutMs.
const DEFAULT_TIMEOUT_MS = 18_000;

// ── 429 retry ─────────────────────────────────────────────────────────
// Server-side retry budget. If Retry-After would require waiting longer
// than this, we surface MISTRAL_RATE_LIMITED to the client immediately
// (let the client-side retry handle it) rather than burning Vercel
// function time that would hit the serverless limit.
// NOTE: error_code stays "MISTRAL_RATE_LIMITED" for client backward-compat;
// should be renamed to "PROVIDER_RATE_LIMITED" in a follow-up cleanup sprint.
const MAX_RETRY_WAIT_MS = 8_000;
const MAX_AI_RETRIES = 2;

/**
 * Thrown by `callOpenAIWithRetry` when all server-side retry attempts
 * are exhausted or the Retry-After delay exceeds MAX_RETRY_WAIT_MS.
 */
class OpenAIRateLimitError extends Error {
  readonly retry_after_sec: number;
  readonly attempts: number;

  constructor(retry_after_sec: number, attempts: number) {
    super("MISTRAL_RATE_LIMITED");
    this.name = "OpenAIRateLimitError";
    this.retry_after_sec = retry_after_sec;
    this.attempts = attempts;
  }
}

/**
 * Returns `true` when the caught error represents an OpenAI HTTP 429.
 * The OpenAI SDK surfaces rate-limits as APIStatusError with `status: 429`.
 */
function isOpenAI429Error(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return (
    err.status === 429 ||
    err.statusCode === 429 ||
    (typeof err.message === "string" && err.message.includes("429"))
  );
}

/**
 * Returns `true` when the caught error is an OpenAI 5xx server error
 * (overloaded, gateway timeout, internal server error, etc.).
 * These are transient — a single retry with a short delay recovers most cases.
 */
function isOpenAI5xxError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  const code = typeof err.status === "number" ? err.status
    : typeof err.statusCode === "number" ? err.statusCode
    : null;
  if (code !== null) return code >= 500 && code < 600;
  if (typeof err.message === "string") {
    return (
      err.message.includes("500") ||
      err.message.includes("502") ||
      err.message.includes("503") ||
      err.message.includes("504") ||
      err.message.toLowerCase().includes("internal server error") ||
      err.message.toLowerCase().includes("service unavailable") ||
      err.message.toLowerCase().includes("overloaded")
    );
  }
  return false;
}

/**
 * Wraps an OpenAI API call with up to `MAX_AI_RETRIES` server-side
 * retries on 429 responses. Backs off for the `Retry-After` duration
 * (default 5 s) between attempts.
 *
 * Throws `OpenAIRateLimitError` when:
 * - All retries are exhausted, OR
 * - The Retry-After delay would exceed `MAX_RETRY_WAIT_MS` (prefer
 *   surfacing a client-side retry over burning Vercel function time).
 *
 * All other errors propagate as-is.
 *
 * @param fn     - Factory that performs one OpenAI API call.
 * @param _sleep - Injectable sleep function for unit tests.
 */
export async function callOpenAIWithRetry<T>(
  fn: () => Promise<T>,
  _sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  return callWithRetry(fn, {
    is429: isOpenAI429Error,
    getRetryAfterSec: defaultGetRetryAfterSec,
    maxRetries: MAX_AI_RETRIES,
    maxRetryWaitMs: MAX_RETRY_WAIT_MS,
    makeRateLimitError: (retryAfterSec, attempts) =>
      new OpenAIRateLimitError(retryAfterSec, attempts),
    logPrefix: "[chat] OpenAI",
    is5xx: isOpenAI5xxError,
    max5xxRetries: 1,
    retry5xxDelayMs: 1_500,
  }, _sleep);
}

/**
 * POST /api/ai/chat
 *
 * Streaming SSE endpoint that powers the Glev AI chat sheet (Phase 2).
 * The response body is `text/event-stream` with one `data: <token>` line
 * per OpenAI chunk and a final `data: [DONE]` sentinel — matching the
 * pattern most JS SSE consumers expect.
 *
 * Gates (in order):
 *   1. 401 — no authed user.
 *   2. 403 — user has not granted AI consent (`profiles.ai_consent_at`
 *      is null).
 *   3. 429 — more than RATE_LIMIT_MAX requests per
 *      RATE_LIMIT_WINDOW_MS for this user id.
 *   4. 503 — MISTRAL_API_KEY missing.
 *   5. 400 — body shape invalid.
 *
 * `contextSnapshot` is a deliberately small structured preamble
 * (glucose / IOB / last meal summary). Phase 2 ships with dummy values
 * when the live data isn't wired yet; a follow-up task will fill them
 * from the real CGM/IOB/meal sources.
 */

// ── Rate limit ────────────────────────────────────────────────────────
// Shared, persistent rolling window. Stored in Supabase
// (`public.ai_rate_limit_hits`) via the service-role client so the cap
// is enforced across all serverless function instances and survives
// cold starts — see migration 20260523_ai_rate_limit_hits.sql.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Returns `true` if the user has already reached RATE_LIMIT_MAX hits
 *  in the last RATE_LIMIT_WINDOW_MS. Fails open on DB errors. */
async function isRateLimited(userId: string): Promise<boolean> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return false;
  }

  const cutoffIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  const { count, error: countErr } = await admin
    .from("ai_rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("hit_at", cutoffIso);

  if (countErr) return false;
  return (count ?? 0) >= RATE_LIMIT_MAX;
}

/** Records one rate-limit hit for the user. Fails open on DB errors.
 *  Also opportunistically prunes stale rows for this user. */
async function addRateLimitHit(userId: string): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return;
  }

  const now = Date.now();
  const cutoffIso = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();

  await admin
    .from("ai_rate_limit_hits")
    .insert({ user_id: userId, hit_at: new Date(now).toISOString() });

  void admin
    .from("ai_rate_limit_hits")
    .delete()
    .eq("user_id", userId)
    .lt("hit_at", cutoffIso);
}

// ── Body shape ────────────────────────────────────────────────────────
type ChatMessage = { role: "user" | "assistant"; content: string };
type ContextSnapshot = {
  screen?: string;
  glucoseSummary: string;
  iobSummary: string;
  lastMealDescription: string;
};
export type ChatAttachment = {
  url: string;
  mimeType: string;
  fileName: string;
};
type ChatBody = {
  message: string;
  conversationId?: string;
  history?: ChatMessage[];
  contextSnapshot: ContextSnapshot;
  // IANA-Zeitzone des Geräts (z. B. "Europe/Berlin"). Wird vom Client
  // bei jeder Anfrage frisch aus Intl.DateTimeFormat ermittelt und
  // unten an die Tools durchgereicht. Optional/null → Server-Default
  // Europe/Berlin.
  timezone?: string | null;
  locale?: string;
  /** Optional file attachments uploaded via /api/ai/upload.
   *  Images → pixtral-12b-2409 (vision) in Phase 1.
   *  PDFs   → text prepended to message, then mistral-large-latest. */
  attachments?: ChatAttachment[];
};

function validateBody(b: unknown): { ok: true; body: ChatBody } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "body must be an object" };
  const o = b as Record<string, unknown>;
  // Allow empty message when attachments are present (image-only send)
  const hasAttachments = Array.isArray(o.attachments) && (o.attachments as unknown[]).length > 0;
  if ((typeof o.message !== "string" || !o.message.trim()) && !hasAttachments) {
    return { ok: false, error: "message is required" };
  }
  const ctx = o.contextSnapshot as Record<string, unknown> | undefined;
  if (
    !ctx ||
    typeof ctx.glucoseSummary !== "string" ||
    typeof ctx.iobSummary !== "string" ||
    typeof ctx.lastMealDescription !== "string"
  ) {
    return { ok: false, error: "contextSnapshot.{glucoseSummary,iobSummary,lastMealDescription} are required strings" };
  }
  const history = Array.isArray(o.history)
    ? (o.history as unknown[])
        .filter((m): m is ChatMessage => {
          if (!m || typeof m !== "object") return false;
          const mm = m as Record<string, unknown>;
          return (
            (mm.role === "user" || mm.role === "assistant") &&
            typeof mm.content === "string"
          );
        })
        .slice(-10)
    : [];
  const attachments: ChatAttachment[] = hasAttachments
    ? (o.attachments as unknown[])
        .filter((a): a is ChatAttachment => {
          if (!a || typeof a !== "object") return false;
          const aa = a as Record<string, unknown>;
          return typeof aa.url === "string" && typeof aa.mimeType === "string" && typeof aa.fileName === "string";
        })
        .slice(0, 3)
    : [];
  return {
    ok: true,
    body: {
      message: typeof o.message === "string" ? o.message : "",
      conversationId: typeof o.conversationId === "string" ? o.conversationId : undefined,
      history,
      contextSnapshot: {
        screen: typeof ctx.screen === "string" ? ctx.screen : undefined,
        glucoseSummary: ctx.glucoseSummary,
        iobSummary: ctx.iobSummary,
        lastMealDescription: ctx.lastMealDescription,
      },
      timezone:
        typeof o.timezone === "string" && o.timezone.trim().length > 0
          ? o.timezone.trim()
          : null,
      locale: typeof o.locale === "string" ? o.locale.trim() || undefined : undefined,
      attachments,
    },
  };
}

type ContextScopes = { glucose: boolean; iob: boolean; history: boolean };

/**
 * Builds the system preamble that ships the user's live snapshot to
 * OpenAI. Each line is gated by the matching granular consent scope
 * (Task #664). `lastMealDescription` is always included as long as the
 * master consent is set — it is the floor of the AI feature and not
 * separately toggleable. Lines that are gated off are omitted entirely
 * (we don't ship redacted placeholders to avoid confusing the model
 * with explicit absence claims).
 */
function contextPreamble(
  ctx: ContextSnapshot,
  scopes: ContextScopes,
  timezone: string | null,
  locale?: string,
): string {
  const todayLocalDate = todayInTimezone(timezone);
  const nowIso = nowIsoWithOffset(timezone);
  const nowTime = nowIso.slice(11, 16);
  const en = locale === "en";

  const lines: string[] = [
    ...(locale && locale !== "de"
      ? [`UI language: ${locale}. IMPORTANT: Respond to the user ONLY in English. Use English for ALL text in your response, pending_action labels, descriptions, and confirmations. Never switch to German.`]
      : []),
    en
      ? `Today is ${todayLocalDate} (user's local timezone; for add_appointment convert relative terms like "next week" to absolute dates).`
      : `Heute ist ${todayLocalDate} (Datum in der lokalen Zeitzone des Nutzers; für add_appointment relative Angaben wie „nächste Woche" auf das absolute Datum umrechnen).`,
    en
      ? `Current time: ${nowTime} (local). Now: ${nowIso} — use this ISO-8601 string with offset as the template for logged_at. Examples: "20 minutes ago" → time − 20 min, keep offset. "around 4:02 PM" or "at 2:30" → today's date + stated time + same offset (e.g. ${nowIso.slice(0, 11)}16:02:00${nowIso.slice(19)}). ALWAYS set logged_at when a time is explicitly stated.`
      : `Aktuelle Uhrzeit: ${nowTime} Uhr (Lokalzeit). Jetzt: ${nowIso} — nutze diesen ISO-8601-String mit Offset als Vorlage für logged_at. Beispiele: „vor 20 Minuten" → Uhrzeit − 20 Min, Offset beibehalten. „gegen 16:02 Uhr" oder „um 14:30" → heutiges Datum + genannte Uhrzeit + gleicher Offset (z. B. ${nowIso.slice(0, 11)}16:02:00${nowIso.slice(19)}). Bei explizit genannten Uhrzeiten IMMER logged_at setzen.`,
    en
      ? "User context snapshot (may be stale or placeholder — if unclear, phrase cautiously):"
      : "Kontext-Snapshot des Nutzers (kann veraltet oder Platzhalter sein — wenn unklar, vorsichtig formulieren):",
  ];
  if (ctx.screen) lines.push(`- Screen: ${ctx.screen}`);
  if (scopes.glucose) lines.push(en ? `- Glucose: ${ctx.glucoseSummary}` : `- Glukose: ${ctx.glucoseSummary}`);
  if (scopes.iob)     lines.push(`- IOB:     ${ctx.iobSummary}`);
  lines.push(en ? `- Last meal: ${ctx.lastMealDescription}` : `- Letzte Mahlzeit: ${ctx.lastMealDescription}`);
  return lines.join("\n");
}

/**
 * Computes today's date in YYYY-MM-DD form for the user's timezone.
 * `en-CA` is the canonical locale that produces ISO calendar dates.
 */
function todayInTimezone(timezone: string | null): string {
  const tz = timezone ?? "Europe/Berlin";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}


// Hard cap auf die Anzahl Memory-Einträge, die in den System-Prompt
// injiziert werden. Bei ~500 Zeichen pro Value + key + Bullet-Padding
// wären 50 Einträge ≲ 28 KB — deutlich unter dem Kontext-Limit, lässt
// aber genug Spielraum für History, Tool-Calls und die eigentliche
// Antwort. Größere Caps brauchen erst eine Embedding-/Retrieval-Schicht
// (siehe „Out of scope" in Task #663).
const MAX_MEMORY_ENTRIES = 50;

/**
 * Lädt die persistenten User-Memory-Einträge des aktuellen Nutzers und
 * formatiert sie als injektionsfertigen System-Prompt-Block. Gibt
 * `null` zurück, wenn keine Einträge existieren — der Aufrufer soll
 * dann gar keine zusätzliche System-Message anhängen (kein leerer
 * Header, der den Agenten verwirren könnte).
 *
 * Fehler (Tabelle fehlt nach Migration-Lag, RLS-Hiccup, …) werden
 * still geschluckt: ein nicht-ladbares Memory darf den Chat nicht
 * blockieren. Der Agent verhält sich dann genauso wie bei einem
 * neuen User mit leerem Memory.
 */
async function loadUserMemoryBlock(
  sb: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("ai_user_memory")
    .select("key, value, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_MEMORY_ENTRIES);

  if (error || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  const lines = (data as Array<{ key?: unknown; value?: unknown }>)
    .map((row) => {
      const k = typeof row.key === "string" ? row.key.trim() : "";
      const v = typeof row.value === "string" ? row.value.trim() : "";
      if (!k || !v) return null;
      return `- ${k}: ${v}`;
    })
    .filter((l): l is string => l !== null);

  if (lines.length === 0) return null;
  return ["Was du über diesen User weißt:", ...lines].join("\n");
}

/**
 * Strips system-prompt echoes from assistant history before sending to OpenAI.
 * Prevents the feedback loop: model echoes prompt → echo lands in history →
 * model echoes it again next turn.
 *
 * Strategy: if the assistant turn contains unique system-prompt fingerprints
 * that never appear in legitimate replies, replace the content with a neutral
 * placeholder so OpenAI doesn't treat the echo as a learned pattern.
 */
const HISTORY_FINGERPRINTS = [
  "strikte grenzen (niemals brechen)",
  "ict (pen-therapie)",
  "gewohnheits- und musterfragen",
  "kontext-snapshot des nutzers",
  "awaiting_user_confirmation",
  "only_one_write_action_per_turn",
  "pen-therapie)",
  "deine aufgabe:",
  "read-tools (lesen):",
  "write-tools (schlagen",
];

function sanitizeHistoryContent(content: string): string {
  if (!content || !content.trim()) {
    // OpenAI rejects assistant messages with empty content and no tool_calls.
    // This happens when a prior turn failed before streaming any
    // tokens and the client replays the empty turn in history.
    return "[Antwort nicht verfügbar]";
  }
  const lower = content.toLowerCase();
  if (HISTORY_FINGERPRINTS.some((f) => lower.includes(f))) {
    return "[Antwort wurde intern bereinigt]";
  }
  return content;
}

/**
 * Loads the active system prompt from `ai_agent_prompts` (key = 'glev_ai_default').
 * Falls back to the hardcoded GLEV_CHAT_SYSTEM_PROMPT if the table has no entry,
 * the entry is empty, or the DB call fails. Never throws — the chat must keep
 * working even when the admin table is unreachable.
 */
async function loadActiveSystemPrompt(): Promise<string> {
  const cached = getSystemPromptCache();
  if (cached !== null) {
    return cached;
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return GLEV_CHAT_SYSTEM_PROMPT;
  }
  try {
    const { data } = await admin
      .from("ai_agent_prompts")
      .select("prompt_text")
      .eq("key", "glev_ai_default")
      .eq("is_active", true)
      .maybeSingle();
    const prompt =
      data?.prompt_text && data.prompt_text.trim().length > 0
        ? data.prompt_text.trim()
        : GLEV_CHAT_SYSTEM_PROMPT;
    setSystemPromptCache(prompt);
    return prompt;
  } catch {
    // Fail open — return the hardcoded default below (do not cache on error).
  }
  return GLEV_CHAT_SYSTEM_PROMPT;
}

/**
 * Checks whether the user is allowed to use Glev AI.
 *
 * Access is granted when EITHER:
 *   1. Admin has set ai_voice = true in user_settings.feature_flags
 *      (Friends & Family / beta-tester override)
 *   2. User has Glev Smart, Pro, or Plus subscription (plan-gated)
 *
 * Returns a 403 NextResponse when neither condition is met, null otherwise.
 * Exported for unit testing (dependency-injection of the Supabase client).
 */
export async function checkChatFlag(
  sb: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  // Parallel: feature-flag + profile plan check
  const [settingsResult, profileResult] = await Promise.all([
    sb.from("user_settings").select("feature_flags").eq("user_id", userId).maybeSingle(),
    sb.from("profiles").select("manual_plan_override, manual_plan_expires_at, plan, trial_end_at").eq("user_id", userId).maybeSingle(),
  ]);

  const featureFlags = (settingsResult.data?.feature_flags ?? {}) as Record<string, unknown>;
  if (featureFlags.ai_voice === true) return null; // admin override → allow

  const p = profileResult.data;
  const trialActive = p?.trial_end_at ? Date.parse(p.trial_end_at) > Date.now() : false;
  const effectivePlan = computeEffectivePlan({
    manual_plan_override: p?.manual_plan_override ?? null,
    manual_plan_expires_at: p?.manual_plan_expires_at ?? null,
    plan: p?.plan ?? null,
  });

  if (canAccess("glev_ai", effectivePlan, trialActive)) return null;

  return errorResponse("PERMISSION_DENIED", 403);
}

/**
 * Injectable dependencies for `handleChatPost`. All fields are optional —
 * omitting them falls back to the real production implementations so that
 * the exported `POST` handler needs no changes at the call site.
 *
 * - `auth`: pre-resolved auth result. When omitted `handleChatPost` calls
 *   `authedClient(req)` itself (production path).
 * - `getOpenAI`: factory that returns an OpenAI client. When omitted the
 *   real `getMistralChatClient()` is used. Tests can pass a spy here to assert
 *   that no OpenAI call occurs when the feature-flag gate blocks early.
 * - `timeoutMs`: stream timeout in milliseconds. Defaults to 18 000. Tests
 *   can lower this to make timeout scenarios fast.
 * - `sleep`: injectable sleep for 429-retry back-off. Defaults to real
 *   `setTimeout`. Tests can pass a no-op to skip the actual wait.
 */
export type ChatDeps = {
  auth?: AuthOk | AuthErr;
  getOpenAI?: () => OpenAI;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Core POST handler extracted from the Next.js route export so it can be
 * called directly in unit tests with injectable dependencies.
 *
 * The exported `POST` function is a thin wrapper that calls this with the
 * real authedClient result and no OpenAI override.
 */
export async function handleChatPost(
  req: NextRequest,
  deps: ChatDeps = {},
): Promise<NextResponse | Response> {
  // 1. Auth
  const auth = deps.auth ?? await authedClient(req);
  if (!auth.user || !auth.sb) {
    return errorResponse("AUTH_ERROR", 401);
  }
  const { user, sb } = auth;

  // 1a. Feature-flag guard — ai_voice must be enabled for the user
  const flagBlock = await checkChatFlag(sb, user.id);
  if (flagBlock) return flagBlock;

  // 2. Consent — master flag + granular sub-scopes (Task #664). The
  // sub-scope timestamps gate which fields end up in the contextPreamble
  // below; a missing (null) timestamp means "do not pass this data type
  // to the model". `lastMealDescription` has no toggle — it is the
  // sockel of the master consent (see DECISIONS.md D-016).
  const { data: profile, error: profErr } = await sb
    .from("profiles")
    .select("ai_consent_at, ai_consent_glucose_at, ai_consent_iob_at, ai_consent_history_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profErr) {
    console.error("[chat]", { code: "UPSTREAM_ERROR", cause: profErr.message });
    return errorResponse("UPSTREAM_ERROR", 500);
  }
  if (!profile?.ai_consent_at) {
    return errorResponse("PERMISSION_DENIED", 403);
  }
  const scopes: ContextScopes = {
    glucose: Boolean(profile?.ai_consent_glucose_at),
    iob:     Boolean(profile?.ai_consent_iob_at),
    history: Boolean(profile?.ai_consent_history_at),
  };

  // 3. Rate limit — one hit per user-initiated message, recorded before
  //    any OpenAI calls so tool-round retries don't count separately.
  if (await isRateLimited(user.id)) {
    console.error("[chat]", { code: "MISTRAL_RATE_LIMITED", userId: user.id });
    return errorResponse("MISTRAL_RATE_LIMITED", 429);
  }
  await addRateLimitHit(user.id);

  // 4. Body
  const raw = await req.json().catch(() => null);
  const v = validateBody(raw);
  if (!v.ok) {
    console.error("[chat]", { code: "PARSE_FAILED", cause: v.error });
    return errorResponse("PARSE_FAILED", 400);
  }
  const { message, history, contextSnapshot } = v.body;
  const timezone: string | null = v.body.timezone ?? null;
  const locale: string = (typeof v.body.locale === "string" && v.body.locale.trim().length > 0)
    ? v.body.locale.trim()
    : "de";
  const attachments: ChatAttachment[] = v.body.attachments ?? [];

  // 5. Mistral client (via OpenAI-compat SDK)
  const _getOpenAI = deps.getOpenAI ?? getMistralChatClient;
  let client;
  try {
    client = _getOpenAI();
  } catch (e) {
    console.error("[chat]", { code: "UPSTREAM_ERROR", cause: e instanceof Error ? e.message : String(e) });
    return errorResponse("UPSTREAM_ERROR", 503);
  }

  // Compose messages: system + context preamble + last-10 history + new turn.
  // Typed loosely as `any[]` because the OpenAI SDK's message-union type
  // is awkward to reproduce inline (tool replies vs assistant tool_calls
  // vs plain user/assistant turns) and we treat the array as an opaque
  // protocol buffer that only OpenAI itself needs to validate.
  // Memory-Block (persistente User-Beobachtungen) wird nur dann als
  // System-Message angehängt, wenn es tatsächlich Einträge gibt. Kein
  // leerer „Was du über diesen User weißt:"-Header — das würde den
  // Agenten ohne echten Inhalt nur verwirren.
  const [memoryBlock, activeSystemPrompt] = await Promise.all([
    loadUserMemoryBlock(sb, user.id),
    loadActiveSystemPrompt(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: activeSystemPrompt },
    ...(memoryBlock ? [{ role: "system", content: memoryBlock }] : []),
    {
      role: "system",
      content: contextPreamble(
        contextSnapshot,
        scopes,
        timezone,
        locale,
      ),
    },
    ...(history ?? []).map((m) => ({
      role: m.role,
      content: m.role === "assistant" ? sanitizeHistoryContent(m.content) : m.content,
    })),
    { role: "user", content: message },
  ];

  // 6. Tool-call loop + final stream.
  //
  // OpenAI's tool-calling protocol is two-phase: first a non-streaming
  // `chat.completions.create` with `tools` lets the model emit `tool_calls`;
  // we execute them server-side, append the results as `role: "tool"`
  // messages, and re-call. Once the model returns text-only (no more
  // tool_calls) — or we hit MAX_TOOL_ROUNDS — we switch to
  // streaming for the final, user-visible answer.
  //
  // This keeps the streaming UX intact (tokens still arrive live) while
  // adding the read-only tool layer (Phase 3 / Task 1). Write-tools
  // come in Task 2 behind a UI-confirmation gate.

  // Hoist attachment filters so both Phase 1 (tool-call round) and Phase 2
  // (streaming) share the same references without re-computing.
  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const pdfAttachments   = attachments.filter((a) => a.mimeType === "application/pdf");
  const hasImages = imageAttachments.length > 0;

  // photo_analysis trace — created when images are present; persisted
  // fire-and-forget after the stream completes via after().
  let photoTrace: EngineTrace | null = null;
  let photoAdminSb: ReturnType<typeof getSupabaseAdmin> | null = null;
  if (hasImages) {
    try { photoAdminSb = getSupabaseAdmin(); } catch { /* no-op */ }
    if (photoAdminSb) {
      photoTrace = new EngineTrace("photo_analysis", {
        image_count:        imageAttachments.length,
        image_bytes_sizes:  imageAttachments.map((a) => a.url.length), // url length as proxy; real size unknown here
        mime_types:         imageAttachments.map((a) => a.mimeType),
      });
    }
  }

  // Pre-Phase-1: attach images to the last user message NOW so pixtral-12b-2409
  // can see the food photo in the tool-call round and
  // fire log_meal_entry.  Without this, images were only appended in Phase 2
  // where tools are not available — so the model described the food in text
  // instead of logging it.
  if (hasImages) {
    const lastUserIdx = messages.length - 1;
    if (messages[lastUserIdx]?.role === "user" && typeof messages[lastUserIdx].content === "string") {
      const textContent = messages[lastUserIdx].content as string;
      messages[lastUserIdx] = {
        role: "user",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [
          { type: "text", text: textContent },
          ...imageAttachments.map((a) => ({
            type: "image_url" as const,
            image_url: { url: a.url },
          })),
        ] as any,
      };
    }
  }

  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const _sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => controller.enqueue(encoder.encode(`data: ${line}\n\n`));

      // Timeout guard — if the full stream hasn't completed within
      // `timeoutMs`, emit a CHAT_TIMEOUT SSE frame and close the stream.
      // We keep a `closed` flag to avoid double-close races when the
      // timeout fires at the same moment as normal completion.
      let closed = false;
      const safeClose = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const startMs = Date.now();
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        if (closed) return;
        timedOut = true;
        const duration_ms = Date.now() - startMs;
        console.warn("[chat] timeout exceeded", { duration_ms });
        try {
          send(JSON.stringify({
            error_code: "CHAT_TIMEOUT",
            user_message: getUserFriendlyMessage("CHAT_TIMEOUT", "de"),
            retry_allowed: true,
          }));
          send("[DONE]");
          safeClose();
        } catch {
          /* controller already closed */
        }
      }, timeoutMs);

      try {
        // ── Feedback Direct-Save Guard ────────────────────────────────
        // When the user's message clearly describes a bug, problem or
        // feature wish, call submit_structured_feedback DIRECTLY —
        // without relying on the model's tool-choice mechanism (which
        // proved unreliable in the Mistral era: toolChoice object format
        // was silently ignored, causing the model to respond with text
        // like "Das Team schaut sich das an." without saving anything).
        //
        // Strategy: keyword detection (problem + app signal) → build
        // args locally → executeGlevTool → append synthetic assistant
        // + tool messages → OpenAI streaming phase sees the saved
        // state and generates a proper confirmation.
        const userMsgLower = message.toLowerCase();
        const FEEDBACK_PROBLEM_SIGNALS = [
          "stört", "stören", "nervt", "nervt mich", "buggy", "bug",
          "fehler", "kaputt", "geht nicht", "klappt nicht", "funktioniert nicht",
          "nicht richtig", "nicht korrekt", "falsch", "falsche", "falsches",
          "lücke", "abstand", "versatz", "hängt", "hängt sich", "abstürzt",
          "absturz", "crash", "bitte fix", "please fix", "wünsche mir",
          "würde ich mir", "würde mir wünschen", "feature request",
          "sieht.*aus", "scheiße", "mist", "doof", "nervig",
        ];
        const FEEDBACK_APP_SIGNALS = [
          "seite", "screen", "button", "tab", "dashboard", "engine",
          "einstellungen", "settings", "overlay", "modal", "ansicht",
          "navigation", "glev", "app", "fenster", "bildschirm",
          "header", "footer", "kante", "rand", "abstand",
        ];
        const hasProblemSignal = FEEDBACK_PROBLEM_SIGNALS.some(
          (s) => userMsgLower.includes(s),
        );
        const hasAppSignal = FEEDBACK_APP_SIGNALS.some(
          (s) => userMsgLower.includes(s),
        );

        if (hasProblemSignal && hasAppSignal) {
          // Build args from the user message directly.
          const trimmed = message.trim();
          const autoCategory =
            /wünsche|würde.*mir|feature/i.test(trimmed) ? "feature_request" :
            /lob|super|toll|gefällt|danke/i.test(trimmed) ? "praise" :
            "bug";
          const autoArgs = JSON.stringify({
            what_noticed: trimmed.slice(0, 600),
            where_noticed: null,
            category: autoCategory,
            severity: "medium",
            free_text: trimmed.slice(0, 300),
            ai_summary: trimmed.slice(0, 120) + (trimmed.length > 120 ? "…" : ""),
          });

          const feedbackResult = await executeGlevTool(
            "submit_structured_feedback",
            autoArgs,
            sb,
            user.id,
            timezone,
          );

          // Append synthetic assistant + tool messages so the streaming
          // phase sees the saved state and confirms naturally.
          const syntheticId = `fb_auto_${Date.now()}`;
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: [{
              id: syntheticId,
              type: "function",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              function: { name: "submit_structured_feedback", arguments: autoArgs } as any,
            }],
          });
          messages.push({
            role: "tool",
            tool_call_id: syntheticId,
            content: JSON.stringify(feedbackResult),
          });

          console.log("[chat] feedback direct-save:", JSON.stringify(feedbackResult).slice(0, 120));
        }

        // ── Phase 1: resolve any tool calls ─────────────────────────
        // Tracks whether a dual-emission (log_meal_entry with alcohol items) has
        // already fired for this request. If yes, any subsequent explicit
        // log_influence_entry(alcohol) call is a duplicate — the model got
        // confused and called both. We reject the duplicate with a stub so no
        // second influence card appears in the UI.
        let alcoholDualEmittedThisRequest = false;
        let mealPrepEmittedThisRequest = false;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (timedOut || closed) return;

          const pixtralT0 = Date.now();
          const completion = await callOpenAIWithRetry(
            () => client.chat.completions.create({
              model: hasImages ? "pixtral-12b-2409" : "mistral-large-latest",
              max_tokens: 300,
              temperature: 0.4,
              messages,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: GLEV_TOOLS as any,
              tool_choice: "auto",
              stream: false,
            }),
            _sleep,
          );

          if (timedOut || closed) return;

          const choice = completion?.choices?.[0];
          const toolCalls = choice?.message?.tool_calls ?? [];

          // photo_analysis step: capture pixtral call result on round 0
          if (hasImages && photoTrace && round === 0) {
            photoTrace.recordStep("pixtral_call", {
              success:    true,
              latency_ms: Date.now() - pixtralT0,
              detail: {
                model:           "pixtral-12b-2409",
                tool_calls_count: toolCalls.length,
                tool_names:      toolCalls.map((c) => 'function' in c ? c.function?.name : undefined).filter(Boolean),
              },
            });
          }
          if (!toolCalls.length) {
            // ── Feedback Guard (response-side) ────────────────────────
            // OpenAI responded with text but no tool call. If the text
            // looks like a feedback forwarding phrase AND no feedback was
            // already saved by the pre-call direct-save guard above,
            // save it directly here too — no second OpenAI round needed.
            if (round === 0) {
              const responseText =
                typeof choice?.message?.content === "string"
                  ? choice.message.content.toLowerCase()
                  : "";
              const looksLikeFeedbackConfirmation = [
                /leite.*weiter/, /weitergeleitet/, /werde.*weiterleiten/,
                /gebe.*weiter/, /werde.*weitergeben/,
                /an das team/, /feedback.*team/, /team.*kümmert/,
                /team.*schaut/, /schaut.*das.*an/, /schaut.*sich.*an/,
                /nehme.*auf/, /nehme.*mit/, /notiert/, /habe.*notiert/,
                /werde.*notieren/, /merke.*vor/, /merke.*das.*vor/,
                /kümmert.*sich/, /kümmern.*uns/,
              ].some((p) => p.test(responseText));

              // Only save if the direct-save guard above did NOT already
              // save (i.e. the message didn't match the keyword heuristic).
              const alreadySaved = messages.some(
                (m) =>
                  m.role === "tool" &&
                  (m as { name?: string }).name === "submit_structured_feedback",
              );

              if (looksLikeFeedbackConfirmation && !alreadySaved) {
                const trimmed = message.trim();
                const autoCategory =
                  /wünsche|würde.*mir|feature/i.test(trimmed) ? "feature_request" :
                  /lob|super|toll|gefällt|danke/i.test(trimmed) ? "praise" :
                  "bug";
                const autoArgs = JSON.stringify({
                  what_noticed: trimmed.slice(0, 600),
                  where_noticed: null,
                  category: autoCategory,
                  severity: "medium",
                  free_text: trimmed.slice(0, 300),
                  ai_summary: trimmed.slice(0, 120) + (trimmed.length > 120 ? "…" : ""),
                });
                const guardResult = await executeGlevTool(
                  "submit_structured_feedback",
                  autoArgs,
                  sb,
                  user.id,
                  timezone,
                );
                const guardId = `fb_guard_${Date.now()}`;
                messages.push({
                  role: "assistant",
                  content: "",
                  tool_calls: [{
                    id: guardId,
                    type: "function",
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    function: { name: "submit_structured_feedback", arguments: autoArgs } as any,
                  }],
                });
                messages.push({
                  role: "tool",
                  tool_call_id: guardId,
                  content: JSON.stringify(guardResult),
                });
                console.log("[chat] feedback response-guard save:", JSON.stringify(guardResult).slice(0, 120));
              }
            }
            // ─────────────────────────────────────────────────────────
            break;
          }

          // Append the assistant turn that requested the tool calls,
          // then run each tool and append its result. The SDK requires
          // the assistant message to be present before the tool reply.
          messages.push({
            role: "assistant",
            content: choice?.message?.content ?? "",
            tool_calls: toolCalls,
          });

          // Hard cap: maximal EINE pending WRITE-Aktion pro Assistant-
          // Turn. Würde das Modell zwei Mal in einer Runde z. B.
          // log_meal_entry + log_bolus_entry rufen, würde die UI nur
          // die letzte pending_action sehen (eine PendingAction pro
          // Bubble in `useGlevAI`). Statt das clientseitig zu lösen
          // brechen wir hier server-seitig ab: erste WRITE wird normal
          // bearbeitet, jede weitere WRITE-Tool-Call der gleichen Runde
          // wird dem Modell als „rejected: only one write per turn" zurück-
          // gegeben — damit kann das Modell entweder im Text drauf
          // hinweisen oder im nächsten Turn nachziehen.
          let pendingEmittedThisRound = false; // still tracks state for the model stub note
          for (const call of toolCalls) {
            if (call.type !== "function") continue;
            const fn = call.function;
            const rawArgs =
              typeof fn?.arguments === "string"
                ? fn.arguments
                : JSON.stringify(fn?.arguments ?? {});

            // ── Duplicate alcohol-influence guard ─────────────────────
            // If log_meal_entry already triggered dual-emission (alcohol
            // influence included automatically), and the model now also
            // calls log_influence_entry(alcohol) explicitly, block it so
            // only ONE influence card appears in the UI.
            if (fn?.name === "log_influence_entry" && alcoholDualEmittedThisRequest) {
              let parsedInflArgs: Record<string, unknown> = {};
              try { parsedInflArgs = JSON.parse(rawArgs); } catch { /* ignore */ }
              if (parsedInflArgs.influence_type === "alcohol") {
                console.log("[chat] suppressed duplicate log_influence_entry(alcohol) — dual-emission already fired");
                messages.push({
                  role: "tool",
                  tool_call_id: call.id,
                  content: JSON.stringify({
                    status: "skipped",
                    reason: "Alkohol-Einflussfaktor wurde bereits automatisch zusammen mit der Mahlzeit erstellt (Dual-Emission). Kein zweiter Eintrag nötig.",
                  }),
                });
                continue;
              }
            }

            const result = await executeGlevTool(
              fn?.name ?? "",
              rawArgs,
              sb,
              user.id,
              timezone,
            );

            // WRITE-tools return a `pending_action` envelope instead of
            // doing the insert. Forward the envelope to the UI on a
            // dedicated SSE frame, and give OpenAI a short "awaiting
            // user confirmation" stub so it doesn't try to confirm
            // itself or chain more writes in the same round.
            if (isDualPendingActionEnvelope(result)) {
              // Dual-Emission: meal + alcohol influence.
              // Emit meal_prep frame first (for sessionStorage pre-fill),
              // then both pending_actions so the client renders two chips.
              pendingEmittedThisRound = true;
              alcoholDualEmittedThisRequest = true; // block any subsequent log_influence_entry(alcohol)
              mealPrepEmittedThisRequest = true;
              const [mealAction, inflAction] = result.dual_pending_actions;
              const mp = mealAction.payload as Record<string, unknown> | undefined;
              if (mp) {
                send(JSON.stringify({
                  meal_prep: {
                    input_text: typeof mp.input_text === "string" ? mp.input_text : "",
                    carbs:   typeof mp.carbs_grams   === "number" ? mp.carbs_grams   : 0,
                    protein: typeof mp.protein_grams === "number" ? mp.protein_grams : null,
                    fat:     typeof mp.fat_grams     === "number" ? mp.fat_grams     : null,
                    fiber:   typeof mp.fiber_grams   === "number" ? mp.fiber_grams   : null,
                    ...(typeof mp.nutritionSource === "string" ? { nutritionSource: mp.nutritionSource } : {}),
                    ...(mp.meal_time_explicit === true && typeof mp.logged_at === "string" && mp.logged_at ? { meal_time: mp.logged_at } : {}),
                  },
                }));
              }
              send(JSON.stringify({ pending_action: mealAction }));
              send(JSON.stringify({ pending_action: inflAction }));
              if (result.backgroundTask) after(result.backgroundTask);
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({
                  status: "awaiting_user_confirmation",
                  kind: "log_meal_entry+log_influence_entry",
                  note: "Chip erscheint automatisch. Kein weiterer Text nötig.",
                }),
              });
            } else if (isPendingActionEnvelope(result)) {
              pendingEmittedThisRound = true;
              if (result.pending_action.kind === "log_meal_entry") mealPrepEmittedThisRequest = true;
              // For log_meal_entry: emit meal_prep BEFORE pending_action so the
              // client can queue the macro data and associate the token when
              // pending_action arrives (useGlevAI assigns token to the last
              // queued meal item — ordering matters).
              if (
                result.pending_action.kind === "log_meal_entry" &&
                result.pending_action.payload
              ) {
                const p = result.pending_action.payload as Record<string, unknown>;
                send(
                  JSON.stringify({
                    meal_prep: {
                      input_text: typeof p.input_text === "string" ? p.input_text : "",
                      carbs: typeof p.carbs_grams === "number" ? p.carbs_grams : 0,
                      protein: typeof p.protein_grams === "number" ? p.protein_grams : null,
                      fat: typeof p.fat_grams === "number" ? p.fat_grams : null,
                      fiber: typeof p.fiber_grams === "number" ? p.fiber_grams : null,
                      ...(typeof p.nutritionSource === "string" ? { nutritionSource: p.nutritionSource } : {}),
                      ...(p.meal_time_explicit === true && typeof p.logged_at === "string" && p.logged_at ? { meal_time: p.logged_at } : {}),
                    },
                  }),
                );
              }
              send(JSON.stringify({ pending_action: result.pending_action }));
              if (result.backgroundTask) after(result.backgroundTask);
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({
                  status: "awaiting_user_confirmation",
                  kind: result.pending_action.kind,
                  summary: result.pending_action.summary,
                  note: result.pending_action.kind === "log_meal_entry"
                    ? "Chip erscheint automatisch. Kein weiterer Text nötig."
                    : "Bestätigung erfolgt durch UI-Button. Antworte mit EINEM kurzen Satz, der natürlich zur Aktion überleitet. Stelle KEINE Rückfragen — der Button erscheint automatisch.",
                }),
              });
            } else if (isNavigateEnvelope(result)) {
              send(JSON.stringify({ navigate: result.navigate }));
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({
                  status: "navigating",
                  path: result.navigate,
                  note: "Navigation wurde ausgelöst. Bestätige dem Nutzer kurz mit einem Satz, wohin du ihn navigierst.",
                }),
              });
            } else if (isSetMacroEnvelope(result)) {
              // Phase 2: dispatch the set_macro event to the client so
              // the engine-macros screen can update its local form state.
              send(JSON.stringify({ set_macro: result.set_macro }));
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({
                  status: "macro_updated",
                  field: result.set_macro.field,
                  value: result.set_macro.value,
                  note: "Feld wurde aktualisiert. Bestätige dem Nutzer mit einem kurzen Satz, was du geändert hast.",
                }),
              });
            } else if (isMealPrepEnvelope(result)) {
              // Meal-prep flow: pre-fill engine form and navigate there.
              // The client stores macros in sessionStorage then navigates,
              // so the engine page can read them on mount even though the
              // navigation is async and the CustomEvents would fire too early.
              send(JSON.stringify({ meal_prep: result.meal_prep }));
              const mp = result.meal_prep;
              const macroBits = [`${mp.carbs}g KH`];
              if (mp.protein != null) macroBits.push(`${mp.protein}g Eiweiß`);
              if (mp.fat != null) macroBits.push(`${mp.fat}g Fett`);
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({
                  status: "meal_prep_sent",
                  input_text: mp.input_text,
                  macros: macroBits.join(", "),
                  note: "Der Engine-Screen öffnet sich mit vorausgefüllten Makros. Sag dem Nutzer kurz, welche Werte du eingetragen hast, und dass er sie noch anpassen oder per Sprache bestätigen kann ('Speichern' sagen).",
                }),
              });
            } else {
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(result),
              });
            }
          }
          void pendingEmittedThisRound;
        }

        if (timedOut || closed) return;

        // Meal-log turns: chip IS the full response — skip streaming phase.
        if (mealPrepEmittedThisRequest) {
          send("[DONE]");
          safeClose();
          return;
        }

        // ── Phase 2: stream the final answer ────────────────────────
        // imageAttachments / pdfAttachments / hasImages are hoisted above Phase 1.
        // Images were already applied to the user message before Phase 1 so the
        // model could call log_meal_entry; no re-application needed here.

        // Extract text from PDF attachments and prepend to the last user
        // message so OpenAI receives the actual document content.
        if (pdfAttachments.length > 0) {
          const { extractTextFromPdf } = await import("@/lib/pdf/extractText");
          const lastUserIdx = messages.length - 1;
          const pdfParts: string[] = [];

          for (const att of pdfAttachments) {
            try {
              const resp = await fetch(att.url);
              if (!resp.ok) throw new Error(`PDF fetch failed: ${resp.status}`);
              const buf = await resp.arrayBuffer();
              const text = await extractTextFromPdf(buf, 50);
              const trimmed =
                text.length > 12000
                  ? text.slice(0, 12000) + "\n\n[Dokument gekürzt — nur die ersten 12000 Zeichen]"
                  : text;
              pdfParts.push(`[Anhang: ${att.fileName}]\n${trimmed || "[Kein lesbarer Text — möglicherweise ein Scan-PDF]"}`);
            } catch (err) {
              console.error("[pdf-extract] Fehler", { fileName: att.fileName, err });
              pdfParts.push(`[Angehängtes Dokument: ${att.fileName} — Inhalt konnte nicht gelesen werden]`);
            }
          }

          if (pdfParts.length > 0 && messages[lastUserIdx]?.role === "user") {
            messages[lastUserIdx] = {
              ...messages[lastUserIdx],
              content: `${pdfParts.join("\n\n")}\n\n${messages[lastUserIdx].content as string}`,
            };
          }
        }

        const streamResult = await callOpenAIWithRetry(
          () => client.chat.completions.create({
            model: "mistral-large-latest",
            max_tokens: hasImages ? 512 : 300,
            temperature: 0.4,
            messages,
            stream: true,
          }),
          _sleep,
        );

        if (timedOut || closed) return;

        for await (const chunk of streamResult) {
          if (timedOut || closed) return;
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            send(JSON.stringify({ token: delta }));
          }
        }

        if (!timedOut && !closed) {
          send("[DONE]");
          safeClose();
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (timedOut || closed) return;

        // ── OpenAI rate limit (all retries exhausted) ────────────────
        if (e instanceof OpenAIRateLimitError) {
          console.warn("[chat] OpenAI rate limit — all retries exhausted", {
            retry_after_sec: e.retry_after_sec,
            attempts: e.attempts,
          });
          try {
            send(JSON.stringify({
              error_code: "MISTRAL_RATE_LIMITED",
              user_message: getUserFriendlyMessage("MISTRAL_RATE_LIMITED", "de"),
              retry_allowed: true,
              retry_after_sec: e.retry_after_sec,
              attempts: e.attempts,
            }));
            send("[DONE]");
            safeClose();
          } catch {
            /* controller already closed */
          }
          return;
        }

        // ── Generic upstream error ───────────────────────────────────
        const cause = e instanceof Error ? e.message : "stream error";
        console.error("[chat]", { code: "UPSTREAM_ERROR", cause });
        try {
          send(JSON.stringify({
            error_code: "UPSTREAM_ERROR",
            user_message: getUserFriendlyMessage("UPSTREAM_ERROR", "de"),
            retry_allowed: true,
          }));
          send("[DONE]");
          safeClose();
        } catch {
          /* controller already closed */
        }
      } finally {
        clearTimeout(timeoutId);
      }
    },
  });

  // photo_analysis trace: persist fire-and-forget after the stream is sent
  if (photoTrace && photoAdminSb) {
    const _photoTrace = photoTrace;
    const _photoAdminSb = photoAdminSb;
    const _userId = user.id;
    _photoTrace.setOutput({ image_count: imageAttachments.length });
    after(async () => {
      void _photoTrace.persist({
        user_id:     _userId,
        supabase:    _photoAdminSb,
        app_version: process.env.npm_package_version ?? "unknown",
        env:         process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
    });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Next.js route export — thin wrapper around `handleChatPost` so the
 * core handler can be tested independently via dependency injection.
 */
export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  return handleChatPost(req);
}

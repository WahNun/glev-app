import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Mistral } from "@mistralai/mistralai";
import { authedClient, type AuthOk, type AuthErr } from "@/app/api/insulin/_helpers";
import { getMistralClient } from "@/lib/ai/mistralClient";
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

// Maximum number of sequential tool-call rounds before we stop calling
// Mistral with `tools` and force a streamed final answer. Two is enough
// for any realistic chain ("get glucose + IOB + last meal") while
// keeping a hard ceiling against accidental tool-loop runaways.
const MAX_TOOL_ROUNDS = 2;

// ── Timeout ───────────────────────────────────────────────────────────
// Hard ceiling for Mistral round-trips inside the SSE stream.
// If the stream hasn't produced [DONE] within this window the handler
// emits a CHAT_TIMEOUT SSE error frame and closes the stream.
// Kept as a named constant so tests can override it via ChatDeps.timeoutMs.
const DEFAULT_TIMEOUT_MS = 18_000;

// ── 429 retry ─────────────────────────────────────────────────────────
// Server-side retry budget. If Retry-After would require waiting longer
// than this, we surface MISTRAL_RATE_LIMITED to the client immediately
// (let the client-side retry handle it) rather than burning Vercel
// function time that would hit the serverless limit.
const MAX_RETRY_WAIT_MS = 8_000;
const MAX_MISTRAL_RETRIES = 2;

/**
 * Thrown by `callMistralWithRetry` when all server-side retry attempts
 * are exhausted or the Retry-After delay exceeds MAX_RETRY_WAIT_MS.
 */
class MistralRateLimitError extends Error {
  readonly retry_after_sec: number;
  readonly attempts: number;

  constructor(retry_after_sec: number, attempts: number) {
    super("MISTRAL_RATE_LIMITED");
    this.name = "MistralRateLimitError";
    this.retry_after_sec = retry_after_sec;
    this.attempts = attempts;
  }
}

/**
 * Returns `true` when the caught error represents a Mistral HTTP 429.
 * The Mistral SDK surfaces rate-limits as thrown errors with a
 * `statusCode` or `status` field (SDK v1 uses `statusCode`).
 */
function isMistral429Error(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  return (
    err.statusCode === 429 ||
    err.status === 429 ||
    (typeof err.message === "string" && err.message.includes("429"))
  );
}

/**
 * Returns `true` when the caught error is a Mistral 5xx server error
 * (overloaded, gateway timeout, internal server error, etc.).
 * These are transient — a single retry with a short delay recovers most cases.
 */
function isMistral5xxError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as Record<string, unknown>;
  const code = typeof err.statusCode === "number" ? err.statusCode
    : typeof err.status === "number" ? err.status
    : null;
  if (code !== null) return code >= 500 && code < 600;
  // Fallback: check message string for common 5xx patterns
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
 * Wraps a Mistral API call with up to `MAX_MISTRAL_RETRIES` server-side
 * retries on 429 responses. Backs off for the `Retry-After` duration
 * (default 5 s) between attempts.
 *
 * Throws `MistralRateLimitError` when:
 * - All retries are exhausted, OR
 * - The Retry-After delay would exceed `MAX_RETRY_WAIT_MS` (prefer
 *   surfacing a client-side retry over burning Vercel function time).
 *
 * All other errors propagate as-is.
 *
 * Delegates to the shared `callWithRetry` helper in
 * `lib/ai/retryWithRateLimit.ts`; Mistral-specific quirks (statusCode vs
 * status field) stay isolated here via `isMistral429Error`.
 *
 * @param fn     - Factory that performs one Mistral API call.
 * @param _sleep - Injectable sleep function for unit tests.
 */
export async function callMistralWithRetry<T>(
  fn: () => Promise<T>,
  _sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  return callWithRetry(fn, {
    is429: isMistral429Error,
    getRetryAfterSec: defaultGetRetryAfterSec,
    maxRetries: MAX_MISTRAL_RETRIES,
    maxRetryWaitMs: MAX_RETRY_WAIT_MS,
    makeRateLimitError: (retryAfterSec, attempts) =>
      new MistralRateLimitError(retryAfterSec, attempts),
    logPrefix: "[chat] Mistral",
    is5xx: isMistral5xxError,
    max5xxRetries: 1,
    retry5xxDelayMs: 1_500,
  }, _sleep);
}

/**
 * POST /api/ai/chat
 *
 * Streaming SSE endpoint that powers the Glev AI chat sheet (Phase 2).
 * The response body is `text/event-stream` with one `data: <token>` line
 * per Mistral chunk and a final `data: [DONE]` sentinel — matching the
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
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Returns `true` if the user has already hit RATE_LIMIT_MAX requests in
 * the last RATE_LIMIT_WINDOW_MS. Otherwise records this hit and returns
 * `false`. Fails open: if the admin client is unconfigured or the DB
 * call errors, we let the request through rather than locking everyone
 * out (the existing Mistral-side quota remains as a backstop).
 */
async function isRateLimited(userId: string): Promise<boolean> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return false;
  }

  const now = Date.now();
  const cutoffIso = new Date(now - RATE_LIMIT_WINDOW_MS).toISOString();

  const { count, error: countErr } = await admin
    .from("ai_rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("hit_at", cutoffIso);

  if (countErr) {
    return false;
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return true;
  }

  const { error: insertErr } = await admin
    .from("ai_rate_limit_hits")
    .insert({ user_id: userId, hit_at: new Date(now).toISOString() });
  if (insertErr) {
    return false;
  }

  // Opportunistic best-effort cleanup of stale rows for this user so
  // the table doesn't grow without bound. Errors are ignored — a
  // future row will retry the prune.
  void admin
    .from("ai_rate_limit_hits")
    .delete()
    .eq("user_id", userId)
    .lt("hit_at", cutoffIso);

  return false;
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
  /** Optional file attachments uploaded via /api/ai/upload.
   *  Images → pixtral-12b-2409 (vision model).
   *  PDFs   → text prepended to message, then mistral-small-latest. */
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
      attachments,
    },
  };
}

type ContextScopes = { glucose: boolean; iob: boolean; history: boolean };

/**
 * Builds the system preamble that ships the user's live snapshot to
 * Mistral. Each line is gated by the matching granular consent scope
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
): string {
  const todayLocalDate = todayInTimezone(timezone);
  const nowIso = nowIsoWithOffset(timezone);
  const nowTime = nowIso.slice(11, 16);
  const lines: string[] = [
    `Heute ist ${todayLocalDate} (Datum in der lokalen Zeitzone des Nutzers; für add_appointment relative Angaben wie „nächste Woche" auf das absolute Datum umrechnen).`,
    `Aktuelle Uhrzeit: ${nowTime} Uhr (Lokalzeit). Jetzt: ${nowIso} — nutze diesen ISO-8601-String mit Offset als Vorlage für logged_at. Beispiele: „vor 20 Minuten" → Uhrzeit − 20 Min, Offset beibehalten. „gegen 16:02 Uhr" oder „um 14:30" → heutiges Datum + genannte Uhrzeit + gleicher Offset (z. B. ${nowIso.slice(0, 11)}16:02:00${nowIso.slice(19)}). Bei explizit genannten Uhrzeiten IMMER logged_at setzen.`,
    "Kontext-Snapshot des Nutzers (kann veraltet oder Platzhalter sein — wenn unklar, vorsichtig formulieren):",
  ];
  if (ctx.screen) lines.push(`- Screen: ${ctx.screen}`);
  if (scopes.glucose) lines.push(`- Glukose: ${ctx.glucoseSummary}`);
  if (scopes.iob)     lines.push(`- IOB:     ${ctx.iobSummary}`);
  lines.push(`- Letzte Mahlzeit: ${ctx.lastMealDescription}`);
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
// wären 50 Einträge ≲ 28 KB — deutlich unter Mistrals 32k-Kontext, lässt
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
 * Strips system-prompt echoes from assistant history before sending to Mistral.
 * Prevents the feedback loop: model echoes prompt → echo lands in history →
 * model echoes it again next turn.
 *
 * Strategy: if the assistant turn contains unique system-prompt fingerprints
 * that never appear in legitimate replies, replace the content with a neutral
 * placeholder so Mistral doesn't treat the echo as a learned pattern.
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
 * Checks whether `user_settings.feature_flags.ai_voice` is `true` for
 * the given user. Returns a 403 NextResponse when the flag is absent or
 * false, and `null` when the check passes (request may proceed).
 *
 * Exported for unit testing (dependency-injection of the Supabase client).
 */
export async function checkChatFlag(
  sb: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const { data: settingsRow } = await sb
    .from("user_settings")
    .select("feature_flags")
    .eq("user_id", userId)
    .maybeSingle();
  const featureFlags = (settingsRow?.feature_flags ?? {}) as Record<string, unknown>;
  if (featureFlags.ai_voice !== true) {
    return errorResponse("PERMISSION_DENIED", 403);
  }
  return null;
}

/**
 * Injectable dependencies for `handleChatPost`. All fields are optional —
 * omitting them falls back to the real production implementations so that
 * the exported `POST` handler needs no changes at the call site.
 *
 * - `auth`: pre-resolved auth result. When omitted `handleChatPost` calls
 *   `authedClient(req)` itself (production path).
 * - `getMistral`: factory that returns a Mistral client. When omitted the
 *   real `getMistralClient()` is used. Tests can pass a spy here to assert
 *   that no Mistral call occurs when the feature-flag gate blocks early.
 * - `timeoutMs`: stream timeout in milliseconds. Defaults to 18 000. Tests
 *   can lower this to make timeout scenarios fast.
 * - `sleep`: injectable sleep for 429-retry back-off. Defaults to real
 *   `setTimeout`. Tests can pass a no-op to skip the actual wait.
 */
export type ChatDeps = {
  auth?: AuthOk | AuthErr;
  getMistral?: () => Mistral;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Core POST handler extracted from the Next.js route export so it can be
 * called directly in unit tests with injectable dependencies.
 *
 * The exported `POST` function is a thin wrapper that calls this with the
 * real authedClient result and no Mistral override.
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

  // 3. Rate limit
  if (await isRateLimited(user.id)) {
    console.error("[chat]", { code: "MISTRAL_RATE_LIMITED", userId: user.id });
    return errorResponse("MISTRAL_RATE_LIMITED", 429);
  }

  // 4. Body
  const raw = await req.json().catch(() => null);
  const v = validateBody(raw);
  if (!v.ok) {
    console.error("[chat]", { code: "PARSE_FAILED", cause: v.error });
    return errorResponse("PARSE_FAILED", 400);
  }
  const { message, history, contextSnapshot } = v.body;
  const timezone: string | null = v.body.timezone ?? null;
  const attachments: ChatAttachment[] = v.body.attachments ?? [];

  // 5. Mistral client
  const _getMistral = deps.getMistral ?? getMistralClient;
  let client;
  try {
    client = _getMistral();
  } catch (e) {
    console.error("[chat]", { code: "UPSTREAM_ERROR", cause: e instanceof Error ? e.message : String(e) });
    return errorResponse("UPSTREAM_ERROR", 503);
  }

  // Compose messages: system + context preamble + last-10 history + new turn.
  // Typed loosely as `any[]` because the Mistral SDK's message-union type
  // is awkward to reproduce inline (tool replies vs assistant tool_calls
  // vs plain user/assistant turns) and we treat the array as an opaque
  // protocol buffer that only Mistral itself needs to validate.
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
  // Mistral's tool-calling protocol is two-phase: first a non-streaming
  // `chat.complete` with `tools` lets the model emit `tool_calls`; we
  // execute them server-side, append the results as `role: "tool"`
  // messages, and re-call. Once the model returns text-only (no more
  // tool_calls) — or we hit MAX_TOOL_ROUNDS — we switch to
  // `chat.stream` for the final, user-visible answer.
  //
  // This keeps the streaming UX intact (tokens still arrive live) while
  // adding the read-only tool layer (Phase 3 / Task 1). Write-tools
  // come in Task 2 behind a UI-confirmation gate.

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
        // ── Phase 1: resolve any tool calls ─────────────────────────
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (timedOut || closed) return;

          const completion = await callMistralWithRetry(
            () => client.chat.complete({
              model: "mistral-small-latest",
              maxTokens: 300,
              temperature: 0.4,
              messages,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tools: GLEV_TOOLS as any,
              toolChoice: "auto",
            }),
            _sleep,
          );

          if (timedOut || closed) return;

          const choice = completion?.choices?.[0];
          const toolCalls = choice?.message?.toolCalls ?? [];
          if (!toolCalls.length) {
            // No tool requested → no more rounds needed. We fall
            // through to the streaming call below, which will produce
            // the same answer (Mistral is deterministic enough at
            // temp 0.4 + identical messages) but stream it.
            break;
          }

          // Append the assistant turn that requested the tool calls,
          // then run each tool and append its result. The SDK requires
          // the assistant message to be present before the tool reply.
          messages.push({
            role: "assistant",
            content: choice?.message?.content ?? "",
            toolCalls,
          });

          // Hard cap: maximal EINE pending WRITE-Aktion pro Assistant-
          // Turn. Würde das Modell zwei Mal in einer Runde z. B.
          // log_meal_entry + log_bolus_entry rufen, würde die UI nur
          // die letzte pending_action sehen (eine PendingAction pro
          // Bubble in `useGlevAI`). Statt das clientseitig zu lösen
          // brechen wir hier server-seitig ab: erste WRITE wird normal
          // bearbeitet, jede weitere WRITE-Tool-Call der gleichen Runde
          // wird Mistral als „rejected: only one write per turn" zurück-
          // gegeben — damit kann das Modell entweder im Text drauf
          // hinweisen oder im nächsten Turn nachziehen.
          let pendingEmittedThisRound = false; // still tracks state for the Mistral stub note
          for (const call of toolCalls) {
            const fn = call.function;
            const rawArgs =
              typeof fn?.arguments === "string"
                ? fn.arguments
                : JSON.stringify(fn?.arguments ?? {});
            const result = await executeGlevTool(
              fn?.name ?? "",
              rawArgs,
              sb,
              user.id,
              timezone,
            );

            // WRITE-tools return a `pending_action` envelope instead of
            // doing the insert. Forward the envelope to the UI on a
            // dedicated SSE frame, and give Mistral a short "awaiting
            // user confirmation" stub so it doesn't try to confirm
            // itself or chain more writes in the same round.
            if (isDualPendingActionEnvelope(result)) {
              // Dual-Emission: meal + alcohol influence.
              // Emit meal_prep frame first (for sessionStorage pre-fill),
              // then both pending_actions so the client renders two chips.
              pendingEmittedThisRound = true;
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
                    ...(mp.meal_time_explicit === true && typeof mp.logged_at === "string" && mp.logged_at ? { meal_time: mp.logged_at } : {}),
                  },
                }));
              }
              send(JSON.stringify({ pending_action: mealAction }));
              send(JSON.stringify({ pending_action: inflAction }));
              if (result.backgroundTask) after(result.backgroundTask);
              messages.push({
                role: "tool",
                name: fn?.name ?? "",
                toolCallId: call.id,
                content: JSON.stringify({
                  status: "awaiting_user_confirmation",
                  kind: "log_meal_entry+log_influence_entry",
                  note: "Zwei Bestätigungs-Buttons erscheinen automatisch: Mahlzeit + Alkohol-Einflussfaktor. Antworte mit EINEM kurzen Satz ('Soll ich Mahlzeit und Alkohol-Einflussfaktor so speichern?').",
                }),
              });
            } else if (isPendingActionEnvelope(result)) {
              pendingEmittedThisRound = true;
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
                      ...(p.meal_time_explicit === true && typeof p.logged_at === "string" && p.logged_at ? { meal_time: p.logged_at } : {}),
                    },
                  }),
                );
              }
              send(JSON.stringify({ pending_action: result.pending_action }));
              if (result.backgroundTask) after(result.backgroundTask);
              messages.push({
                role: "tool",
                name: fn?.name ?? "",
                toolCallId: call.id,
                content: JSON.stringify({
                  status: "awaiting_user_confirmation",
                  kind: result.pending_action.kind,
                  summary: result.pending_action.summary,
                  note:
                    "Bestätigung erfolgt durch UI-Button. Antworte mit EINEM kurzen Satz, der natürlich zur Aktion überleitet (z. B. 'Soll ich das so speichern?'). Stelle KEINE Rückfragen nach Daten, frage NICHT erneut nach Bestätigung — der Button erscheint automatisch.",
                }),
              });
            } else if (isNavigateEnvelope(result)) {
              send(JSON.stringify({ navigate: result.navigate }));
              messages.push({
                role: "tool",
                name: fn?.name ?? "",
                toolCallId: call.id,
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
                name: fn?.name ?? "",
                toolCallId: call.id,
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
                name: fn?.name ?? "",
                toolCallId: call.id,
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
                name: fn?.name ?? "",
                toolCallId: call.id,
                content: JSON.stringify(result),
              });
            }
          }
          void pendingEmittedThisRound;
        }

        if (timedOut || closed) return;

        // ── Phase 2: stream the final answer ────────────────────────
        // Route to pixtral-12b-2409 when image attachments are present.
        // PDFs are prepended as a "[Attached PDF: filename]" note in the
        // user message so mistral-small-latest is aware of the context.
        const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"));
        const pdfAttachments   = attachments.filter((a) => a.mimeType === "application/pdf");

        // Extract text from PDF attachments and prepend to the last user
        // message so Mistral receives the actual document content.
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

        const usePixtral = imageAttachments.length > 0;
        const finalModel = usePixtral ? "pixtral-12b-2409" : "mistral-small-latest";

        // For Pixtral: replace the last user message with a content-array
        // that includes the text plus image_url objects.
        if (usePixtral) {
          const lastUserIdx = messages.length - 1;
          if (messages[lastUserIdx]?.role === "user") {
            const textContent = messages[lastUserIdx].content as string;
            messages[lastUserIdx] = {
              role: "user",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content: [
                { type: "text", text: textContent },
                ...imageAttachments.map((a) => ({
                  type: "image_url" as const,
                  imageUrl: { url: a.url },
                })),
              ],
            };
          }
        }

        const result = await callMistralWithRetry(
          () => client.chat.stream({
            model: finalModel,
            maxTokens: usePixtral ? 512 : 300,
            temperature: 0.4,
            messages,
          }),
          _sleep,
        );

        if (timedOut || closed) return;

        for await (const event of result) {
          if (timedOut || closed) return;
          const delta = event?.data?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            send(JSON.stringify({ token: delta }));
          } else if (Array.isArray(delta)) {
            for (const chunk of delta) {
              const text = typeof chunk === "string" ? chunk : (chunk as { text?: string })?.text;
              if (typeof text === "string" && text.length > 0) {
                send(JSON.stringify({ token: text }));
              }
            }
          }
        }

        if (!timedOut && !closed) {
          send("[DONE]");
          safeClose();
        }
      } catch (e) {
        clearTimeout(timeoutId);
        if (timedOut || closed) return;

        // ── Mistral rate limit (all retries exhausted) ───────────────
        if (e instanceof MistralRateLimitError) {
          console.warn("[chat] Mistral rate limit — all retries exhausted", {
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

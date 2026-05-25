import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authedClient } from "@/app/api/insulin/_helpers";
import { getMistralClient, mistralConfigError } from "@/lib/ai/mistralClient";
import { GLEV_CHAT_SYSTEM_PROMPT } from "@/lib/ai/glevChatPrompt";
import {
  GLEV_TOOLS,
  executeGlevTool,
  isPendingActionEnvelope,
  isNavigateEnvelope,
  isSetMacroEnvelope,
} from "@/lib/ai/glevTools";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Maximum number of sequential tool-call rounds before we stop calling
// Mistral with `tools` and force a streamed final answer. Two is enough
// for any realistic chain ("get glucose + IOB + last meal") while
// keeping a hard ceiling against accidental tool-loop runaways.
const MAX_TOOL_ROUNDS = 2;

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
};

function validateBody(b: unknown): { ok: true; body: ChatBody } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "body must be an object" };
  const o = b as Record<string, unknown>;
  if (typeof o.message !== "string" || !o.message.trim()) {
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
  return {
    ok: true,
    body: {
      message: o.message,
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
  todayLocalDate: string,
): string {
  const lines: string[] = [
    `Heute ist ${todayLocalDate} (Datum in der lokalen Zeitzone des Nutzers; für add_appointment relative Angaben wie „nächste Woche" auf das absolute Datum umrechnen).`,
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

export async function POST(req: NextRequest) {
  // 1. Auth
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { user, sb } = auth;

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
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }
  if (!profile?.ai_consent_at) {
    return NextResponse.json({ error: "ai consent required" }, { status: 403 });
  }
  const scopes: ContextScopes = {
    glucose: Boolean(profile?.ai_consent_glucose_at),
    iob:     Boolean(profile?.ai_consent_iob_at),
    history: Boolean(profile?.ai_consent_history_at),
  };

  // 3. Rate limit
  if (await isRateLimited(user.id)) {
    return NextResponse.json(
      { error: "rate limit exceeded — max 20 requests per minute" },
      { status: 429 },
    );
  }

  // 4. Body
  const raw = await req.json().catch(() => null);
  const v = validateBody(raw);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const { message, history, contextSnapshot } = v.body;
  const timezone: string | null = v.body.timezone ?? null;

  // 5. Mistral client
  let client;
  try {
    client = getMistralClient();
  } catch {
    const err = mistralConfigError();
    return NextResponse.json({ error: err.error }, { status: err.status });
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
  const memoryBlock = await loadUserMemoryBlock(sb, user.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: GLEV_CHAT_SYSTEM_PROMPT },
    ...(memoryBlock ? [{ role: "system", content: memoryBlock }] : []),
    {
      role: "system",
      content: contextPreamble(
        contextSnapshot,
        scopes,
        todayInTimezone(timezone),
      ),
    },
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
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
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      try {
        // ── Phase 1: resolve any tool calls ─────────────────────────
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const completion = await client.chat.complete({
            model: "mistral-small-latest",
            maxTokens: 300,
            temperature: 0.4,
            messages,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: GLEV_TOOLS as any,
            toolChoice: "auto",
          });

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
          let pendingEmittedThisRound = false;
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
            if (isPendingActionEnvelope(result)) {
              if (pendingEmittedThisRound) {
                messages.push({
                  role: "tool",
                  name: fn?.name ?? "",
                  toolCallId: call.id,
                  content: JSON.stringify({
                    status: "rejected",
                    reason:
                      "only_one_write_action_per_turn — bereits eine andere Speicher-Aktion in dieser Runde vorgeschlagen. Wenn das hier auch nötig ist, schlage es im nächsten Turn separat vor.",
                  }),
                });
                continue;
              }
              pendingEmittedThisRound = true;
              send(JSON.stringify({ pending_action: result.pending_action }));
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
            } else {
              messages.push({
                role: "tool",
                name: fn?.name ?? "",
                toolCallId: call.id,
                content: JSON.stringify(result),
              });
            }
          }
        }

        // ── Phase 2: stream the final answer ────────────────────────
        const result = await client.chat.stream({
          model: "mistral-small-latest",
          maxTokens: 300,
          temperature: 0.4,
          messages,
        });
        for await (const event of result) {
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
        send("[DONE]");
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "stream error";
        send(JSON.stringify({ error: msg }));
        send("[DONE]");
        controller.close();
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

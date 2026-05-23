import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";
import { getMistralClient, mistralConfigError } from "@/lib/ai/mistralClient";
import { GLEV_CHAT_SYSTEM_PROMPT } from "@/lib/ai/glevChatPrompt";

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
// Simple in-memory rolling window. Per-user, per-process. On Vercel
// each function instance has its own Map — that's intentional: this is
// a courtesy gate against runaway clients, not a security boundary.
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const _hits = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const arr = (_hits.get(userId) ?? []).filter((t) => t > cutoff);
  if (arr.length >= RATE_LIMIT_MAX) {
    _hits.set(userId, arr);
    return true;
  }
  arr.push(now);
  _hits.set(userId, arr);
  return false;
}

// ── Body shape ────────────────────────────────────────────────────────
type ChatMessage = { role: "user" | "assistant"; content: string };
type ContextSnapshot = {
  glucoseSummary: string;
  iobSummary: string;
  lastMealDescription: string;
};
type ChatBody = {
  message: string;
  conversationId?: string;
  history?: ChatMessage[];
  contextSnapshot: ContextSnapshot;
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
        glucoseSummary: ctx.glucoseSummary,
        iobSummary: ctx.iobSummary,
        lastMealDescription: ctx.lastMealDescription,
      },
    },
  };
}

function contextPreamble(ctx: ContextSnapshot): string {
  return [
    "Kontext-Snapshot des Nutzers (kann veraltet oder Platzhalter sein — wenn unklar, vorsichtig formulieren):",
    `- Glukose: ${ctx.glucoseSummary}`,
    `- IOB:     ${ctx.iobSummary}`,
    `- Letzte Mahlzeit: ${ctx.lastMealDescription}`,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  // 1. Auth
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { user, sb } = auth;

  // 2. Consent
  const { data: profile, error: profErr } = await sb
    .from("profiles")
    .select("ai_consent_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }
  if (!profile?.ai_consent_at) {
    return NextResponse.json({ error: "ai consent required" }, { status: 403 });
  }

  // 3. Rate limit
  if (isRateLimited(user.id)) {
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

  // 5. Mistral client
  let client;
  try {
    client = getMistralClient();
  } catch {
    const err = mistralConfigError();
    return NextResponse.json({ error: err.error }, { status: err.status });
  }

  // Compose messages: system + context preamble + last-10 history + new turn.
  const messages = [
    { role: "system" as const, content: GLEV_CHAT_SYSTEM_PROMPT },
    { role: "system" as const, content: contextPreamble(contextSnapshot) },
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: message },
  ];

  // 6. Stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (line: string) => controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      try {
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

import { NextRequest } from "next/server";
import { getMistralClient } from "@/lib/ai/mistralClient";
import { authedClient } from "@/app/api/insulin/_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/transcribe/mistral/stream
 *
 * SSE streaming speech-to-text via Mistral voxtral-mini.
 *
 * Transport: Server-Sent Events (text/event-stream).
 * Each event is a JSON object with one of:
 *   { type: "partial", text: string }  — intermediate result (when streaming API is GA)
 *   { type: "final",   text: string }  — complete transcript
 *   { type: "error",   error: string } — transcription failure
 *
 * Current state: Voxtral streaming WebSocket is not yet GA (see D-021).
 * The batch API is wrapped in SSE format so the client already uses the
 * streaming path. When Mistral ships the stable streaming API, replace the
 * `mistral.audio.transcriptions.complete` call below with the streaming
 * variant and emit "partial" events as chunks arrive — no client changes needed.
 *
 * Auth: requires a valid Supabase session (same gate as all protected routes).
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();

  const auth = await authedClient(req);
  if (!auth.user) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Unauthorized" })}\n\n`,
      {
        status: 401,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  let mistral;
  try {
    mistral = getMistralClient();
  } catch (e) {
    const error = e instanceof Error ? e.message : "AI not configured";
    return new Response(
      `data: ${JSON.stringify({ type: "error", error })}\n\n`,
      {
        status: 503,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  let file: Blob;
  try {
    const form = await req.formData();
    const raw = form.get("audio");
    if (!(raw instanceof Blob)) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: "audio file is required" })}\n\n`,
        {
          status: 400,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
    file = raw;
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Failed to parse form data" })}\n\n`,
      {
        status: 400,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  // eslint-disable-next-line no-console
  console.log("[STT stream] audio received:", Math.round(file.size / 1024), "KB");

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const t1 = Date.now();

        // TODO: Replace with mistral.audio.transcriptions.stream() when Voxtral
        // streaming WebSocket is GA. Emit "partial" events for each chunk and
        // "final" for the completed transcript. No client changes needed.
        const result = await mistral.audio.transcriptions.complete({
          model: "voxtral-mini-latest",
          file: file as Blob,
        });

        const text = (result as unknown as { text?: string }).text ?? "";

        // eslint-disable-next-line no-console
        console.log("[STT stream] done in", Date.now() - t1, "ms · total:", Date.now() - t0, "ms");

        sendEvent({ type: "final", text });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Transcription failed";
        // eslint-disable-next-line no-console
        console.log("[STT stream] FAILED after", Date.now() - t0, "ms:", error);
        sendEvent({ type: "error", error });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

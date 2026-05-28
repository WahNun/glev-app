import { NextRequest } from "next/server";
import { getMistralClient } from "@/lib/ai/mistralClient";
import { authedClient } from "@/app/api/insulin/_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Pure accumulation logic for the Mistral transcription event stream.
 * Exported for unit-test access — no I/O, no auth, no Mistral client.
 *
 * Rules:
 *   transcription.text.delta → accumulate text, call sendEvent({ type:"partial", text: accumulated })
 *   transcription.done        → call sendEvent({ type:"final", text: data.text ?? accumulated })
 *   After the loop, if nothing was accumulated → sendEvent({ type:"final", text:"" })
 */
export async function processTranscriptionStream(
  eventStream: AsyncIterable<{ data: { type: string; text?: string } }>,
  sendEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  let accumulated = "";

  for await (const chunk of eventStream) {
    const { data } = chunk;

    if (data.type === "transcription.text.delta") {
      accumulated += data.text;
      sendEvent({ type: "partial", text: accumulated });
    } else if (data.type === "transcription.done") {
      const finalText = data.text ?? accumulated;
      sendEvent({ type: "final", text: finalText });
    }
  }

  if (!accumulated) {
    sendEvent({ type: "final", text: "" });
  }
}

/**
 * POST /api/transcribe/mistral/stream
 *
 * SSE streaming speech-to-text via Mistral voxtral-mini.
 *
 * Transport: Server-Sent Events (text/event-stream).
 * Each event is a JSON object with one of:
 *   { type: "partial", text: string }  — intermediate result, emitted per text delta
 *   { type: "final",   text: string }  — complete transcript (transcription.done)
 *   { type: "error",   error: string } — transcription failure
 *
 * Uses mistral.audio.transcriptions.stream() (GA as of SDK v2.2.1).
 * Partial events accumulate deltas so the client always sees the full
 * in-progress text, not just the incremental piece.
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

        const eventStream = await mistral.audio.transcriptions.stream({
          model: "voxtral-mini-latest",
          file: file as Blob,
        });

        await processTranscriptionStream(eventStream, sendEvent);
        // eslint-disable-next-line no-console
        console.log("[STT stream] done · total:", Date.now() - t0, "ms");
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

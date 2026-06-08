"use client";

import { useRef, useState, useCallback, useEffect } from "react";

/**
 * useVoxtral — hold-to-talk hook for GlevAIChatSheet.
 *
 * Works on web (getUserMedia) and Capacitor native shells. On iOS, WKWebView
 * auto-triggers the system permission dialog on the first getUserMedia() call.
 * On Android, the runtime RECORD_AUDIO permission must be explicitly requested —
 * startListening() checks navigator.permissions first and surfaces MIC_PERM_DENIED
 * so the UI can show an actionable banner instead of a raw error string.
 *
 * Transport: SSE streaming (POST /api/transcribe/mistral/stream).
 * The SSE route currently wraps the batch Voxtral API; when Mistral ships
 * stable streaming WebSocket support, only the server-side route changes —
 * this hook is already streaming-ready and will receive partial events.
 * If the SSE connection fails, the hook falls back to the batch REST endpoint
 * (POST /api/transcribe/mistral) automatically.
 *
 * Flow:
 *   startListening()  → getUserMedia → MediaRecorder → collect chunks
 *   stopListening()   → stop recorder → assemble Blob
 *                     → try SSE stream → onPartialTranscript (partials)
 *                                     → onTranscript (final)
 *                     → on stream failure: fall back to REST POST
 *
 * SSR-safe: returns a no-op stub when called outside a browser context.
 *
 * Error-recovery contract:
 *   When a transcription attempt fails, an AbortController is used so that
 *   a stale in-flight request cannot call onError after the user has already
 *   started a new recording. startListening() always aborts the previous
 *   transcription before starting fresh, so a retry is always clean.
 */

import { ERROR_MESSAGES } from "@/lib/ai/errors";

/**
 * Sentinel returned via onError when the OS microphone permission is denied.
 * The UI checks for this exact string to show a dedicated recovery banner
 * instead of the generic red error toast.
 */
export const MIC_PERM_DENIED = "MIC_PERM_DENIED" as const;

const STT_STREAM_ROUTE = "/api/transcribe/mistral/stream";
const STT_REST_ROUTE = "/api/transcribe/mistral";

/**
 * How long (ms) to wait for Voxtral to return a transcript after the mic
 * stops before aborting and surfacing STT_TIMEOUT to the user.
 *
 * 20 s covers slow network + worst-case Voxtral cold-start. Under normal
 * conditions the API responds in 1–3 s, so users almost never see this.
 * Lower than CHAT_TIMEOUT (18 s server-side) would be confusing — keep
 * the STT timeout at 20 s so the server never races the client.
 *
 * Exported so unit tests can override via dependency injection without
 * monkey-patching the module.
 */
export const STT_TIMEOUT_MS = 20_000;

export interface UseVoxtralOptions {
  onTranscript: (text: string) => void;
  /** Optional: called with in-progress partial text while speaking (greyed out in UI). */
  onPartialTranscript?: (text: string) => void;
  onError?: (err: string) => void;
}

export interface UseVoxtralReturn {
  isListening: boolean;
  /**
   * True while audio is being sent to the transcription API (after the mic
   * stops and before onTranscript / onError fires). Use this to keep the UI
   * in a "processing" state so the user knows work is in progress.
   */
  isTranscribing: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  /**
   * Seconds remaining until the Mistral STT rate-limit window expires.
   * Null when not rate-limited. Ticks down in real time via setInterval.
   * The mic button should be disabled and show a "Bitte X Sek. warten" label
   * while this is non-null and greater than 0.
   */
  voiceCountdown: number | null;
}

/**
 * Try SSE streaming first; fall back to single REST POST on failure.
 * Exported for unit-test access.
 *
 * @param signal - Optional AbortSignal. If aborted, the function exits
 *   silently without calling onError (abort is intentional — the user
 *   started a new recording and the stale in-flight request must not
 *   overwrite the freshly cleared error state).
 */
export async function transcribeWithFallback(
  blob: Blob,
  mimeType: string,
  onTranscript: (text: string) => void,
  onPartialTranscript?: (text: string) => void,
  onError?: (err: string) => void,
  signal?: AbortSignal,
  onRateLimit?: (retryAfterSec: number) => void,
): Promise<void> {
  // If already aborted before we start, exit immediately and silently.
  if (signal?.aborted) return;

  // Derive correct extension from actual mimeType so Mistral can decode it.
  // iOS records audio/mp4 — sending it as "recording.webm" causes a 400.
  const ext = mimeType.includes("mp4") ? "m4a" : "webm";
  const filename = `recording.${ext}`;

  // ── Attempt 1: SSE streaming ────────────────────────────────────────────
  let ssePropagatedRateLimit = false;
  try {
    const form = new FormData();
    form.append("audio", blob, filename);

    const res = await fetch(STT_STREAM_ROUTE, { method: "POST", body: form, signal });

    if (!res.ok || !res.body) {
      throw new Error(`SSE route returned HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let event: { type: string; text?: string; error?: string; retry_after_sec?: number };
        try {
          event = JSON.parse(line.slice(6)) as typeof event;
        } catch {
          continue;
        }

        if (event.type === "partial" && event.text) {
          onPartialTranscript?.(event.text);
        } else if (event.type === "final") {
          const text = event.text?.trim() ?? "";
          if (text) onTranscript(text);
          break outer;
        } else if (event.type === "error") {
          if (typeof event.retry_after_sec === "number") {
            // Rate-limited: notify the hook and do NOT fall through to REST.
            onRateLimit?.(event.retry_after_sec);
            ssePropagatedRateLimit = true;
          }
          throw new Error(event.error ?? "Streaming transcription failed");
        }
      }
    }

    return; // SSE succeeded
  } catch (e) {
    // AbortError = new recording started — exit silently so the stale
    // in-flight request cannot overwrite the freshly cleared error state.
    if (e instanceof Error && e.name === "AbortError") return;
    // Rate limit already handled above — don't call onError or fall through.
    if (ssePropagatedRateLimit) return;
    // Fall through to REST fallback below
  }

  // Check again after the SSE attempt (abort may have arrived while awaiting).
  if (signal?.aborted) return;

  // ── Attempt 2: REST POST fallback ───────────────────────────────────────
  try {
    const form = new FormData();
    form.append("audio", blob, filename);

    const res = await fetch(STT_REST_ROUTE, { method: "POST", body: form, signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; retry_after_sec?: number };
      if (res.status === 429 && typeof body.retry_after_sec === "number") {
        // Rate-limited: notify the hook and exit cleanly (no onError).
        onRateLimit?.(body.retry_after_sec);
        return;
      }
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const { text } = (await res.json()) as { text: string };
    if (text?.trim()) onTranscript(text.trim());
  } catch (e) {
    // Silent exit on abort — same reason as above.
    if (e instanceof Error && e.name === "AbortError") return;
    const raw = e instanceof Error ? e.message : "";
    // Show a clean user-facing message instead of raw API error JSON.
    const msg = raw.toLowerCase().includes("decoded") || raw.includes("400") || raw.includes("3310")
      ? "Aufnahme konnte nicht verarbeitet werden. Bitte nochmal versuchen."
      : raw || "Transkription fehlgeschlagen";
    onError?.(msg);
  }
}

// TODO(voice-control): Future app-wide voice control architecture.
// Planned intent types: log_bolus, log_meal, log_exercise, log_symptom, edit_macro.
// All intents that write data MUST pass through a Confirmation-Gate layer
// (no auto-save without an explicit user tap — see compliance principle D-003).
// This hook owns the microphone + transcription pipeline; the confirmation layer
// lives in useGlevAI / GlevAIChatSheet. When intent-routing is added, extend
// onTranscript to also receive an intent classification alongside the raw text,
// or add a separate onIntent callback. See docs/VOICE_ARCHITECTURE.md for details.
export function useVoxtral({ onTranscript, onPartialTranscript, onError }: UseVoxtralOptions): UseVoxtralReturn {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("");
  /**
   * Holds the AbortController for the currently in-flight transcribeWithFallback
   * call. Aborted by startListening() before any new recording begins, so a
   * stale failed request can never call onError after the user retries.
   */
  const transcribeAbortRef = useRef<AbortController | null>(null);

  /**
   * Handle for the 20s STT timeout. Cleared when transcription completes
   * normally, when the user manually aborts (new recording start), or when
   * the timer fires and calls onError itself.
   */
  const sttTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Rate-limit countdown ───────────────────────────────────────────────
  // When Mistral returns a 429, we record the timestamp when the window
  // expires and tick down a countdown every second so the UI can show
  // "Bitte X Sek. warten" and disable the mic button.
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [voiceCountdown, setVoiceCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (rateLimitUntil === null) {
      setVoiceCountdown(null);
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((rateLimitUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setVoiceCountdown(null);
        setRateLimitUntil(null);
      } else {
        setVoiceCountdown(remaining);
      }
    };
    tick(); // immediate first tick so the UI shows the value instantly
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [rateLimitUntil]);

  const handleRateLimit = useCallback((retryAfterSec: number) => {
    setRateLimitUntil(Date.now() + retryAfterSec * 1_000);
  }, []);

  const startListening = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (isListening) return;
    // Block new recordings while a rate-limit countdown is active.
    if (rateLimitUntil !== null && Date.now() < rateLimitUntil) return;

    // Abort any still-running transcription from a previous attempt.
    // This prevents the old onError from firing after the user has already
    // pressed the mic button again (retry scenario).
    if (sttTimeoutRef.current !== null) {
      clearTimeout(sttTimeoutRef.current);
      sttTimeoutRef.current = null;
    }
    if (transcribeAbortRef.current) {
      try { transcribeAbortRef.current.abort(); } catch { /* noop */ }
      transcribeAbortRef.current = null;
    }
    setIsTranscribing(false);

    // On Android the runtime RECORD_AUDIO permission must be granted before
    // getUserMedia() is called — Capacitor's WebView does not auto-prompt for
    // it the way iOS WKWebView does. Check the permission state first so we
    // can surface an actionable error immediately when the user has previously
    // denied access, and let getUserMedia trigger the first-time dialog normally
    // when the state is "prompt".
    if (typeof navigator !== "undefined" && navigator.permissions) {
      try {
        const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (perm.state === "denied") {
          onError?.(MIC_PERM_DENIED);
          return;
        }
      } catch {
        // permissions API unavailable in this environment — proceed normally
      }
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = mediaStream;
      chunksRef.current = [];

      // Prefer webm/opus (Chrome/Android); fall back to mp4 (iOS Safari /
      // WKWebView which only supports AAC-in-MP4). Empty string = browser default.
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {});
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Stop all tracks so the mic indicator light goes off
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current || "audio/webm",
        });
        chunksRef.current = [];

        // Create a fresh AbortController for this transcription run so it can
        // be cancelled if the user starts a new recording before it completes.
        const ac = new AbortController();
        transcribeAbortRef.current = ac;
        setIsTranscribing(true);

        // 20s safety timeout: if Voxtral never responds, abort and surface a
        // user-friendly error. The check `!ac.signal.aborted` ensures only one
        // of (timeout, manual abort, transcribeWithFallback error) fires onError.
        sttTimeoutRef.current = setTimeout(() => {
          sttTimeoutRef.current = null;
          if (!ac.signal.aborted) {
            ac.abort();
            onError?.(ERROR_MESSAGES.STT_TIMEOUT.de);
          }
        }, STT_TIMEOUT_MS);

        void transcribeWithFallback(
          blob,
          mimeTypeRef.current,
          onTranscript,
          onPartialTranscript,
          onError,
          ac.signal,
          handleRateLimit,
        ).finally(() => {
          // Clear the timeout on any outcome (success, error, or abort) so
          // it can never fire after the transcription has already settled.
          if (sttTimeoutRef.current !== null) {
            clearTimeout(sttTimeoutRef.current);
            sttTimeoutRef.current = null;
          }
          // Only clear isTranscribing if this is still the active request
          // (not already superseded by a new recording).
          if (transcribeAbortRef.current === ac) {
            transcribeAbortRef.current = null;
            setIsTranscribing(false);
          }
        });
      };

      // Collect in 100 ms slices
      recorder.start(100);
      setIsListening(true);
    } catch (e) {
      const isPermDenied =
        e instanceof DOMException &&
        (e.name === "NotAllowedError" || e.name === "PermissionDeniedError");
      onError?.(isPermDenied ? MIC_PERM_DENIED : e instanceof Error ? e.message : "Mikrofon nicht verfügbar");
    }
  }, [isListening, rateLimitUntil, onTranscript, onPartialTranscript, onError, handleRateLimit]);

  const stopListening = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  return { isListening, isTranscribing, startListening, stopListening, voiceCountdown };
}

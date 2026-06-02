"use client";

import { useRef, useState, useCallback } from "react";

/**
 * useVoxtral — hold-to-talk hook for GlevAIChatSheet.
 *
 * Works on web (getUserMedia) and Capacitor native shells (same API,
 * permission dialog triggered by the browser layer). No @capacitor/microphone
 * package needed — Capacitor bridges getUserMedia to the native mic on
 * both iOS (AVAudioSession) and Android (RECORD_AUDIO).
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
 */

const STT_STREAM_ROUTE = "/api/transcribe/mistral/stream";
const STT_REST_ROUTE = "/api/transcribe/mistral";

export interface UseVoxtralOptions {
  onTranscript: (text: string) => void;
  /** Optional: called with in-progress partial text while speaking (greyed out in UI). */
  onPartialTranscript?: (text: string) => void;
  onError?: (err: string) => void;
}

export interface UseVoxtralReturn {
  isListening: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

/**
 * Try SSE streaming first; fall back to single REST POST on failure.
 * Exported for unit-test access.
 */
export async function transcribeWithFallback(
  blob: Blob,
  mimeType: string,
  onTranscript: (text: string) => void,
  onPartialTranscript?: (text: string) => void,
  onError?: (err: string) => void,
): Promise<void> {
  // Derive correct extension from actual mimeType so Mistral can decode it.
  // iOS records audio/mp4 — sending it as "recording.webm" causes a 400.
  const ext = mimeType.includes("mp4") ? "m4a" : "webm";
  const filename = `recording.${ext}`;

  // ── Attempt 1: SSE streaming ────────────────────────────────────────────
  try {
    const form = new FormData();
    form.append("audio", blob, filename);

    const res = await fetch(STT_STREAM_ROUTE, { method: "POST", body: form });

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
        let event: { type: string; text?: string; error?: string };
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
          throw new Error(event.error ?? "Streaming transcription failed");
        }
      }
    }

    return; // SSE succeeded
  } catch {
    // Fall through to REST fallback below
  }

  // ── Attempt 2: REST POST fallback ───────────────────────────────────────
  try {
    const form = new FormData();
    form.append("audio", blob, filename);

    const res = await fetch(STT_REST_ROUTE, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const { text } = (await res.json()) as { text: string };
    if (text?.trim()) onTranscript(text.trim());
  } catch (e) {
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef<string>("");

  const startListening = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (isListening) return;

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

        void transcribeWithFallback(blob, mimeTypeRef.current, onTranscript, onPartialTranscript, onError);
      };

      // Collect in 100 ms slices
      recorder.start(100);
      setIsListening(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Mikrofon nicht verfügbar";
      onError?.(msg);
    }
  }, [isListening, onTranscript, onPartialTranscript, onError]);

  const stopListening = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening };
}

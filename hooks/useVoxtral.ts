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
 * Flow:
 *   startListening() → getUserMedia → MediaRecorder → collect chunks
 *   stopListening()  → stop recorder → assemble Blob → POST /api/transcribe/mistral → onTranscript(text)
 *
 * SSR-safe: returns a no-op stub when called outside a browser context.
 */

const STT_ROUTE = "/api/transcribe/mistral";

export interface UseVoxtralOptions {
  onTranscript: (text: string) => void;
  onError?: (err: string) => void;
}

export interface UseVoxtralReturn {
  isListening: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

export function useVoxtral({ onTranscript, onError }: UseVoxtralOptions): UseVoxtralReturn {
  const [isListening, setIsListening] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startListening = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (isListening) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      chunksRef.current = [];

      // Prefer webm/opus; fall back to whatever the browser supports
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all tracks so the mic indicator light goes off
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm",
        });
        chunksRef.current = [];

        try {
          const form = new FormData();
          form.append("audio", blob, "recording.webm");

          const res = await fetch(STT_ROUTE, { method: "POST", body: form });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `HTTP ${res.status}`);
          }
          const { text } = (await res.json()) as { text: string };
          if (text?.trim()) onTranscript(text.trim());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Transkription fehlgeschlagen";
          onError?.(msg);
        }
      };

      // Collect in 100 ms slices
      recorder.start(100);
      setIsListening(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Mikrofon nicht verfügbar";
      onError?.(msg);
    }
  }, [isListening, onTranscript, onError]);

  const stopListening = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening };
}

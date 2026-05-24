"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TTS_PREF_KEY = "glev_tts_enabled";

function readTTSPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(TTS_PREF_KEY);
    return v === null ? true : v !== "0";
  } catch {
    return true;
  }
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setEnabled(readTTSPref());
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
      abortRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!enabled) return;
      if (!text.trim()) return;
      stop();

      const ac = new AbortController();
      abortRef.current = ac;
      setSpeaking(true);

      try {
        const res = await fetch("/api/tts/mistral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({ text }),
        });
        if (!res.ok || ac.signal.aborted) {
          setSpeaking(false);
          return;
        }
        const blob = await res.blob();
        if (ac.signal.aborted) {
          setSpeaking(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        await audio.play();
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setSpeaking(false);
      }
    },
    [enabled, stop],
  );

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0");
      } catch { /* ignore */ }
      return next;
    });
    stop();
  }, [stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { speak, stop, speaking, enabled, toggleEnabled };
}

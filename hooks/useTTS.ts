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

/** Pick the best German voice from available voices. */
function pickGermanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  // Prefer local (not network) German voices first
  return (
    voices.find((v) => v.lang.startsWith("de") && !v.localService === false) ??
    voices.find((v) => v.lang.startsWith("de")) ??
    null
  );
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setEnabled(readTTSPref());
  }, []);

  // Pre-load voices (Chrome loads them async)
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    const onVoicesChanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!enabled || !text.trim()) return;
      stop();

      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

      // Chrome quirk: cancel() needs a tick before speak()
      await new Promise((r) => setTimeout(r, 50));

      const u = new SpeechSynthesisUtterance(text.trim());
      u.lang = "de-DE";
      u.rate = 1.05;
      u.pitch = 1.0;

      const voice = pickGermanVoice();
      if (voice) u.voice = voice;

      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        utteranceRef.current = null;
      };
      u.onerror = () => {
        setSpeaking(false);
        utteranceRef.current = null;
      };

      utteranceRef.current = u;
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [enabled, stop],
  );

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TTS_PREF_KEY, next ? "1" : "0");
      } catch { /* ignore */ }
      if (!next) stop();
      return next;
    });
  }, [stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { speak, stop, speaking, enabled, toggleEnabled };
}

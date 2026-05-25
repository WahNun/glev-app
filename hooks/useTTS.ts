"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TTS_MUTE_KEY = "glev_tts_enabled";
const TTS_AUTO_KEY = "glev_tts_auto";

/** Custom event dispatched by the Settings page when the auto-read toggle changes.
 *  `useTTS` listens for this so the in-session state updates immediately without
 *  a full remount. */
export const TTS_AUTO_EVENT = "glev:tts-auto-changed";

function readPref(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? defaultValue : v !== "0";
  } catch {
    return defaultValue;
  }
}

function writePref(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch { /* ignore */ }
}

/** Pick the best German voice from available voices. */
function pickGermanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  // Prefer local (not network) German voices first
  return (
    voices.find((v) => v.lang.startsWith("de") && v.localService) ??
    voices.find((v) => v.lang.startsWith("de")) ??
    null
  );
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  // `enabled` = master unmute (default: on)
  const [enabled, setEnabled] = useState(true);
  // `autoRead` = automatically speak AI responses (default: off)
  const [autoRead, setAutoRead] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    setEnabled(readPref(TTS_MUTE_KEY, true));
    setAutoRead(readPref(TTS_AUTO_KEY, false));
  }, []);

  // Live-sync autoRead when the Settings page dispatches the change event.
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setAutoRead(next);
    };
    window.addEventListener(TTS_AUTO_EVENT, handler);
    return () => window.removeEventListener(TTS_AUTO_EVENT, handler);
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
      writePref(TTS_MUTE_KEY, next);
      if (!next) stop();
      return next;
    });
  }, [stop]);

  const toggleAutoRead = useCallback(() => {
    setAutoRead((prev) => {
      const next = !prev;
      writePref(TTS_AUTO_KEY, next);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<boolean>(TTS_AUTO_EVENT, { detail: next }));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { speak, stop, speaking, enabled, toggleEnabled, autoRead, toggleAutoRead };
}

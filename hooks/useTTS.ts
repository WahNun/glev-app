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

function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch { /* ignore */ }
}

/** Resolve a BCP-47 language tag for speechSynthesis from the current locale cookie.
 *  Falls back to "de-DE" (Glev's primary language). */
function resolveVoiceLang(): string {
  if (typeof document === "undefined") return "de-DE";
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const locale = match?.[1];
  return locale === "en" ? "en-US" : "de-DE";
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  // `enabled` = master unmute (default: on)
  const [enabled, setEnabled] = useState(true);
  // `autoRead` = auto-play after each AI reply (default: OFF — explicit opt-in)
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

  const stop = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined") return;
      if (!enabled) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      stop();

      if (!window.speechSynthesis) return;

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = resolveVoiceLang();
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utterance.onerror = () => {
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setSpeaking(true);
    },
    [enabled, stop],
  );

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      writePref(TTS_MUTE_KEY, next);
      return next;
    });
    stop();
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

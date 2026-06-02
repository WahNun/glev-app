"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── iOS AudioContext unlock ──────────────────────────────────────────────────
// On iOS Safari / WKWebView, HTMLAudioElement.play() and Web Audio are blocked
// unless the AudioContext was resumed inside a synchronous user-gesture handler.
// Once resumed, the context stays running for the page lifetime — so we resume
// it as the very first step of speak() (before any awaits) and then decode +
// play the TTS audio through it. This bypasses iOS's autoplay policy.
let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const W = window as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = W.AudioContext ?? W.webkitAudioContext;
  if (!Ctor) return null;
  if (!_audioCtx) _audioCtx = new Ctor();
  return _audioCtx;
}

async function unlockAudioCtx(): Promise<AudioContext | null> {
  const ctx = getAudioCtx();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { /* ignore */ }
  }
  return ctx;
}

const TTS_MUTE_KEY = "glev_tts_enabled";
const TTS_AUTO_KEY = "glev_tts_auto";
const TTS_INTENT_KEY = "glev_tts_intent";
export const TTS_SPEED_KEY = "glev_tts_speed";

export type TtsSpeed = "slow" | "normal" | "fast";

/** Custom event dispatched by the Settings page when the auto-read toggle changes.
 *  `useTTS` listens for this so the in-session state updates immediately without
 *  a full remount. */
export const TTS_AUTO_EVENT = "glev:tts-auto-changed";

/** Custom event dispatched by the Settings page when the speed setting changes. */
export const TTS_SPEED_EVENT = "glev:tts-speed-changed";

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

function readSpeed(): TtsSpeed {
  if (typeof window === "undefined") return "normal";
  try {
    const v = window.localStorage.getItem(TTS_SPEED_KEY);
    if (v === "slow" || v === "fast") return v;
    return "normal";
  } catch {
    return "normal";
  }
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

/**
 * Guard: extract only clean assistant-response text before passing to TTS.
 *
 * Prevents persona-leak: the Mistral model may occasionally echo fragments of
 * its system-prompt or tool-result content in the token stream. This function
 * strips lines that match known system-prompt patterns so the TTS layer never
 * reads internal instructions aloud.
 *
 * Heuristics (conservative — prefer false-negatives over silencing real replies):
 * 1. Lines that are pure markdown headings (## …) — the system prompt prohibits
 *    them, so if one appears it is almost certainly a system-prompt echo.
 * 2. Lines starting with "Strikte Grenzen" or "Deine Aufgabe" — top-level
 *    persona anchors in GLEV_CHAT_SYSTEM_PROMPT.
 * 3. Lines starting with "Tools (" — the tool-listing section header.
 * 4. Cap output at 600 chars — long outputs are likely tool data, not speech.
 *
 * Exported for unit tests.
 */
export function extractAssistantText(text: string): string {
  const STRIP_PREFIXES = [
    "strikte grenzen",
    "deine aufgabe",
    "tools (",
    "write-tools",
    "read-tools",
    "user-memory",
  ];

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      // Drop markdown headings (##, ###, etc.)
      if (/^#{1,6}\s/.test(l)) return false;
      const lower = l.toLowerCase();
      if (STRIP_PREFIXES.some((p) => lower.startsWith(p))) return false;
      return true;
    });

  const cleaned = lines.join(" ").replace(/\s{2,}/g, " ").trim();
  // Soft cap: TTS sounds bad on very long texts anyway (> ~600 chars).
  return cleaned.length > 600 ? cleaned.slice(0, 600).trimEnd() + " …" : cleaned;
}

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  /** ID of the message currently being spoken, or null when idle. */
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // `enabled` = master unmute (default: on)
  const [enabled, setEnabled] = useState(true);
  // `autoRead` = automatically speak AI responses (default: off)
  const [autoRead, setAutoRead] = useState(false);
  // `intentAnnounce` = read classified voice intent aloud before chip appears (default: off)
  const [intentAnnounce, setIntentAnnounce] = useState(false);
  // `speed` = TTS playback speed preference
  const [speed, setSpeedState] = useState<TtsSpeed>("normal");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // For Mistral TTS via AudioContext (replaces HTMLAudioElement to fix iOS autoplay)
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    setEnabled(readPref(TTS_MUTE_KEY, true));
    setAutoRead(readPref(TTS_AUTO_KEY, false));
    setIntentAnnounce(readPref(TTS_INTENT_KEY, false));
    setSpeedState(readSpeed());
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

  // Live-sync speed when the Settings page dispatches the change event.
  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<TtsSpeed>).detail;
      setSpeedState(next);
    };
    window.addEventListener(TTS_SPEED_EVENT, handler);
    return () => window.removeEventListener(TTS_SPEED_EVENT, handler);
  }, []);

  // Pre-load voices (Chrome loads them async)
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    const onVoicesChanged = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
  }, []);

  // Proactively unlock the AudioContext on the very first user interaction
  // (touch or click anywhere in the app). This ensures the context is already
  // running when autoRead fires after an AI response — which happens outside a
  // gesture window. Capacitor WKWebView allows new Audio().play() without a
  // gesture, but AudioContext.resume() requires at least one prior user interaction.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = () => {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    };
    window.addEventListener("touchstart", unlock, { once: true, passive: true });
    window.addEventListener("click", unlock, { once: true });
    return () => {
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("click", unlock);
    };
  }, []);

  const stop = useCallback(() => {
    // Stop Mistral AudioContext source if playing
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch { /* already stopped */ }
      sourceNodeRef.current = null;
    }
    // Stop Web Speech fallback
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeaking(false);
    setSpeakingId(null);
  }, []);

  /** Map TtsSpeed enum to a playback-rate float. */
  function speedToFloat(s: TtsSpeed): number {
    if (s === "slow") return 0.75;
    if (s === "fast") return 1.3;
    return 1.0;
  }

  /** Web Speech API fallback — used when Mistral TTS is unavailable. */
  const speakWebSpeech = useCallback(
    (text: string, id?: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

      const u = new SpeechSynthesisUtterance(text.trim());
      u.lang = "de-DE";
      u.rate = speedToFloat(speedRef.current);
      u.pitch = 1.0;

      const voice = pickGermanVoice();
      if (voice) u.voice = voice;

      u.onstart = () => { setSpeaking(true); setSpeakingId(id ?? null); };
      u.onend = () => { setSpeaking(false); setSpeakingId(null); utteranceRef.current = null; };
      u.onerror = () => { setSpeaking(false); setSpeakingId(null); utteranceRef.current = null; };

      utteranceRef.current = u;
      setSpeaking(true);
      setSpeakingId(id ?? null);
      window.speechSynthesis.speak(u);
    },
    [],
  );

  // Keep a stable ref to current speed so the speak() callback doesn't
  // need speed in its dep array (which would recreate it on every user pref change).
  const speedRef = useRef<TtsSpeed>(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const speak = useCallback(
    async (text: string, id?: string) => {
      if (!enabled || !text.trim()) return;
      stop();

      // Apply persona-leak guard: strip any system-prompt fragments before TTS.
      // This is the single chokepoint for all TTS calls (chat sheet auto-read,
      // per-bubble manual play) — centralised here so the engine/macro screen
      // and any future caller automatically benefit without separate guards.
      const clean = extractAssistantText(text);
      if (!clean) return;

      // ── Mistral Voxtral TTS (primary) ────────────────────────────────────
      // iOS fix: unlock AudioContext BEFORE the first await so we're still
      // inside the user-gesture activation window. Once resumed, the context
      // stays running for the page lifetime — audio.play() calls after async
      // network fetches succeed because they go through AudioContext, not
      // HTMLAudioElement (which iOS blocks after gesture chain is broken).
      const audioCtx = await unlockAudioCtx();

      try {
        const res = await fetch("/api/tts/mistral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: clean,
            speed: speedRef.current,
          }),
          signal: AbortSignal.timeout(12_000),
        });

        if (res.ok && audioCtx) {
          const arrayBuffer = await res.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = speedToFloat(speedRef.current);
          source.connect(audioCtx.destination);

          sourceNodeRef.current = source;

          source.onended = () => {
            setSpeaking(false);
            setSpeakingId(null);
            sourceNodeRef.current = null;
          };

          setSpeaking(true);
          setSpeakingId(id ?? null);
          source.start(0);
          return; // success — skip Web Speech below
        }
      } catch {
        // Network error, timeout, decode error → fall through to Web Speech
      }

      // ── Web Speech API (fallback) ─────────────────────────────────────────
      // Chrome quirk: cancel() needs a tick before speak()
      await new Promise((r) => setTimeout(r, 50));
      speakWebSpeech(clean, id);
    },
    [enabled, stop, speakWebSpeech],
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

  const toggleIntentAnnounce = useCallback(() => {
    setIntentAnnounce((prev) => {
      const next = !prev;
      writePref(TTS_INTENT_KEY, next);
      return next;
    });
  }, []);

  const setSpeed = useCallback((next: TtsSpeed) => {
    setSpeedState(next);
    try { window.localStorage.setItem(TTS_SPEED_KEY, next); } catch { /* ignore */ }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<TtsSpeed>(TTS_SPEED_EVENT, { detail: next }));
    }
  }, []);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { speak, stop, speaking, speakingId, enabled, toggleEnabled, autoRead, toggleAutoRead, intentAnnounce, toggleIntentAnnounce, speed, setSpeed };
}

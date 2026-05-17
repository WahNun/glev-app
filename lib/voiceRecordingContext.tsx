"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

/**
 * Cross-screen bridge for the Engine voice-recording flow.
 *
 * Why this exists: the recording itself lives on /engine (it owns the
 * MediaRecorder, the transcript state, the AI parse pipeline), but the
 * "stop" control now lives in the global mobile bottom-nav Glev FAB
 * (per the 2026-05-17 UX revision). Likewise, while a recording is
 * active, the global header shows a "Speak" pill so the user always
 * has a visible cue + a fallback stop affordance even when scrolled
 * away from Step 1. Both of those live OUTSIDE the engine page, so
 * the engine page registers itself here on mount and the chrome reads
 * `recording` + calls `requestStop()` without importing engine code.
 *
 * The `hasSpoken` flag flips to true after the user has completed at
 * least one voice take in the current session (set by the engine page
 * when MediaRecorder.onstop fires with non-empty audio). The FAB
 * uses this to switch its short-tap behaviour: before the first take,
 * a short tap on the FAB opens the quick-add sheet (the user needs to
 * discover the entry-points); after at least one take, a short tap
 * jumps straight back into a fresh voice take while long-pressing the
 * FAB always opens the quick-add sheet as the secondary menu.
 *
 * Safe no-op fallback in the hook: components rendered outside the
 * provider (unit tests, marketing/landing surfaces) get a dead stub
 * instead of throwing.
 */
export interface VoiceRecordingState {
  recording: boolean;
  setRecording: (v: boolean) => void;
  registerStopHandler: (h: () => void) => void;
  unregisterStopHandler: () => void;
  requestStop: () => void;
  hasSpoken: boolean;
  markSpoken: () => void;
}

const Ctx = createContext<VoiceRecordingState | null>(null);

export function VoiceRecordingProvider({ children }: { children: ReactNode }) {
  const [recording, setRecording] = useState(false);
  const [hasSpoken, setHasSpoken] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const registerStopHandler = useCallback((h: () => void) => {
    stopRef.current = h;
  }, []);
  const unregisterStopHandler = useCallback(() => {
    stopRef.current = null;
  }, []);
  const requestStop = useCallback(() => {
    stopRef.current?.();
  }, []);
  const markSpoken = useCallback(() => {
    setHasSpoken(true);
  }, []);

  return (
    <Ctx.Provider value={{
      recording, setRecording,
      registerStopHandler, unregisterStopHandler, requestStop,
      hasSpoken, markSpoken,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useVoiceRecording(): VoiceRecordingState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      recording: false,
      setRecording: () => {},
      registerStopHandler: () => {},
      unregisterStopHandler: () => {},
      requestStop: () => {},
      hasSpoken: false,
      markSpoken: () => {},
    };
  }
  return ctx;
}

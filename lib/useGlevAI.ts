"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * useGlevAI — owns everything the Glev AI button + consent modal +
 * chat sheet need:
 *   - consent status (loaded once at mount from `profiles.ai_consent_at`)
 *   - modal/sheet open state
 *   - conversation history in sessionStorage capped at 10 messages
 *   - streaming fetch to /api/ai/chat (token-append into the active
 *     assistant bubble via ReadableStream)
 *
 * SSR-safe: all browser-only access (sessionStorage, fetch, supabase)
 * runs inside effects/handlers, never at module/render time.
 *
 * `openFromButton()` is the entry point the floating Glev AI button
 * calls. It opens the consent modal on first tap (when consent has
 * not been granted) and goes straight to the chat sheet thereafter.
 */
export type GlevChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
};

export type ContextSnapshot = {
  glucoseSummary: string;
  iobSummary: string;
  lastMealDescription: string;
};

const HISTORY_KEY = "glev_ai_history_v1";
const MAX_HISTORY = 10;

// Dummy contextSnapshot fallbacks — Phase 2 ships these until a
// follow-up wires real CGM / IOB / last-meal data into the hook. The
// exact strings are spec-prescribed.
const DUMMY_CONTEXT: ContextSnapshot = {
  glucoseSummary: "Letzter Wert vor 12 Min: 142 mg/dL (stabil)",
  iobSummary: "≈ 1.4 IE aus dem letzten Bolus (vor 35 Min)",
  lastMealDescription: "Letzte Mahlzeit vor 1 h 10 Min — 45g Kohlenhydrate",
};

function safeReadHistory(): GlevChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (m: unknown): m is GlevChatMessage =>
          !!m &&
          typeof m === "object" &&
          (((m as GlevChatMessage).role === "user") || ((m as GlevChatMessage).role === "assistant")) &&
          typeof (m as GlevChatMessage).content === "string",
      )
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function safeWriteHistory(history: GlevChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = history.slice(-MAX_HISTORY).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota / privacy errors */
  }
}

let _idSeed = 0;
function nextId(): string {
  _idSeed += 1;
  return `glev-ai-${Date.now()}-${_idSeed}`;
}

export function useGlevAI(opts?: { contextSnapshot?: ContextSnapshot }) {
  const [consentGranted, setConsentGranted] = useState<boolean>(false);
  const [consentLoaded, setConsentLoaded] = useState<boolean>(false);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<GlevChatMessage[]>([]);
  const [streaming, setStreaming] = useState<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load consent + sessionStorage history once on mount.
  useEffect(() => {
    setMessages(safeReadHistory());
    let cancelled = false;
    (async () => {
      try {
        if (!supabase) {
          if (!cancelled) setConsentLoaded(true);
          return;
        }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setConsentLoaded(true);
          return;
        }
        const { data } = await supabase
          .from("profiles")
          .select("ai_consent_at")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) {
          setConsentGranted(Boolean(data?.ai_consent_at));
          setConsentLoaded(true);
        }
      } catch {
        if (!cancelled) setConsentLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist messages every time they change. We strip `isStreaming` so
  // a half-finished assistant turn replays as a stable final bubble on
  // the next mount (rare edge case — usually the sheet stays open).
  useEffect(() => {
    safeWriteHistory(messages);
  }, [messages]);

  /** Floating button entry — modal if not consented, sheet if consented. */
  const openFromButton = useCallback(() => {
    if (consentGranted) {
      setSheetOpen(true);
    } else {
      setModalOpen(true);
    }
  }, [consentGranted]);

  /** Modal "Nicht jetzt" — just close, do not write. */
  const dismissConsent = useCallback(() => {
    setModalOpen(false);
  }, []);

  /** Modal "Aktivieren →" — write consent, then open sheet. */
  const grantConsent = useCallback(async () => {
    // Optimistic UI: flip immediately so the sheet opens without flash.
    setConsentGranted(true);
    setModalOpen(false);
    setSheetOpen(true);
    try {
      const res = await fetch("/api/ai/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`consent failed: ${res.status}`);
    } catch (e) {
      // Roll back the local flip on failure so the next tap retries.
      // eslint-disable-next-line no-console
      console.warn("[GlevAI] consent grant failed:", e);
      setConsentGranted(false);
      // Leave the sheet open — the user can still type, but the next
      // send will get a 403 and we'll surface a soft error there.
    }
  }, []);

  /** Settings "Glev AI" toggle off — DELETEs consent server-side,
   * clears the sessionStorage chat history, drops any in-memory
   * messages, and flips local state so the next floating-button tap
   * re-shows the consent modal. Safe to call multiple times — the
   * DELETE handler is idempotent.
   *
   * The Settings page calls this directly (when the toggle is its
   * own hook instance) AND dispatches a window event so the Layout-
   * mounted hook instance picks the same change up without a
   * navigation. See the `glev:ai-consent-revoked` listener below. */
  const revokeConsent = useCallback(async () => {
    // Cancel any in-flight stream before we wipe the bubbles it's
    // appending into.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
      abortRef.current = null;
    }
    setStreaming(false);
    setMessages([]);
    setSheetOpen(false);
    setModalOpen(false);
    setConsentGranted(false);
    if (typeof window !== "undefined") {
      try { window.sessionStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    }
    try {
      await fetch("/api/ai/consent", { method: "DELETE" });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[GlevAI] consent revoke failed:", e);
    }
  }, []);

  // Cross-instance bridge: Settings page mounts its own light
  // tracker for the toggle, and dispatches these events so the
  // Layout-mounted hook instance (which owns the modal + sheet)
  // stays in sync without a full route remount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onRevoked = () => {
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch { /* noop */ }
        abortRef.current = null;
      }
      setStreaming(false);
      setMessages([]);
      setSheetOpen(false);
      setModalOpen(false);
      setConsentGranted(false);
      try { window.sessionStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    };
    const onOpenModal = () => {
      setModalOpen(true);
    };
    window.addEventListener("glev:ai-consent-revoked", onRevoked);
    window.addEventListener("glev:ai-open-consent-modal", onOpenModal);
    return () => {
      window.removeEventListener("glev:ai-consent-revoked", onRevoked);
      window.removeEventListener("glev:ai-open-consent-modal", onOpenModal);
    };
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    // Cancel any in-flight stream so the next open doesn't show a stuck
    // ··· bubble.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
      abortRef.current = null;
    }
    setStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
    );
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      const userMsg: GlevChatMessage = {
        id: nextId(),
        role: "user",
        content: trimmed,
      };
      const assistantId = nextId();
      const assistantMsg: GlevChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      // Snapshot history-for-API BEFORE appending the new user turn so
      // we don't double-count it (the API also receives `message`
      // separately).
      const apiHistory = messages
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            message: trimmed,
            history: apiHistory,
            contextSnapshot: opts?.contextSnapshot ?? DUMMY_CONTEXT,
            // Device-local IANA timezone — single source of truth for
            // alle Zeit-Formatierungen in den AI-Tools. Wir trauen dem
            // Profil-Feld bewusst nicht, weil Nutzer reisen und das
            // gespeicherte Setting dann veraltet ist. Fallback auf
            // Europe/Berlin im Server, falls Intl mal kein TZ liefert.
            timezone:
              (typeof Intl !== "undefined" &&
                Intl.DateTimeFormat().resolvedOptions().timeZone) ||
              null,
          }),
        });
        if (!res.ok || !res.body) {
          const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(errBody?.error || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        while (!done) {
          const { value, done: d } = await reader.read();
          done = d;
          if (value) buffer += decoder.decode(value, { stream: !done });
          // Parse `data: <payload>\n\n` frames from the buffer.
          let nlnl: number;
          while ((nlnl = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, nlnl);
            buffer = buffer.slice(nlnl + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice("data:".length).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload) as { token?: string; error?: string };
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.token) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + parsed.token }
                      : m,
                  ),
                );
              }
            } catch {
              /* ignore malformed frames */
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Anfrage fehlgeschlagen";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content || `Da ist etwas schiefgelaufen: ${msg}`,
                  isStreaming: false,
                }
              : m,
          ),
        );
      } finally {
        setStreaming(false);
        abortRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m,
          ),
        );
      }
    },
    [messages, streaming, opts?.contextSnapshot],
  );

  return {
    consentGranted,
    consentLoaded,
    modalOpen,
    sheetOpen,
    messages,
    streaming,
    openFromButton,
    dismissConsent,
    grantConsent,
    revokeConsent,
    closeSheet,
    sendMessage,
  };
}

export const __test__ = {
  DUMMY_CONTEXT,
  HISTORY_KEY,
  MAX_HISTORY,
};

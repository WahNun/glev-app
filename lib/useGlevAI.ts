"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { scheduleCheckReminder } from "@/lib/mealCheckReminders";

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
/**
 * State machine for an inline confirm/cancel widget attached to an
 * assistant bubble (Phase 3 Task 2). Set when the server emits a
 * `pending_action` SSE frame after a WRITE-tool call.
 *
 *   pending    → user has not tapped yet; show Bestätigen + Abbrechen.
 *   confirming → POST /api/ai/confirm-action in flight; buttons disabled.
 *   confirmed  → server accepted (200 ok), inline „✓ Gespeichert".
 *   cancelled  → user tapped Abbrechen; inline „Abgebrochen".
 *   error      → server returned !ok / 4xx / 5xx; inline error string.
 */
export type PendingActionState =
  | "pending"
  | "confirming"
  | "confirmed"
  | "cancelled"
  | "error";

export type PendingAction = {
  token: string;
  kind: string;
  summary: string;
  state: PendingActionState;
  error?: string;
};

export type GlevChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  /** Confirm/cancel widget under the bubble, only set on assistant
   *  bubbles that came back from a WRITE-tool call. */
  pendingAction?: PendingAction;
};

export type ContextSnapshot = {
  /** Active screen name — forwarded to the API so the preamble can
   *  note which view the user has open. Optional; non-dashboard
   *  screens send no live data. */
  screen?: string;
  /** Current glucose reading + trend (consent-gated). */
  glucoseSummary?: string;
  /** Active insulin-on-board summary (consent-gated). */
  iobSummary?: string;
  /** Last meal description + carbs + time ago (always included when
   *  AI consent is granted — no separate toggle per D-016). */
  lastMealDescription?: string;
  /** Alias for lastMealDescription produced by useScreenContext. Takes
   *  priority over lastMealDescription in sendMessage. */
  lastMealSummary?: string;
};

const HISTORY_KEY = "glev_ai_history_v1";
const MAX_HISTORY = 10;

const NEUTRAL = "Keine Daten verfügbar";

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

export function useGlevAI(opts?: {
  contextSnapshot?: ContextSnapshot;
  onNavigate?: (path: string) => void;
}) {
  const [consentGranted, setConsentGranted] = useState<boolean>(false);
  const [consentLoaded, setConsentLoaded] = useState<boolean>(false);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [sheetOpen, setSheetOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<GlevChatMessage[]>([]);
  const [streaming, setStreaming] = useState<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);
  // Keep a ref to the latest opts so sendMessage always reads the current
  // contextSnapshot without needing opts?.contextSnapshot in its dep array.
  // Including an inline object in useCallback deps would recreate sendMessage
  // on every render (opts = { contextSnapshot: screenCtx } is a new object
  // each time Layout renders), which propagates unnecessary re-renders.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

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

  /** Clear the chat history — wipes sessionStorage + in-memory messages. */
  const clearMessages = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
      abortRef.current = null;
    }
    setStreaming(false);
    setMessages([]);
    if (typeof window !== "undefined") {
      try { window.sessionStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    }
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
            contextSnapshot: {
              screen:              optsRef.current?.contextSnapshot?.screen,
              glucoseSummary:      optsRef.current?.contextSnapshot?.glucoseSummary      ?? NEUTRAL,
              iobSummary:          optsRef.current?.contextSnapshot?.iobSummary          ?? NEUTRAL,
              lastMealDescription:
                optsRef.current?.contextSnapshot?.lastMealSummary ??
                optsRef.current?.contextSnapshot?.lastMealDescription ??
                NEUTRAL,
            },
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
              const parsed = JSON.parse(payload) as {
                token?: string;
                error?: string;
                navigate?: string;
                set_macro?: { field: string; value: number };
                pending_action?: {
                  token: string;
                  kind: string;
                  summary: string;
                };
                meal_prep?: {
                  input_text: string;
                  carbs: number;
                  protein: number | null;
                  fat: number | null;
                  fiber: number | null;
                };
              };
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.navigate) {
                optsRef.current?.onNavigate?.(parsed.navigate);
              }
              if (parsed.meal_prep && typeof window !== "undefined") {
                // Store macros in sessionStorage so the engine page can
                // read them on mount (navigation is async — CustomEvents
                // would fire before the page is ready).
                try {
                  sessionStorage.setItem(
                    "glev_pending_meal",
                    JSON.stringify(parsed.meal_prep),
                  );
                } catch { /* sessionStorage may be unavailable */ }
                optsRef.current?.onNavigate?.("/engine");
              }
              // Phase 2: set_macro — dispatched as a CustomEvent so the
              // active engine-macros screen can update its local state
              // without needing a direct React ref. The tool server-side
              // emits { set_macro: { field, value } }; here we forward it
              // to whichever component is listening on the window.
              if (parsed.set_macro && typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("glev:set-macro", { detail: parsed.set_macro }),
                );
              }
              if (parsed.pending_action) {
                // WRITE-tool result: attach the confirm/cancel widget to
                // the currently streaming assistant bubble. The bubble's
                // own text continues to stream in parallel (Mistral
                // writes a short „Soll ich das so speichern?"-Satz).
                const pa = parsed.pending_action;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          pendingAction: {
                            token: pa.token,
                            kind: pa.kind,
                            summary: pa.summary,
                            state: "pending",
                          },
                        }
                      : m,
                  ),
                );
              }
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
    // opts?.contextSnapshot is read via optsRef.current inside the fn — no dep needed.
    [messages, streaming],
  );

  /**
   * Confirm a pending WRITE-action by posting its token to
   * /api/ai/confirm-action. Idempotent on the server (used_at guard);
   * we also short-circuit locally if the widget is no longer "pending".
   */
  const confirmAction = useCallback(async (messageId: string) => {
    let token: string | null = null;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.pendingAction) return m;
        if (m.pendingAction.state !== "pending") return m;
        token = m.pendingAction.token;
        return {
          ...m,
          pendingAction: { ...m.pendingAction, state: "confirming" },
        };
      }),
    );
    if (!token) return;

    try {
      const res = await fetch("/api/ai/confirm-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        const msg =
          (body && typeof body.error === "string" && body.error) ||
          `HTTP ${res.status}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.pendingAction
              ? {
                  ...m,
                  pendingAction: { ...m.pendingAction, state: "error", error: msg },
                }
              : m,
          ),
        );
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.pendingAction
            ? {
                ...m,
                pendingAction: { ...m.pendingAction, state: "confirmed" },
              }
            : m,
        ),
      );
      // For add_timeline_check: arm a local OS reminder. Best-effort —
      // a failed schedule must never block the confirmation success state.
      const sr = body?.scheduleReminder;
      if (
        body?.kind === "add_timeline_check" &&
        sr &&
        typeof sr.mealId === "string" &&
        typeof sr.checkType === "string" &&
        typeof sr.plannedAt === "string" &&
        typeof sr.title === "string" &&
        typeof sr.body === "string"
      ) {
        scheduleCheckReminder({
          mealId: sr.mealId,
          checkType: sr.checkType,
          plannedAt: sr.plannedAt,
          title: sr.title,
          body: sr.body,
        }).catch(() => {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.pendingAction
            ? {
                ...m,
                pendingAction: { ...m.pendingAction, state: "error", error: msg },
              }
            : m,
        ),
      );
    }
  }, []);

  /**
   * Cancel a pending WRITE-action locally. Leaves the row to expire on
   * its own (TTL 5 min) — no server roundtrip needed because the
   * confirm endpoint won't be called.
   */
  const cancelAction = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.pendingAction) return m;
        if (m.pendingAction.state !== "pending") return m;
        return {
          ...m,
          pendingAction: { ...m.pendingAction, state: "cancelled" },
        };
      }),
    );
  }, []);

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
    clearMessages,
    sendMessage,
    confirmAction,
    cancelAction,
  };
}

export const __test__ = {
  NEUTRAL,
  HISTORY_KEY,
  MAX_HISTORY,
};

"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { supabase } from "@/lib/supabase";
import { scheduleCheckReminder } from "@/lib/mealCheckReminders";
import { getActionNavConfig } from "@/lib/ai/pendingActions";
import type { ParsedFood } from "@/lib/meals";
import { getUserFriendlyMessage, isRetryAllowed } from "@/lib/ai/errorMessages";
import { readLocaleCookie } from "@/lib/locale";
import type { AppErrorCode } from "@/lib/ai/errors";
import { ALL_ERROR_CODES } from "@/lib/ai/errors";

// ── Slow-response UI timer ─────────────────────────────────────────────
// After this many ms with no streaming response, the hook sets `isSlow`
// so the chat sheet can show "Glev braucht etwas länger…" while the
// user waits. Cleared when the stream ends or an error is received.
const SLOW_WARNING_MS = 15_000;

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
  | "engine_opened"  // meal chip: navigated to Engine, save not yet confirmed
  | "cancelled"
  | "error";

export type PendingAction = {
  token: string;
  kind: string;
  summary: string;
  state: PendingActionState;
  error?: string;
  /** Tool params forwarded from the SSE frame so the "Detail →"
   *  button can pre-populate the matching log form without an extra
   *  server round-trip. Written to sessionStorage by navigateToLogScreen. */
  payload?: unknown;
};

/**
 * Narrowed payload shape for `log_meal_entry` PendingActions.
 * Phase 2: items[] with DB-resolved sources.
 * Phase 3: meal_prep_id for optimistic refinement subscription.
 */
export type MealPendingPayload = {
  input_text:     string;
  carbs_grams:    number;
  protein_grams:  number | null;
  fat_grams:      number | null;
  fiber_grams:    number | null;
  logged_at:      string;
  glucose_before: number | null;
  /** Stable ID used to subscribe to meal_prep_refinements Realtime channel. */
  meal_prep_id?:  string;
  /** Top-level nutrition source from the aggregator pipeline. */
  nutritionSource?: string;
  /** Per-item breakdown with resolved sources. Present when aggregator ran. */
  items?:         ParsedFood[];
  /** Total alcohol in grams across all items — triggers Dual-Emission. */
  total_alcohol_g?: number;
  /** Token of the linked influence PendingAction (if Dual-Emission fired). */
  linked_influence_token?: string;
  /**
   * True when the AI was given an explicit time by the user ("vor 3 Minuten",
   * "um 13:30", etc.) and resolved it to a non-now logged_at.
   * False / absent = meal was logged at the current moment — the Engine wizard
   * must NOT treat the fixed timestamp as historical even if the chip is tapped
   * more than 2 minutes after the message was created.
   */
  meal_time_explicit?: boolean;
};

/** Payload for an auto-generated alcohol influence PendingAction. */
export type InfluencePrepPayload = {
  influence_type:        "alcohol";
  alcohol_g:             number;
  /** Token of the linked meal PendingAction. */
  source_meal_token:     string;
  note:                  string;
  logged_at:             string;
};

export type GlevChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  /** Set when this bubble shows an error that the user can retry.
   *  True only for transient errors (network, rate-limit, upstream). */
  retryAllowed?: boolean;
  /** Confirm/cancel widgets under the bubble — one per WRITE-tool call.
   *  Multi-entry turns (e.g. exercise + symptom in one message) produce
   *  multiple chips, each confirmed or cancelled independently. */
  pendingActions?: PendingAction[];
};

/** One meal waiting for the user to tap through to the Engine screen.
 *  Multiple meals in a single turn (e.g. "Haribo AND Croissant") are
 *  stored as a queue so neither overwrites the other in sessionStorage. */
export type MealQueueItem = {
  mealPrep: {
    input_text: string;
    carbs: number;
    protein: number | null;
    fat: number | null;
    fiber: number | null;
    /** ISO-8601 meal time (with UTC offset) set by the AI when the user
     *  named a historical time ("vor 3 Minuten"). Absent = treat as now. */
    meal_time?: string;
    /** Top-level nutrition source from the aggregator pipeline. */
    nutritionSource?: string;
  };
  /** Display label derived from input_text (max 40 chars). */
  label: string;
  /** pending_action token that corresponds to this meal, used to link
   *  the in-chat chip directly to the meal data without a second lookup. */
  token?: string;
};

/** AI processing state for FAB animation binding. */
export type AIState = "idle" | "thinking" | "speaking";

/** Attachment resolved from /api/ai/upload (signed URL + metadata). */
export type ChatAttachment = {
  url: string;
  mimeType: string;
  fileName: string;
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

const HISTORY_KEY = "glev_ai_history_v2";
const MAX_HISTORY = 10;

const NEUTRAL = "Keine Daten verfügbar";

function safeReadHistory(): GlevChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
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
    const trimmed = history.slice(-MAX_HISTORY).map((m) => {
      const base = { id: m.id, role: m.role, content: m.content };
      if (!m.pendingActions?.length) return base;
      // Persist non-terminal chips so they survive session restores (app
      // backgrounded on iOS, page refresh). Normalize confirming → pending
      // because mid-flight confirms have unknown outcome after reload.
      const actions = m.pendingActions
        .filter((a) => a.state !== "cancelled" && a.state !== "confirmed")
        .map((a) => ({
          ...a,
          state: (a.state === "confirming" ? "pending" : a.state) as PendingActionState,
        }));
      return actions.length ? { ...base, pendingActions: actions } : base;
    });
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
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
  /** True when the consent modal was triggered by an external event
   *  (Settings toggle) rather than by the floating FAB button.
   *  Used in grantConsent() to skip setSheetOpen(true) — the user is
   *  on the Settings page and should NOT be transported to the chat. */
  const consentFromExternalRef = useRef(false);
  /** idle → thinking on send, thinking → idle when stream ends.
   *  speaking is set externally by the TTS player via setAiState. */
  const [aiState, setAiState] = useState<AIState>("idle");
  /** Populated by the TTS player on audio start so the FAB can read
   *  frequency data for amplitude-reactive animation. */
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  // Slow-response warning: true after SLOW_WARNING_MS with no stream end.
  const [isSlow, setIsSlow] = useState<boolean>(false);
  // Rate-limit countdown: seconds remaining before the auto-retry fires.
  // null = no countdown active.
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number | null>(null);
  // Stores the user message queued for auto-retry after a 429 countdown.
  const autoRetryMsgRef = useRef<string | null>(null);
  // Tracks how many auto-retries have been attempted for the current 429
  // bubble so we show the manual retry button after one failed auto-retry.
  const autoRetryAttemptRef = useRef<number>(0);
  // Collects meal_prep items that arrive mid-stream. We must NOT write
  // to sessionStorage immediately because multiple meals in one turn
  // (e.g. "Haribo AND Croissant") would overwrite each other. After
  // the stream ends this ref is flushed into state as an ordered queue.
  const pendingMealQueueRef = useRef<MealQueueItem[]>([]);
  // Tap-chip queue: user works through meals one at a time. Each call
  // to fireMealNav() pops the first item, writes its macros into
  // sessionStorage, and navigates to /engine.
  const [pendingMealNavQueue, setPendingMealNavQueue] = useState<MealQueueItem[]>([]);
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
    // FAB tap = user-initiated, not from Settings — mark accordingly so
    // grantConsent() opens the sheet as expected.
    consentFromExternalRef.current = false;
    if (consentGranted) {
      setSheetOpen(true);
    } else {
      setModalOpen(true);
    }
  }, [consentGranted]);

  /** Modal "Nicht jetzt" — just close, do not write. */
  const dismissConsent = useCallback(() => {
    consentFromExternalRef.current = false;
    setModalOpen(false);
  }, []);

  /** Modal "Aktivieren →" — write consent, then open sheet.
   *  When the modal was triggered by the Settings toggle (consentFromExternalRef=true),
   *  the sheet is NOT opened — the user stays on the Settings page. */
  const grantConsent = useCallback(async () => {
    // Capture and reset the external-trigger flag atomically.
    const fromExternal = consentFromExternalRef.current;
    consentFromExternalRef.current = false;

    // Optimistic UI: flip immediately so the sheet opens without flash.
    setConsentGranted(true);
    setModalOpen(false);
    // Only open the sheet when the user tapped the FAB — not when they
    // toggled AI back ON from the Settings page (they should stay there).
    if (!fromExternal) {
      setSheetOpen(true);
    }
    try {
      const res = await fetch("/api/ai/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`consent failed: ${res.status}`);
      // Notify other instances (e.g. Settings page) that consent was granted,
      // mirroring the existing "glev:ai-consent-revoked" pattern.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("glev:ai-consent-granted"));
      }
    } catch (e) {
      // Roll back the local flip on failure so the next tap retries.
      // eslint-disable-next-line no-console
      console.warn("[GlevAI] consent grant failed:", e);
      setConsentGranted(false);
      if (!fromExternal) setSheetOpen(false);
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
      try { window.localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
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
      try { window.localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    };
    const onOpenModal = () => {
      // Triggered by Settings toggle — mark so grantConsent() skips setSheetOpen.
      consentFromExternalRef.current = true;
      setModalOpen(true);
    };
    window.addEventListener("glev:ai-consent-revoked", onRevoked);
    window.addEventListener("glev:ai-open-consent-modal", onOpenModal);
    return () => {
      window.removeEventListener("glev:ai-consent-revoked", onRevoked);
      window.removeEventListener("glev:ai-open-consent-modal", onOpenModal);
    };
  }, []);

  /** Clear the chat history — wipes localStorage + in-memory messages + pending meal queue. */
  const clearMessages = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
      abortRef.current = null;
    }
    setStreaming(false);
    setMessages([]);
    setPendingMealNavQueue([]);
    pendingMealQueueRef.current = [];
    if (typeof window !== "undefined") {
      try { window.localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
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

  // ── 429-countdown auto-retry effect ──────────────────────────────────
  // When rateLimitCountdown is set after the first MISTRAL_RATE_LIMITED
  // hit, this effect ticks it down every second and fires the auto-retry
  // once it reaches zero. The retry counter (autoRetryAttemptRef) ensures
  // we only auto-retry once — a second failure shows the manual button.
  useEffect(() => {
    if (rateLimitCountdown === null || rateLimitCountdown <= 0) {
      if (rateLimitCountdown === 0 && autoRetryMsgRef.current) {
        const msg = autoRetryMsgRef.current;
        autoRetryMsgRef.current = null;
        setRateLimitCountdown(null);
        sendMessageRef.current(msg);
      }
      return;
    }
    const id = setTimeout(() => {
      setRateLimitCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1_000);
    return () => clearTimeout(id);
  }, [rateLimitCountdown]);

  // Listen for glev:meal-ai-saved (dispatched by the Engine page after saveMeal).
  // Transitions all engine_opened chips to confirmed and clears the meal nav queue.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setMessages((prev) =>
        prev.map((m) => ({
          ...m,
          pendingActions: m.pendingActions?.map((pa) =>
            pa.state === "engine_opened"
              ? { ...pa, state: "confirmed" as PendingActionState }
              : pa,
          ),
        })),
      );
      setPendingMealNavQueue([]);
      pendingMealQueueRef.current = [];
    };
    window.addEventListener("glev:meal-ai-saved", handler);
    return () => window.removeEventListener("glev:meal-ai-saved", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable ref so the countdown effect can call sendMessage without
  // being listed as a dependency (avoids infinite loop risk).
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  const sendMessage = useCallback(
    async (text: string, attachments?: ChatAttachment[]) => {
      const trimmed = text.trim();
      const hasAttachments = (attachments ?? []).length > 0;
      if ((!trimmed && !hasAttachments) || streaming) return;

      const userMsg: GlevChatMessage = {
        id: nextId(),
        role: "user",
        content: trimmed || "📎",
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
      setAiState("thinking");
      setIsSlow(false);
      setRateLimitCountdown(null);

      // Start the slow-warning timer. If we haven't finished streaming
      // within SLOW_WARNING_MS, flip isSlow so the UI can show
      // "Glev braucht etwas länger…" while the user waits.
      const slowTimerId = setTimeout(() => setIsSlow(true), SLOW_WARNING_MS);

      const ac = new AbortController();
      abortRef.current = ac;

      // Client-side safety net: if the fetch/stream never resolves (e.g.
      // TCP hang on mobile networks), force-abort after 30 s so `finally`
      // always runs and `streaming` is never stuck. The server-side
      // CHAT_TIMEOUT fires at 18 s, but mobile 5G connections can silently
      // drop without the SSE frames ever arriving at the client.
      let clientTimedOut = false;
      const CLIENT_ABORT_MS = 30_000;
      const clientAbortTimer = setTimeout(() => {
        clientTimedOut = true;
        ac.abort();
      }, CLIENT_ABORT_MS);

      let sentenceBuf = "";
      let streamEndedNormally = false;
      const MIN_TTS_SENTENCE = 20;
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            message: trimmed,
            history: apiHistory,
            contextSnapshot: buildContextPayload(optsRef.current?.contextSnapshot),
            ...(hasAttachments ? { attachments } : {}),
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
          const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
          const locale = readLocaleCookie() ?? "de";
          // Always resolve to a typed code — unknown/absent falls back to UNKNOWN.
          const rawCode = typeof errBody?.error_code === "string" ? errBody.error_code : null;
          const code: AppErrorCode = (rawCode && ALL_ERROR_CODES.includes(rawCode as AppErrorCode))
            ? rawCode as AppErrorCode
            : "UNKNOWN";
          const msg = getUserFriendlyMessage(code, locale);
          const err = Object.assign(new Error(msg), {
            error_code: code,
            retry_allowed: isRetryAllowed(code),
            // Forward retry_after_sec so the 429-countdown UX can use it.
            retry_after_sec: typeof errBody.retry_after_sec === "number"
              ? errBody.retry_after_sec
              : undefined,
          });
          throw err;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        // Streaming TTS: accumulate tokens into sentences and dispatch each
        // as soon as the sentence boundary is detected so TTS can start
        // fetching audio in parallel with the continued LLM stream.
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
            // Step 1: parse JSON — only malformed-JSON errors are swallowed here.
            // Semantic errors (error_code frames) are handled OUTSIDE this catch
            // so their throws propagate to the outer AbortError handler.
            interface SseFrame {
              token?: string;
              error?: string;
              error_code?: AppErrorCode;
              user_message?: string;
              retry_allowed?: boolean;
              navigate?: string;
              set_macro?: { field: string; value: number };
              pending_action?: {
                token: string;
                kind: string;
                summary: string;
                payload?: unknown;
              };
              meal_prep?: {
                input_text: string;
                carbs: number;
                protein: number | null;
                fat: number | null;
                fiber: number | null;
                nutritionSource?: string;
              };
            }
            let parsed: SseFrame | null = null;
            try {
              parsed = JSON.parse(payload) as SseFrame;
            } catch {
              /* ignore malformed JSON frames */
            }
            if (!parsed) continue;
            // Step 2: semantic error frame — throw propagates to outer catch(e).
            // Always map to a typed code so the UI never shows raw strings.
            if (parsed.error_code || parsed.error) {
              const locale = readLocaleCookie() ?? "de";
              const rawCode = parsed.error_code ?? null;
              const code: AppErrorCode = (rawCode && ALL_ERROR_CODES.includes(rawCode))
                ? rawCode
                : "UNKNOWN";
              const msg = getUserFriendlyMessage(code, locale);
              const frame = parsed as Record<string, unknown>;
              throw Object.assign(new Error(msg), {
                error_code: code,
                retry_allowed: isRetryAllowed(code),
                // Forward retry_after_sec for the 429-countdown UX.
                retry_after_sec: typeof frame.retry_after_sec === "number"
                  ? frame.retry_after_sec
                  : undefined,
              });
            }
            if (parsed.navigate) {
              optsRef.current?.onNavigate?.(parsed.navigate);
            }
            if (parsed.meal_prep) {
              // Collect into the queue ref — do NOT write to sessionStorage
              // here. Multiple meals in one turn would overwrite each other.
              // We flush to state after the stream ends and only write the
              // specific meal's macros when the user taps its chip.
              const label = (parsed.meal_prep.input_text ?? "").slice(0, 40);
              pendingMealQueueRef.current = [
                ...pendingMealQueueRef.current,
                { mealPrep: parsed.meal_prep, label },
              ];
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
              // WRITE-tool result: append a confirm/cancel chip to the
              // currently streaming assistant bubble. Multiple chips can
              // accumulate in one turn (multi-entry logging).
              const pa = parsed.pending_action as {
                token: string;
                kind: string;
                summary: string;
                payload?: Record<string, unknown>;
              };
              const newChip: PendingAction = {
                token: pa.token,
                kind: pa.kind,
                summary: pa.summary,
                state: "pending",
                payload: pa.payload,
              };
              // For log_meal_entry: associate the token with the last
              // queued meal_prep item so "Engine öffnen" chips can look
              // up the right macro data without an extra server roundtrip.
              if (pa.kind === "log_meal_entry" && pendingMealQueueRef.current.length > 0) {
                const items = [...pendingMealQueueRef.current];
                items[items.length - 1] = { ...items[items.length - 1], token: pa.token };
                pendingMealQueueRef.current = items;
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        pendingActions: [...(m.pendingActions ?? []), newChip],
                      }
                    : m,
                ),
              );
            }
            if (parsed.token) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + parsed!.token }
                    : m,
                ),
              );
              // Sentence detection: buffer token, dispatch complete sentences
              // for parallel TTS fetching (Perplexity-style streaming audio).
              sentenceBuf += parsed.token;
              let boundaryIdx: number;
              while ((boundaryIdx = sentenceBuf.search(/[.!?]\s/)) !== -1) {
                const sentence = sentenceBuf.slice(0, boundaryIdx + 1).trim();
                sentenceBuf = sentenceBuf.slice(boundaryIdx + 2).trimStart();
                if (sentence.length >= MIN_TTS_SENTENCE && typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent<string>("glev:tts-sentence", { detail: sentence }),
                  );
                }
              }
            }
          }
        }
        streamEndedNormally = true;
      } catch (e) {
        // AbortError = stream was cancelled by navigation (closeSheet) or
        // user action — this is intentional and must never show as an error.
        // EXCEPTION: if the client-side 30 s safety timer fired, treat the
        // abort as a CHAT_TIMEOUT so the bubble shows a retry-able error.
        if (e instanceof Error && e.name === "AbortError" && !clientTimedOut) {
          // Silent — the navigation/close already handled the UX.
        } else {
          const locale = readLocaleCookie() ?? "de";
          // Resolve to a typed code — errors thrown by our SSE/HTTP handlers
          // carry error_code; plain network errors (fetch failed, etc.) have
          // none, so they fall back to UNKNOWN. Never surface e.message.
          // Client-side safety-timer abort → treat as CHAT_TIMEOUT.
          const errMeta = e as Record<string, unknown>;
          const rawCode = clientTimedOut
            ? "CHAT_TIMEOUT"
            : (errMeta?.error_code as string | undefined);
          const code: AppErrorCode = (rawCode && ALL_ERROR_CODES.includes(rawCode as AppErrorCode))
            ? rawCode as AppErrorCode
            : "UNKNOWN";
          const msg = getUserFriendlyMessage(code, locale);
          const retry = isRetryAllowed(code);

          // ── 429 auto-retry ──────────────────────────────────────────
          // On the first MISTRAL_RATE_LIMITED hit: start a countdown and
          // schedule an auto-retry. On the second hit (auto-retry also
          // failed): fall through to the manual retry button.
          const retryAfterSec = typeof errMeta.retry_after_sec === "number"
            ? errMeta.retry_after_sec
            : undefined;
          if (
            code === "MISTRAL_RATE_LIMITED" &&
            typeof retryAfterSec === "number" &&
            autoRetryAttemptRef.current === 0
          ) {
            autoRetryAttemptRef.current = 1;
            autoRetryMsgRef.current = trimmed;
            setRateLimitCountdown(retryAfterSec);
          } else {
            // On a second failure or when no retry_after_sec, reset the
            // attempt counter so future messages start fresh.
            autoRetryAttemptRef.current = 0;
            autoRetryMsgRef.current = null;
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || msg,
                    isStreaming: false,
                    retryAllowed: retry,
                  }
                : m,
            ),
          );
        }
      } finally {
        // Flush any remaining sentence buffer and signal stream end to TTS queue.
        if (typeof window !== "undefined") {
          if (streamEndedNormally) {
            const remaining = sentenceBuf.trim();
            if (remaining.length >= MIN_TTS_SENTENCE) {
              window.dispatchEvent(
                new CustomEvent<string>("glev:tts-sentence", { detail: remaining }),
              );
            }
          }
          window.dispatchEvent(new CustomEvent("glev:tts-stream-done"));
        }
        clearTimeout(clientAbortTimer);
        clearTimeout(slowTimerId);
        setIsSlow(false);
        setStreaming(false);
        setAiState("idle");
        abortRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isStreaming: false } : m,
          ),
        );
        // Flush collected meal_prep items into the queue state.
        // The chip becomes visible once streaming has stopped so the
        // user has time to read the AI's response before tapping.
        if (pendingMealQueueRef.current.length > 0) {
          const items = pendingMealQueueRef.current;
          pendingMealQueueRef.current = [];
          setPendingMealNavQueue((prev) => [...prev, ...items]);
        }
      }
    },
    // opts?.contextSnapshot is read via optsRef.current inside the fn — no dep needed.
    [messages, streaming],
  );

  // Keep the stable ref in sync so the countdown auto-retry always calls
  // the latest closure (which has the up-to-date messages/streaming deps).
  sendMessageRef.current = sendMessage;

  /**
   * Confirm a pending WRITE-action by posting its token to
   * /api/ai/confirm-action. Idempotent on the server (used_at guard);
   * we also short-circuit locally if the widget is no longer "pending".
   */
  /** Patch a single PendingAction in the pendingActions[] array by token. */
  function patchAction(
    prev: GlevChatMessage[],
    messageId: string,
    token: string,
    patch: Partial<PendingAction>,
  ): GlevChatMessage[] {
    return prev.map((m) => {
      if (m.id !== messageId || !m.pendingActions) return m;
      return {
        ...m,
        pendingActions: m.pendingActions.map((a) =>
          a.token === token ? { ...a, ...patch } : a,
        ),
      };
    });
  }

  const confirmAction = useCallback(async (messageId: string, token: string) => {
    setMessages((prev) => patchAction(prev, messageId, token, { state: "confirming" }));

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
        setMessages((prev) => patchAction(prev, messageId, token, { state: "error", error: msg }));
        return;
      }
      setMessages((prev) => patchAction(prev, messageId, token, { state: "confirmed" }));
      // Note: log_meal_entry navigation is handled entirely by openEngineForMeal()
      // which is called instead of confirmAction() for meal chips. confirmAction()
      // may also be called from openEngineForMeal() after the navigation, but by then
      // the token-linked queue item has already been removed — no phantom item here.

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
      setMessages((prev) => patchAction(prev, messageId, token, { state: "error", error: msg }));
    }
  }, []);

  /**
   * Cancel a pending WRITE-action locally. Leaves the row to expire on
   * its own (TTL 5 min) — no server roundtrip needed because the
   * confirm endpoint won't be called.
   *
   * For log_meal_entry chips: also removes the token-linked item from
   * both the flushed state queue and the still-streaming ref queue so
   * the bottom nav chip can't offer a discarded meal.
   */
  const cancelAction = useCallback((messageId: string, token: string) => {
    setMessages((prev) => patchAction(prev, messageId, token, { state: "cancelled" }));
    // Idempotent cleanup: filter is a no-op when token is not present.
    setPendingMealNavQueue((prev) => prev.filter((item) => item.token !== token));
    pendingMealQueueRef.current = pendingMealQueueRef.current.filter(
      (item) => item.token !== token,
    );
  }, []);

  /**
   * Quick-save a non-meal pending action without navigating away from
   * the chat sheet. Posts the token to /api/ai/confirm-action (same
   * path as confirmAction) and marks the chip as "Gespeichert ✓".
   *
   * For non-meal chips this is the preferred "stay in chat" path.
   * Meal chips still require the "Engine öffnen →" flow.
   */
  const quickSaveAction = useCallback(
    async (messageId: string, token: string) => {
      await confirmAction(messageId, token);
    },
    [confirmAction],
  );

  /**
   * Navigate to the engine tab that corresponds to a non-meal log type.
   * Writes the chip's payload to sessionStorage under the action-specific
   * key and dispatches a typed DOM event so the target screen can
   * pre-populate its form fields. Then calls onNavigate to change routes.
   *
   * The pending_action chip is NOT confirmed server-side here — the user
   * will save via the native log form on the Engine screen.
   * The chip is cancelled locally so it doesn't linger in the chat.
   */
  const navigateToLogScreen = useCallback(
    (messageId: string, token: string, kind: string, payload?: unknown) => {
      const config = getActionNavConfig(kind);
      if (!config) return;

      // Write payload to sessionStorage so the target screen can read it.
      if (payload != null && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(config.storageKey, JSON.stringify(payload));
        } catch { /* ignore quota/privacy errors */ }
        window.dispatchEvent(new CustomEvent(config.event, { detail: payload }));
      }

      // Mark the chip as cancelled locally — the user will save via the form.
      setMessages((prev) =>
        patchAction(prev, messageId, token, { state: "cancelled" }),
      );

      optsRef.current?.onNavigate?.(`/engine?tab=${config.tab}`);
    },
    // patchAction is a local function — no dep needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return {
    consentGranted,
    consentLoaded,
    modalOpen,
    sheetOpen,
    messages,
    streaming,
    /** Current AI processing state for FAB animation. */
    aiState,
    /** Set by TTS player to 'speaking' when audio starts, back to 'idle'
     *  when audio ends. Exposed so Layout.tsx can wire it without needing
     *  a separate window event. */
    setAiState,
    /** Populated by the TTS player with a Web Audio AnalyserNode so the
     *  FAB can read amplitude data during the speaking animation. */
    audioAnalyserRef: audioAnalyserRef as MutableRefObject<AnalyserNode | null>,
    /** True after SLOW_WARNING_MS of waiting — the chat sheet can show
     *  "Glev braucht etwas länger…" while the user waits for a response. */
    isSlow,
    /** Seconds remaining before the 429-auto-retry fires. null = no
     *  countdown active. The chat sheet can render a countdown pill. */
    rateLimitCountdown,
    openFromButton,
    dismissConsent,
    grantConsent,
    revokeConsent,
    closeSheet,
    clearMessages,
    sendMessage,
    confirmAction,
    cancelAction,
    quickSaveAction,
    navigateToLogScreen,
    /** Ordered queue of meals waiting for the user to tap through to
     *  the Engine screen. Populated after stream ends; first item is
     *  popped by fireMealNav() each time the user taps the chip.
     *  Multi-meal turns ("Haribo UND Croissant") produce multiple items
     *  so neither overwrites the other. */
    pendingMealNavQueue,
    /** Called by the chat sheet's meal-nav tap chip. Writes the first
     *  item's macros to sessionStorage, dispatches glev:meal-prefill,
     *  navigates to /engine, and pops the item from the queue. */
    fireMealNav: () => {
      if (pendingMealNavQueue.length === 0) return;
      const [first, ...rest] = pendingMealNavQueue;
      setPendingMealNavQueue(rest);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("glev_pending_meal", JSON.stringify(first.mealPrep));
        } catch { /* ignore quota / privacy errors */ }
        window.dispatchEvent(new CustomEvent("glev:meal-prefill"));
      }
      optsRef.current?.onNavigate?.("/engine");
    },
    /** Called by the "Engine öffnen →" button inside a log_meal_entry chip.
     *  Resolves the pending_action server-side, writes the matching meal's
     *  macros to sessionStorage, dispatches glev:meal-prefill, navigates
     *  to /engine, and removes the item from both queues.
     *
     *  Looks up the meal data in BOTH the flushed-state queue
     *  (`pendingMealNavQueue`) and the still-streaming ref queue
     *  (`pendingMealQueueRef.current`) so early taps during streaming
     *  still find the data and navigate correctly. */
    openEngineForMeal: async (messageId: string, token: string) => {
      // Search the flushed state queue first, then fall back to the ref queue
      // (items live in the ref while the stream is still running, and are
      // only moved to state after streaming ends).
      const queueMatch =
        pendingMealNavQueue.find((item) => item.token === token) ??
        pendingMealQueueRef.current.find((item) => item.token === token);

      // Fallback: reconstruct mealPrep from the chip payload when the queue is
      // empty (session restored, app backgrounded + killed, or queue cleared).
      // The chip's payload carries the same macro data as the meal_prep frame.
      let mealPrep: MealQueueItem["mealPrep"] | null = queueMatch?.mealPrep ?? null;
      if (!mealPrep) {
        for (const m of messages) {
          if (m.id !== messageId) continue;
          const pa = m.pendingActions?.find((a) => a.token === token);
          if (pa?.payload) {
            const p = pa.payload as MealPendingPayload;
            mealPrep = {
              input_text: p.input_text ?? "",
              carbs: p.carbs_grams ?? 0,
              protein: p.protein_grams ?? null,
              fat: p.fat_grams ?? null,
              fiber: p.fiber_grams ?? null,
              ...(p.meal_time_explicit && p.logged_at ? { meal_time: p.logged_at } : {}),
              ...(p.nutritionSource ? { nutritionSource: p.nutritionSource } : {}),
            };
          }
          break;
        }
      }

      if (!mealPrep) return;

      // Write meal data every time (re-navigation after back needs fresh sessionStorage
      // because the Engine page clears glev_pending_meal on mount).
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("glev_pending_meal", JSON.stringify(mealPrep));
          sessionStorage.setItem("glev_engine_back_to", "/glev-ai");
        } catch { /* ignore quota / privacy errors */ }
        window.dispatchEvent(new CustomEvent("glev:meal-prefill"));
      }
      // Keep the item in pendingMealNavQueue — do NOT remove it yet.
      // It stays so that "Macros prüfen →" re-navigation (second tap) can
      // re-write sessionStorage without needing to reconstruct from payload.
      // Cleared by the glev:meal-ai-saved handler when the meal is saved.

      // Transition chip to engine_opened (not confirmed) — chip stays visible
      // with a "Macros prüfen →" CTA so the user can navigate back into the
      // Engine after returning to the chat.
      setMessages((prev) => patchAction(prev, messageId, token, { state: "engine_opened" }));
      optsRef.current?.onNavigate?.("/engine");
    },
  };
}

/**
 * Pure helper: builds the contextSnapshot object that goes into the
 * /api/ai/chat request body. Exported for unit tests — they can call
 * this directly without mocking fetch or React hooks.
 *
 * Any field that is undefined/missing is filled with NEUTRAL so the
 * server never receives an empty string and the AI always has a
 * human-readable fallback.
 */
export function buildContextPayload(snapshot?: ContextSnapshot): {
  screen: string | undefined;
  glucoseSummary: string;
  iobSummary: string;
  lastMealDescription: string;
} {
  return {
    screen:              snapshot?.screen,
    glucoseSummary:      snapshot?.glucoseSummary      ?? NEUTRAL,
    iobSummary:          snapshot?.iobSummary          ?? NEUTRAL,
    lastMealDescription:
      snapshot?.lastMealSummary ??
      snapshot?.lastMealDescription ??
      NEUTRAL,
  };
}

export const __test__ = {
  NEUTRAL,
  HISTORY_KEY,
  MAX_HISTORY,
};

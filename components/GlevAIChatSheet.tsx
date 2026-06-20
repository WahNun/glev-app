"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ChatAttachment } from "@/lib/useGlevAI";
import { useLocale } from "next-intl";
import type { GlevChatMessage, InfluencePrepPayload, MealPendingPayload, MealQueueItem, PendingAction } from "@/lib/useGlevAI";
import InfluencePrepChip from "@/components/InfluencePrepChip";
import type { NutritionSource } from "@/lib/nutrition/types";
import type { ParsedFood } from "@/lib/meals";
import { useVoiceIntents } from "@/hooks/useVoiceIntents";
import { MIC_PERM_DENIED } from "@/hooks/useVoxtral";
import { useTTS } from "@/hooks/useTTS";
import IntentConfirmChip, { intentLabel } from "@/components/IntentConfirmChip";
import GlevLogo from "@/components/GlevLogo";
import { getActionMeta } from "@/lib/ai/pendingActions";
import SourceBadge from "@/components/SourceBadge";
import { aggregateBadge, aggregateSourceLabel } from "@/lib/nutrition/badgeFor";
import { supabase } from "@/lib/supabase";
import ResetButton from "@/components/ResetButton";

const ACCENT = "#8b5cf6";
const SHEET_BG = "var(--surface)";
const PAGE_BG = "var(--bg)";

// ── Localised copy ─────────────────────────────────────────────────────────
const COPY = {
  de: {
    disclaimer:            "Glev ist kein Medizinprodukt. Alle Informationen sind Orientierungspunkte.",
    confirmed_engine:      "✓ Engine geöffnet",
    confirmed_saved:       "✓ Gespeichert",
    cancelled:             "Abgebrochen",
    save_failed:           "Speichern fehlgeschlagen",
    unknown_error:         "unbekannter Fehler",
    retry:                 "Nochmal versuchen",
    discard_meal:          "Mahlzeit verwerfen",
    discard:               "Verwerfen",
    meal_n_of_m:           (n: number, m: number) => `Mahlzeit ${n} von ${m}`,
    opening:               "Öffnet …",
    open_engine:           "Engine öffnen →",
    saving:                "Speichert …",
    quick_save:            "Schnell speichern",
    fingerstick_label:     "Fingerstick",
    fingerstick_details:   "Fingerstick-Details öffnen →",
    now:                   "Jetzt",
    mins_ago:              (m: number) => `vor ${m} min`,
    hours_ago:             (h: number) => `vor ${h} h`,
    cycle_label:           "Zyklus",
    cycle_details:         "Zyklus-Details →",
    bolus_details:         "Bolus-Details →",
    basal_details:         "Basal-Details →",
    detail:                "Detail →",
    back:                  "Zurück",
    reset_chat:            "Chat zurücksetzen",
    tts_off:               "Sprachausgabe aus",
    tts_on:                "Sprachausgabe ein",
    status_speaking:       "Spricht …",
    status_analyzing:      "Analysiert …",
    status_ready:          "BEREIT",
    close:                 "Schließen",
    empty_state:           "Frag Glev etwas über deine Werte, IOB oder letzte Mahlzeit.",
    stop_playback:         "Wiedergabe stoppen",
    read_aloud:            "Vorlesen",
    meal_fallback:         "Mahlzeit",
    open_engine_chip:      "Engine öffnen",
    engine_opened_label:   "Im Engine geöffnet · noch nicht gespeichert",
    macros_review:         "Macros prüfen →",
    n_of_total:            (n: number, total: number) => `${n} von ${total}`,
    details_expand:        "Details ⌄",
    details_collapse:      "Details ⌃",
    ai_source_label:       "KI",
    mic_stop:              "Aufnahme stoppen",
    mic_start:             "Spracheingabe starten",
    mic_rate_limit:        (sec: number) => `Bitte ${sec} Sek. warten`,
    mic_perm_denied:       "Glev braucht Mikrofon-Zugriff. Bitte in den Einstellungen erlauben und nochmal versuchen.",
    mic_perm_retry:        "Nochmal versuchen",
    placeholder_listening: "Spreche …",
    placeholder_idle:      "Frag Glev …",
    send:                  "Senden",
    attach_too_large:      "Datei zu groß (max. 5 MB)",
    attach_limit:          "Maximal 3 Anhänge erlaubt",
    attach_heic:           "HEIC-Konvertierung fehlgeschlagen – bitte als JPEG exportieren.",
    attach_converting:     "Konvertiere HEIC …",
    attach_uploading:      "Lädt hoch …",
    attach_remove:         "Anhang entfernen",
  },
  en: {
    disclaimer:            "Glev is not a medical device. All information is for orientation only.",
    confirmed_engine:      "✓ Engine opened",
    confirmed_saved:       "✓ Saved",
    cancelled:             "Cancelled",
    save_failed:           "Save failed",
    unknown_error:         "unknown error",
    retry:                 "Try again",
    discard_meal:          "Discard meal",
    discard:               "Discard",
    meal_n_of_m:           (n: number, m: number) => `Meal ${n} of ${m}`,
    opening:               "Opening …",
    open_engine:           "Open Engine →",
    saving:                "Saving …",
    quick_save:            "Save now",
    fingerstick_label:     "Fingerstick",
    fingerstick_details:   "Open fingerstick details →",
    now:                   "Now",
    mins_ago:              (m: number) => `${m} min ago`,
    hours_ago:             (h: number) => `${h} h ago`,
    cycle_label:           "Cycle",
    cycle_details:         "Cycle details →",
    bolus_details:         "Bolus details →",
    basal_details:         "Basal details →",
    detail:                "Detail →",
    back:                  "Back",
    reset_chat:            "Reset chat",
    tts_off:               "Turn off voice output",
    tts_on:                "Turn on voice output",
    status_speaking:       "Speaking …",
    status_analyzing:      "Analysing …",
    status_ready:          "READY",
    close:                 "Close",
    empty_state:           "Ask Glev anything about your glucose levels, IOB or last meal.",
    stop_playback:         "Stop playback",
    read_aloud:            "Read aloud",
    meal_fallback:         "Meal",
    open_engine_chip:      "Open Engine",
    engine_opened_label:   "Opened in Engine · not saved yet",
    macros_review:         "Review macros →",
    n_of_total:            (n: number, total: number) => `${n} of ${total}`,
    details_expand:        "Details ⌄",
    details_collapse:      "Details ⌃",
    ai_source_label:       "AI",
    mic_stop:              "Stop recording",
    mic_start:             "Start voice input",
    mic_rate_limit:        (sec: number) => `Wait ${sec} sec`,
    mic_perm_denied:       "Glev needs microphone access. Please allow it in settings and try again.",
    mic_perm_retry:        "Try again",
    placeholder_listening: "Listening …",
    placeholder_idle:      "Ask Glev …",
    send:                  "Send",
    attach_too_large:      "File too large (max 5 MB)",
    attach_limit:          "Max 3 attachments",
    attach_heic:           "HEIC conversion failed – please export as JPEG.",
    attach_converting:     "Converting HEIC …",
    attach_uploading:      "Uploading …",
    attach_remove:         "Remove attachment",
  },
} as const;
// ──────────────────────────────────────────────────────────────────────────

/** Local attachment state before upload resolves. */
type PendingAttachment = {
  id: string;
  file: File;
  preview: string | null; // object URL for images; null for PDFs
  mimeType: string;
  fileName: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  messages: GlevChatMessage[];
  streaming: boolean;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onConfirmAction?: (messageId: string, token: string) => void;
  onCancelAction?: (messageId: string, token: string) => void;
  /** Called by the "Engine öffnen →" button on a log_meal_entry chip.
   *  Resolves the pending_action, writes macros to sessionStorage,
   *  dispatches glev:meal-prefill, and navigates to /engine. */
  onOpenEngineForMeal?: (messageId: string, token: string) => void;
  /** Called by the "Schnell speichern" button on a non-meal chip.
   *  Confirms the pending_action server-side without navigating. */
  onQuickSaveAction?: (messageId: string, token: string) => void;
  /** Called by the "Detail öffnen →" button on a non-meal chip.
   *  Writes the payload to sessionStorage, dispatches a typed DOM event,
   *  and navigates to the matching engine tab. */
  onDetailOpen?: (messageId: string, token: string, kind: string, payload?: unknown) => void;
  onClearChat?: () => void;
  /** Called whenever the chat sheet's STT listening state changes so the
   *  parent (Layout.tsx) can reflect it on the FAB. */
  onListeningChange?: (listening: boolean) => void;
  /** Queue of meals waiting for the user to tap through to the Engine screen.
   *  First item is the active chip; each onMealNavTap() call pops one.
   *  Multi-meal turns ("Haribo UND Croissant") produce multiple items. */
  pendingMealNavQueue?: MealQueueItem[];
  onMealNavTap?: () => void;
  /**
   * When true, voice transcripts are classified into intents before
   * reaching the chat pipeline. Requires voice_intent_routing feature flag.
   * Non-matching intents still fall through to the normal chat flow.
   */
  voiceIntentEnabled?: boolean;
  /**
   * "sheet"      (default) — bottom-sheet with backdrop + drag handle + slide-up
   *                          animation. Used on Dashboard, Insights, Entries.
   * "fullscreen" — fixed overlay that fills the content area between header
   *                and nav. No backdrop, no drag handle, fade-in animation,
   *                back-button instead of X. Used on /engine.
   */
  variant?: "sheet" | "fullscreen";
}


/**
 * Inline confirm/cancel widget attached to an assistant bubble that
 * came back from a WRITE-tool call. Rendered as a soft card directly
 * under the bubble (left-aligned, since assistant bubbles are
 * left-aligned). The five visual states match `PendingActionState` in
 * `lib/useGlevAI.ts`:
 *
 *   pending     → summary + action buttons
 *   confirming  → buttons disabled, "Öffnet …" / "Speichert …"
 *   confirmed   → green check + "Gespeichert" / "Engine geöffnet"
 *   cancelled   → muted "Abgebrochen"
 *   error       → red error string + Erneut-versuchen
 *
 * For `log_meal_entry` chips the layout is different from all others:
 *   • A small ✕ ghost button top-right cancels/discards the meal.
 *   • A full-width "Engine öffnen →" button navigates to the Engine.
 *   • When `isMealChipActive` is false the entire widget is dimmed
 *     and non-interactive — the user must resolve earlier chips first.
 */

// ── MealChipExpanded ──────────────────────────────────────────────────────
// Extracted so it can own its own useState (expand toggle) without making
// PendingActionWidget a client component or violating hooks rules.
function MealChipExpanded({
  baseCard,
  inactive,
  busy,
  mealName,
  macroStr,
  timeStr,
  itemsForExpand: initialItems,
  mealPrepId,
  nutritionSource,
  totalAlcoholG = 0,
  showQueueBadge,
  mealChipIndex,
  mealChipTotal,
  t,
  onCancel,
  onOpenEngine,
}: {
  baseCard: React.CSSProperties;
  inactive: boolean;
  busy: boolean;
  mealName: string;
  macroStr: string | null;
  timeStr: string | null;
  itemsForExpand: Array<ParsedFood>;
  /** Phase 3: id for Realtime refinement subscription. */
  mealPrepId?: string;
  /** Top-level nutrition provenance from the aggregator (AggregateSource). */
  nutritionSource?: string | null;
  /** Dual-Emission: total alcohol grams across items — shows ⇄ indicator. */
  totalAlcoholG?: number;
  showQueueBadge: boolean;
  mealChipIndex?: number;
  mealChipTotal?: number;
  t: typeof COPY["de"] | typeof COPY["en"];
  onCancel: () => void;
  onOpenEngine?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [itemsForExpand, setItemsForExpand] = useState<Array<ParsedFood>>(initialItems);
  const [badgesTransitioning, setBadgesTransitioning] = useState(false);

  // Phase 3 Realtime: subscribe to meal_prep_refinements for this mealPrepId.
  // When OPTIMISTIC_REFINEMENT=true the aggregator writes a 'completed' row
  // after resolving per-item sources; we swap in the refined items + fade badges.
  useEffect(() => {
    if (!mealPrepId || !supabase) return;
    // Polling fallback: check every 500ms for max 5s.
    // Realtime subscribe on the same row as primary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (supabase as any)
      .channel(`meal-refinement-${mealPrepId}`)
      .on(
        "postgres_changes",
        {
          event:  "UPDATE",
          schema: "public",
          table:  "meal_prep_refinements",
          filter: `id=eq.${mealPrepId}`,
        },
        (payload: { new: { status?: string; items_refined?: ParsedFood[] } }) => {
          const row = payload.new;
          if (row.status === "completed" && Array.isArray(row.items_refined) && row.items_refined.length > 0) {
            setBadgesTransitioning(true);
            setTimeout(() => {
              setItemsForExpand(row.items_refined as ParsedFood[]);
              setBadgesTransitioning(false);
            }, 250);
          }
        },
      )
      .subscribe();

    // Polling fallback: query every 500ms for up to 5s if Realtime doesn't fire.
    let pollCount = 0;
    const poll = setInterval(async () => {
      pollCount++;
      if (pollCount > 10) { clearInterval(poll); return; }
      if (!supabase) { clearInterval(poll); return; }
      const { data } = await supabase
        .from("meal_prep_refinements")
        .select("status, items_refined")
        .eq("id", mealPrepId)
        .maybeSingle();
      if (data?.status === "completed" && Array.isArray(data.items_refined) && data.items_refined.length > 0) {
        clearInterval(poll);
        setBadgesTransitioning(true);
        setTimeout(() => {
          setItemsForExpand(data.items_refined as ParsedFood[]);
          setBadgesTransitioning(false);
        }, 250);
      }
    }, 500);

    return () => {
      void supabase?.removeChannel(channel);
      clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealPrepId]);

  return (
    <div
      style={{
        ...baseCard,
        opacity: inactive ? 0.4 : 1,
        position: "relative",
      }}
    >
      {/* ✕ dismiss — top-right corner */}
      <button
        type="button"
        aria-label={t.discard_meal}
        onClick={onCancel}
        disabled={busy}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: inactive ? "var(--border-soft)" : "none",
          border: inactive ? "1px solid var(--border)" : "none",
          borderRadius: inactive ? 4 : 0,
          cursor: busy ? "default" : "pointer",
          padding: 4,
          color: "var(--text-muted)",
          fontSize: 14,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: busy ? 0.5 : 1,
        }}
      >
        ✕
      </button>

      {/* Header: meal name + source badge */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          paddingRight: 24,
        }}
      >
        <div
          style={{
            flex: 1,
            color: "var(--text-strong)",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          {mealName}
          {/* ⇄ Alkohol-Linked-Indicator (Dual-Emission) */}
          {totalAlcoholG > 0 && (
            <span
              title={`⇄ verknüpft mit Alkohol-Einflussfaktor · ${Math.round(totalAlcoholG)}g`}
              style={{
                fontSize: 10, fontWeight: 700,
                background: "rgba(245,158,11,0.15)",
                color: "#d97706",
                border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: 5, padding: "1px 5px",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              ⇄ {Math.round(totalAlcoholG)}g Alk
            </span>
          )}
        </div>
        {/* Aggregate badge from real sources; fades during Realtime refinement. */}
        {(() => {
          // Vision estimate: show a dedicated 📷 Foto badge.
          if (nutritionSource === "vision_estimate") {
            return (
              <span
                style={{ opacity: badgesTransitioning ? 0 : 1, transition: "opacity 0.25s ease" }}
                title="Vision-Schätzung"
              >
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                  padding: "1px 5px", borderRadius: 6,
                  background: "rgba(59,130,246,0.12)", color: "#60a5fa",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  📷 {aggregateSourceLabel(nutritionSource)}
                </span>
              </span>
            );
          }
          const badge = aggregateBadge(
            itemsForExpand.map((it) => ({ source: (it.source ?? "estimated") as NutritionSource })),
          );
          // Prefer the top-level nutritionSource from the aggregator when it
          // signals "user_history" — aggregateBadge collapses all DB sources
          // to "verified" so we'd lose the distinction without this check.
          const src: NutritionSource = (() => {
            if (nutritionSource === "user_history" || nutritionSource === "user_confirmed") return "user_history";
            if (itemsForExpand.length > 0) {
              if (badge === "verified") return nutritionSource === "usda" ? "usda" : "open_food_facts";
              return "estimated";
            }
            // No per-item data — use top-level nutritionSource directly.
            if (nutritionSource === "open_food_facts" || nutritionSource === "database") return "open_food_facts";
            if (nutritionSource === "usda") return "usda";
            return "estimated";
          })();
          return (
            <span style={{ opacity: badgesTransitioning ? 0 : 1, transition: "opacity 0.25s ease" }}>
              <SourceBadge source={src} />
            </span>
          );
        })()}
      </div>

      {/* Macros + time line */}
      {(macroStr || timeStr) && (
        <div style={{ color: "var(--text-body)", fontSize: 12, lineHeight: 1.4 }}>
          {macroStr && <span>({macroStr})</span>}
          {macroStr && timeStr && " "}
          {timeStr && <span style={{ color: "var(--text-muted)" }}>um {timeStr}</span>}
        </div>
      )}

      {/* Expand: per-item list (Phase 1 = all ✨ KI) */}
      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "8px 10px",
            background: "var(--surface-alt, rgba(255,255,255,0.03))",
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        >
          {itemsForExpand.length > 0 ? (
            itemsForExpand.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text-body)",
                }}
              >
                <span style={{ flex: 1 }}>
                  {item.name}
                  <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>
                    {item.grams}g
                  </span>
                </span>
                <span style={{ opacity: badgesTransitioning ? 0 : 1, transition: "opacity 0.25s ease" }}>
                  <SourceBadge source={(item.source ?? "estimated") as NutritionSource} />
                </span>
              </div>
            ))
          ) : (
            // No per-item data (Phase 1 / flag-off) — show meal-name placeholder.
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-body)",
              }}
            >
              <span>{mealName}</span>
              <SourceBadge source="estimated" />
            </div>
          )}
        </div>
      )}

      {/* Queue badge */}
      {showQueueBadge && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            alignSelf: "flex-start",
            padding: "2px 7px",
            borderRadius: 10,
            background: "var(--border-soft)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {t.meal_n_of_m(mealChipIndex!, mealChipTotal!)}
        </div>
      )}

      {/* Action row: [Details ⌄] [Engine öffnen →] */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={inactive}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--border-soft)",
            color: "var(--text-body)",
            fontWeight: 500,
            fontSize: 12,
            cursor: inactive ? "default" : "pointer",
          }}
        >
          {expanded ? t.details_collapse : t.details_expand}
        </button>
        <button
          type="button"
          onClick={onOpenEngine}
          disabled={busy || inactive}
          style={{
            flex: 2,
            padding: "8px 10px",
            borderRadius: 8,
            border: "none",
            background: busy ? "rgba(139,92,246,0.35)" : ACCENT,
            color: "var(--on-accent)",
            fontWeight: 600,
            fontSize: 13,
            cursor: busy || inactive ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {busy ? t.opening : t.open_engine}
        </button>
      </div>
    </div>
  );
}

function PendingActionWidget({
  pa,
  onConfirm,
  onCancel,
  onOpenEngine,
  onQuickSave,
  onDetailOpen,
  isMealChipActive,
  mealChipIndex,
  mealChipTotal,
  t,
}: {
  pa: PendingAction;
  onConfirm: () => void;
  onCancel: () => void;
  onOpenEngine?: () => void;
  /** For non-meal chips: saves directly without navigating. */
  onQuickSave?: () => void;
  /** For non-meal chips: writes sessionStorage + dispatches DOM event + navigates. */
  onDetailOpen?: () => void;
  /** For log_meal_entry chips only: whether this chip is the first
   *  unresolved meal chip in the turn and therefore interactive. */
  isMealChipActive?: boolean;
  /** 1-based position of this chip among unresolved meal chips in the turn. */
  mealChipIndex?: number;
  /** Total number of unresolved meal chips in the turn. */
  mealChipTotal?: number;
  t: typeof COPY["de"] | typeof COPY["en"];
}) {
  const isMeal = pa.kind === "log_meal_entry";

  const baseCard: React.CSSProperties = {
    maxWidth: "82%",
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--surface-soft)",
    border: "1px solid var(--border)",
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--text-strong)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  const summary = (
    <div style={{ color: "var(--text-body)", fontSize: 12 }}>
      {pa.summary}
    </div>
  );

  if (pa.state === "confirmed") {
    return (
      <div style={{ ...baseCard, borderColor: "rgba(80,200,120,0.4)" }}>
        {summary}
        <div style={{ color: "#7ee0a0", fontWeight: 600, fontSize: 13 }}>
          {isMeal ? t.confirmed_engine : t.confirmed_saved}
        </div>
      </div>
    );
  }
  if (pa.state === "engine_opened" && isMeal) {
    return (
      <div style={{ ...baseCard, borderColor: "rgba(139,92,246,0.3)" }}>
        {summary}
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {t.engine_opened_label}
        </div>
        <button
          type="button"
          onClick={onOpenEngine}
          style={{
            width: "100%",
            padding: "9px 12px",
            borderRadius: 8,
            border: "none",
            background: "rgba(139,92,246,0.2)",
            color: "var(--accent, #8b5cf6)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {t.macros_review}
        </button>
      </div>
    );
  }
  if (pa.state === "cancelled") {
    return (
      <div style={{ ...baseCard, opacity: 0.6 }}>
        {summary}
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {t.cancelled}
        </div>
      </div>
    );
  }
  if (pa.state === "error") {
    return (
      <div style={{ ...baseCard, borderColor: "rgba(255,120,120,0.45)" }}>
        {summary}
        <div style={{ color: "#ff8888", fontSize: 13 }}>
          {t.save_failed}: {pa.error ?? t.unknown_error}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={isMeal ? onOpenEngine : onConfirm}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--border-soft)",
              color: "var(--text-strong)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t.retry}
          </button>
        </div>
      </div>
    );
  }

  const busy = pa.state === "confirming";

  // ── Meal chip layout ─────────────────────────────────────────────
  // Header row (meal name + ✨ badge) · macros line · two buttons side-by-side.
  // When inactive (a later meal in the same turn), dims to 0.4 opacity
  // and shows a "Mahlzeit N von M" badge so the user knows it's queued.
  if (isMeal) {
    const inactive = !isMealChipActive;
    const showQueueBadge =
      inactive &&
      mealChipIndex != null &&
      mealChipTotal != null &&
      mealChipTotal > 1;

    // Parse meal name + macros out of pa.summary so we can render them
    // separately. Format: "Mahlzeit: <name> (<macros>) um <time>"
    // Fall back to showing the whole summary if it doesn't match.
    const mealMatch = pa.summary.match(/^Mahlzeit:\s*(.+?)\s*\(([^)]+)\)\s*um\s*(.+)$/);
    const mealName   = mealMatch ? mealMatch[1] : pa.summary;
    const macroStr   = mealMatch ? mealMatch[2] : null;
    const timeStr    = mealMatch ? mealMatch[3] : null;

    // Phase 2/3: cast to MealPendingPayload to get typed items[] + meal_prep_id.
    // Phase 1 chips (no items) fall back to empty array (backward-compat).
    const p = pa.payload as MealPendingPayload | undefined;
    const itemsForExpand: Array<ParsedFood> = p?.items ?? [];
    const mealPrepId = p?.meal_prep_id;
    const totalAlcoholG = p?.total_alcohol_g ?? 0;
    const nutritionSource = p?.nutritionSource ?? null;

    return (
      <MealChipExpanded
        baseCard={baseCard}
        inactive={inactive}
        busy={busy}
        mealName={mealName}
        macroStr={macroStr}
        timeStr={timeStr}
        itemsForExpand={itemsForExpand}
        mealPrepId={mealPrepId}
        nutritionSource={nutritionSource}
        totalAlcoholG={totalAlcoholG}
        showQueueBadge={showQueueBadge}
        mealChipIndex={mealChipIndex}
        mealChipTotal={mealChipTotal}
        t={t}
        onCancel={onCancel}
        onOpenEngine={onOpenEngine}
      />
    );
  }

  // ── Fingerstick chip layout ───────────────────────────────────────
  // Prominent value display + warning colour if outside 70–180 mg/dL.
  // Buttons: [Schnell speichern] [Fingerstick-Details öffnen →]
  if (pa.kind === "log_fingerstick") {
    const match = pa.summary.match(/(\d+)\s*mg\/dL/);
    const valueMgdl = match ? parseInt(match[1], 10) : null;
    const isLow     = valueMgdl != null && valueMgdl < 70;
    const isHigh    = valueMgdl != null && valueMgdl > 180;
    const isOutOfRange = isLow || isHigh;
    const WARNING = "#F59E0B";

    return (
      <div
        style={{
          ...baseCard,
          position: "relative",
          borderColor: isOutOfRange ? `${WARNING}55` : undefined,
        }}
      >
        {/* ✕ dismiss button — top right corner */}
        <button
          type="button"
          aria-label={t.discard}
          onClick={onCancel}
          disabled={busy}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "none",
            border: "none",
            cursor: busy ? "default" : "pointer",
            padding: 4,
            color: "var(--text-muted)",
            fontSize: 14,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy ? 0.5 : 1,
          }}
        >
          ✕
        </button>

        {/* Type label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            paddingRight: 20,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <span>🩸</span>
          <span>{t.fingerstick_label}</span>
        </div>

        {/* Value + time */}
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            color: isOutOfRange ? WARNING : "var(--text-strong)",
            letterSpacing: "-0.02em",
          }}
        >
          {valueMgdl != null ? `${valueMgdl} mg/dL` : pa.summary}
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-muted)",
              marginLeft: 6,
              fontFamily: "inherit",
              letterSpacing: "0",
            }}
          >
            · {t.now}
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onQuickSave ?? onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: busy ? "rgba(139,92,246,0.35)" : ACCENT,
              color: "var(--on-accent)",
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? t.saving : t.quick_save}
          </button>
          {!!onDetailOpen && (
            <button
              type="button"
              onClick={onDetailOpen}
              disabled={busy}
              style={{
                flex: 1,
                padding: "9px 10px",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--surface-soft)",
                color: "var(--text-body)",
                fontSize: 13,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {t.fingerstick_details}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Cycle chip layout (log_cycle_entry) ──────────────────────────
  // Mini preview with structured pills: mode badge + detail + date.
  // "Schnell speichern" saves directly; "Zyklus-Details öffnen →"
  // navigates to /engine?tab=log with the CycleForm pre-filled.
  if (pa.kind === "log_cycle_entry") {
    const CYCLE_PINK = "#FF2D78";
    // Parse the summary: "Zyklus: Mittlere Blutung ab 2026-06-04"
    // or "Zyklus: Eisprung ab 2026-06-04 bis 2026-06-07"
    const stripped = pa.summary.replace(/^Zyklus:\s*/i, "");
    const abIdx = stripped.indexOf(" ab ");
    const typeLabel = abIdx > -1 ? stripped.slice(0, abIdx) : stripped;
    const datePart = abIdx > -1 ? stripped.slice(abIdx + 4) : "";
    // Date: take only the first date before any " bis "
    const dateLabel = datePart.split(" bis ")[0] ?? datePart;
    const isBleeding = typeLabel.endsWith("Blutung");
    const modeBadge = isBleeding ? "Blutung" : "Phase";
    // Extract intensity word from e.g. "Mittlere Blutung" → "Mittel"
    const intensityMap: Record<string, string> = {
      Leichte: "Leicht",
      Mittlere: "Mittel",
      Starke: "Stark",
    };
    let detailBadge = typeLabel;
    if (isBleeding) {
      const intensityWord = typeLabel.replace(" Blutung", "");
      detailBadge = intensityMap[intensityWord] ?? intensityWord;
    }

    const pillStyle = (accent: string): React.CSSProperties => ({
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 8px",
      borderRadius: 8,
      background: `${accent}18`,
      border: `1px solid ${accent}35`,
      color: accent,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "-0.01em",
    });

    return (
      <div style={{ ...baseCard, position: "relative" }}>
        {/* ✕ dismiss button — top right corner */}
        <button
          type="button"
          aria-label={t.discard}
          onClick={onCancel}
          disabled={busy}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "none",
            border: "none",
            cursor: busy ? "default" : "pointer",
            padding: 4,
            color: "var(--text-muted)",
            fontSize: 14,
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: busy ? 0.5 : 1,
          }}
        >
          ✕
        </button>

        {/* Header row: 🌙 ZYKLUS */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            paddingRight: 20,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <span>🌙</span>
          <span>{t.cycle_label}</span>
        </div>

        {/* Mini preview pills: [Blutung/Phase] · [Detail] · [Datum] */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={pillStyle(CYCLE_PINK)}>{modeBadge}</span>
          <span style={{ color: "var(--text-faint)", fontSize: 12 }}>·</span>
          <span style={pillStyle(CYCLE_PINK)}>{detailBadge}</span>
          {dateLabel && (
            <>
              <span style={{ color: "var(--text-faint)", fontSize: 12 }}>·</span>
              <span style={pillStyle("var(--text-dim)")}>{dateLabel}</span>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onQuickSave ?? onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              padding: "9px 10px",
              borderRadius: 8,
              border: "none",
              background: busy ? `${CYCLE_PINK}55` : CYCLE_PINK,
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? t.saving : t.quick_save}
          </button>
          {!!onDetailOpen && (
            <button
              type="button"
              onClick={onDetailOpen}
              disabled={busy}
              style={{
                flex: 1,
                padding: "9px 10px",
                borderRadius: 8,
                border: `1px solid ${CYCLE_PINK}40`,
                background: `${CYCLE_PINK}0d`,
                color: CYCLE_PINK,
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {t.cycle_details}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── log_insulin mini-preview chip ────────────────────────────────
  // Special layout: brand · units IE · Bolus/Basal badge · time
  // Buttons: [Schnell speichern] [Bolus-Details → / Basal-Details →] + ✕
  if (pa.kind === "log_insulin") {
    const p = pa.payload as {
      units?: number;
      insulin_name?: string;
      insulin_type?: string;
      logged_at?: string;
    } | undefined;
    const iType = p?.insulin_type === "basal" ? "basal" : "bolus";
    const iName = p?.insulin_name ?? (iType === "bolus" ? "Bolus" : "Basal");
    const iUnits = p?.units ?? 0;
    const iTime = (() => {
      if (!p?.logged_at) return t.now;
      const ms = new Date(p.logged_at).getTime();
      if (!Number.isFinite(ms)) return t.now;
      const deltaMin = Math.round((Date.now() - ms) / 60_000);
      if (deltaMin <= 2) return t.now;
      if (deltaMin < 60) return t.mins_ago(deltaMin);
      const hr = Math.round(deltaMin / 60);
      if (hr < 24) return t.hours_ago(hr);
      return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    })();
    const typeBadgeColor = iType === "bolus" ? "#4F6EF7" : "#10b981";
    const detailLabel = iType === "bolus" ? t.bolus_details : t.basal_details;

    return (
      <div style={{ ...baseCard, position: "relative" }}>
        {/* ✕ dismiss button */}
        <button
          type="button"
          aria-label={t.discard}
          onClick={onCancel}
          disabled={busy}
          style={{
            position: "absolute", top: 8, right: 8,
            background: "none", border: "none",
            cursor: busy ? "default" : "pointer",
            padding: 4, color: "var(--text-muted)", fontSize: 14,
            lineHeight: 1, display: "flex", alignItems: "center",
            justifyContent: "center", opacity: busy ? 0.5 : 1,
          }}
        >✕</button>

        {/* Mini preview row: brand · units IE · badge · time */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingRight: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-strong)" }}>
            {iName}
          </span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 13,
            color: "var(--text-body)", fontWeight: 600,
          }}>
            {iUnits} IE
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
            padding: "2px 7px", borderRadius: 20,
            background: `${typeBadgeColor}18`,
            border: `1px solid ${typeBadgeColor}40`,
            color: typeBadgeColor,
            textTransform: "uppercase" as const,
          }}>
            {iType === "bolus" ? "Bolus" : "Basal"}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {iTime}
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onQuickSave ?? onConfirm}
            disabled={busy}
            style={{
              flex: 1, padding: "9px 10px", borderRadius: 8, border: "none",
              background: busy ? "rgba(79,110,247,0.35)" : "#4F6EF7",
              color: "var(--on-accent)", fontWeight: 600, fontSize: 13,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? t.saving : t.quick_save}
          </button>
          {onDetailOpen && (
            <button
              type="button"
              onClick={onDetailOpen}
              disabled={busy}
              style={{
                flex: 1,
                padding: "9px 10px", borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--surface-soft)",
                color: "var(--text-body)", fontSize: 13,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {detailLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Non-meal chip layout (Bolus, Exercise, Symptom, …) ───────────
  // ✕ icon top-right + type label + summary + [Schnell speichern] [Detail →]
  const { icon, label } = getActionMeta(pa.kind);
  const hasDetail = !!onDetailOpen;

  return (
    <div style={{ ...baseCard, position: "relative" }}>
      {/* ✕ dismiss button — top right corner */}
      <button
        type="button"
        aria-label={t.discard}
        onClick={onCancel}
        disabled={busy}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "none",
          border: "none",
          cursor: busy ? "default" : "pointer",
          padding: 4,
          color: "var(--text-muted)",
          fontSize: 14,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: busy ? 0.5 : 1,
        }}
      >
        ✕
      </button>

      {/* Type label row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          paddingRight: 20,
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        <span>{icon}</span>
        <span>{label}</span>
      </div>

      {/* Summary text */}
      <div style={{ color: "var(--text-body)", fontSize: 12, paddingRight: 24 }}>
        {pa.summary}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onQuickSave ?? onConfirm}
          disabled={busy}
          style={{
            flex: 1,
            padding: "9px 10px",
            borderRadius: 8,
            border: "none",
            background: busy ? "rgba(139,92,246,0.35)" : ACCENT,
            color: "var(--on-accent)",
            fontWeight: 600,
            fontSize: 13,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? t.saving : t.quick_save}
        </button>
        {hasDetail && (
          <button
            type="button"
            onClick={onDetailOpen}
            disabled={busy}
            style={{
              flex: 1,
              padding: "9px 10px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface-soft)",
              color: "var(--text-body)",
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {t.detail}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Bottom-sheet UI hosting the Glev AI conversation. Token-by-token
 * streaming is driven by the parent (useGlevAI) — each assistant
 * bubble grows as new chunks arrive and shows a soft caret while
 * `isStreaming` is true.
 *
 * Renders inside the Capacitor webview shell: uses dvh + safe-area
 * insets so the input row stays above the on-screen keyboard and the
 * home indicator.
 */
export default function GlevAIChatSheet({
  open,
  onClose,
  messages,
  streaming,
  onSend,
  onConfirmAction,
  onCancelAction,
  onOpenEngineForMeal,
  onQuickSaveAction,
  onDetailOpen,
  onClearChat,
  onListeningChange,
  pendingMealNavQueue,
  onMealNavTap,
  voiceIntentEnabled = false,
  variant = "sheet",
}: Props) {
  const locale = useLocale();
  const t = locale === "en" ? COPY.en : COPY.de;
  const isFullscreen = variant === "fullscreen";
  const [input, setInput] = useState("");
  const [sttError, setSttError] = useState<string | null>(null);
  const [sttPartial, setSttPartial] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachToast, setAttachToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (pendingAttachments.length + arr.length > 3) {
      setAttachToast(t.attach_limit);
      setTimeout(() => setAttachToast(null), 3000);
      return;
    }
    for (const file of arr) {
      if (file.size > 5 * 1024 * 1024) {
        setAttachToast(t.attach_too_large);
        setTimeout(() => setAttachToast(null), 3000);
        return;
      }
      const nameLower = file.name.toLowerCase();
      const isHeic =
        file.type === "image/heic" || file.type === "image/heif" ||
        nameLower.endsWith(".heic") || nameLower.endsWith(".heif");
      if (isHeic) {
        setAttachToast(t.attach_converting);
        try {
          const heic2any = (await import("heic2any")).default;
          const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
          const jpegBlob = Array.isArray(result) ? result[0] : result;
          const jpegName = file.name.replace(/\.hei[cf]$/i, ".jpg");
          const jpegFile = new File([jpegBlob], jpegName, { type: "image/jpeg" });
          setAttachToast(null);
          const preview = URL.createObjectURL(jpegFile);
          setPendingAttachments((prev) => [
            ...prev,
            { id: `${Date.now()}-${Math.random()}`, file: jpegFile, preview, mimeType: "image/jpeg", fileName: jpegFile.name },
          ]);
        } catch {
          setAttachToast(t.attach_heic);
          setTimeout(() => setAttachToast(null), 5000);
        }
        continue;
      }
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setPendingAttachments((prev) => [
        ...prev,
        { id: `${Date.now()}-${Math.random()}`, file, preview, mimeType: file.type, fileName: file.name },
      ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAttachments.length, t.attach_limit, t.attach_too_large, t.attach_converting, t.attach_heic]);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // Revoke preview URLs when sheet closes to avoid memory leaks.
  useEffect(() => {
    if (!open) {
      setPendingAttachments((prev) => {
        prev.forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); });
        return [];
      });
    }
  }, [open]);

  // Drag-to-dismiss: swipe the handle down ≥ 80 px to close the sheet.
  // Using a ref for startY avoids stale-closure issues in the move handler.
  const dragStartYRef = useRef<number | null>(null);
  const [dragTranslate, setDragTranslate] = useState(0);

  const handleDragStart = (e: React.TouchEvent) => {
    dragStartYRef.current = e.touches[0].clientY;
    setDragTranslate(0);
  };
  const handleDragMove = (e: React.TouchEvent) => {
    if (dragStartYRef.current === null) return;
    const dy = e.touches[0].clientY - dragStartYRef.current;
    if (dy > 0) setDragTranslate(dy);
  };
  const handleDragEnd = () => {
    if (dragStartYRef.current === null) return;
    const threshold = 80;
    const shouldClose = dragTranslate >= threshold;
    dragStartYRef.current = null;
    setDragTranslate(0);
    if (shouldClose) onClose();
  };

  // Auto-send ref so we can access latest onSend + input without
  // capturing a stale closure inside useVoxtral.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const inputRef2 = useRef(input);
  inputRef2.current = input;

  const {
    isListening,
    isTranscribing,
    startListening,
    stopListening,
    voiceCountdown,
    pendingIntent,
    confirmPendingIntent,
    dismissPendingIntent,
  } = useVoiceIntents({
    // When voice_intent_routing is enabled and the classifier returns
    // fallback_chat (or is disabled), the transcript is sent normally.
    onFallbackTranscript: (text) => {
      setSttError(null);
      setSttPartial(null);
      if (!text.trim()) return;
      // Voice → auto-send immediately (Siri-Modus).
      // If the user had partial typed text, prepend it so nothing is lost.
      const combined = inputRef2.current
        ? `${inputRef2.current} ${text}`.trim()
        : text.trim();
      setInput("");
      onSendRef.current(combined);
    },
    onPartialTranscript: (text) => {
      setSttError(null);
      setSttPartial(text);
    },
    onError: (err) => {
      setSttPartial(null);
      setSttError(err);
    },
    enabled: voiceIntentEnabled,
  });

  const tts = useTTS();

  // TTS: announce recognised intent aloud as soon as pendingIntent is set.
  // Only fires when tts.enabled AND tts.intentAnnounce (opt-in, default off).
  // The speech starts immediately — before the chip animation — so the user
  // hears feedback without looking at the screen.
  useEffect(() => {
    if (!pendingIntent) return;
    if (!tts.enabled || !tts.intentAnnounce) return;
    void tts.speak(intentLabel(pendingIntent, locale === "en" ? "en" : "de"));
  // tts.speak and tts.stop are stable callbacks; only run when pendingIntent changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIntent]);

  // TTS: auto-play last assistant message when streaming stops.
  // Controlled by tts.autoRead (user preference set in the chat header).
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !streaming && tts.enabled && tts.autoRead) {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant" && last.content) {
        void tts.speak(last.content, last.id);
      }
    }
    prevStreamingRef.current = streaming;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // Global FAB voice-start: when the user taps the Glev button while
  // the sheet is already open, we immediately start recording so they
  // can speak without finding the in-sheet mic button.
  useEffect(() => {
    if (!open) return;
    const handler = () => { void startListening(); };
    window.addEventListener("glev:voice-start", handler);
    return () => window.removeEventListener("glev:voice-start", handler);
  }, [open, startListening]);

  // Stop TTS when the sheet closes.
  useEffect(() => {
    if (!open) tts.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tap-anywhere-to-stop for the chat mic.
  // Same pattern as voiceRecordingContext: 250ms grace so the tap that
  // started recording doesn't immediately cancel it. Skips the mic button
  // itself (data-glev-mic) and the FAB (data-glev-fab) so their own
  // handlers stay in charge.
  useEffect(() => {
    if (!isListening) return;
    let armed = false;
    const timer = window.setTimeout(() => { armed = true; }, 250);
    const onDown = (e: PointerEvent) => {
      if (!armed) return;
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("[data-glev-mic]") || target.closest('[data-glev-fab="true"]')) return;
      stopListening();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [isListening, stopListening]);

  // Notify parent whenever the chat sheet's STT listening state changes so
  // the FAB in Layout.tsx can show the listening animation independently of
  // the engine voice-recording state (voice.recording).
  useEffect(() => {
    onListeningChange?.(isListening);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  // Broadcast TTS speaking state + AnalyserNode so the FAB can animate.
  // analyserRef.current is already set before audio.play() triggers onplay,
  // so it's populated when tts.speaking flips to true.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("glev:tts-speaking", {
        detail: { active: tts.speaking, analyser: tts.analyserRef.current },
      }),
    );
  }, [tts.speaking, tts.analyserRef]);

  // Auto-dismiss STT error after 6 s. Permission-denied errors stay visible
  // until the user retries — they require an explicit action (go to settings).
  useEffect(() => {
    if (!sttError || sttError === MIC_PERM_DENIED) return;
    const timer = window.setTimeout(() => setSttError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [sttError]);

  // E2E test bridge — exposes setSttError so Playwright tests can inject
  // error state directly without requiring a real mic / live API failure.
  // No-ops in production (just sets a window property nothing else reads).
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as Record<string, unknown>)["__glevTestSetSttError"] =
      setSttError;
    return () => {
      delete (window as unknown as Record<string, unknown>)[
        "__glevTestSetSttError"
      ];
    };
  }, [setSttError]);

  // Bewusst KEIN Auto-Focus beim Öffnen: das Software-Keyboard würde
  // sonst auf iOS/Android sofort die halbe Sheet-Höhe verschlucken und
  // den Disclaimer/Input-Footer überdecken. Tastatur kommt erst wenn
  // der User aktiv ins Input-Feld tippt. Siehe Fix Log 2026-05-24
  // (Glev AI: Tastatur nicht beim Öffnen des AI-Chats automatisch).

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  if (!open) return null;

  const submit = async () => {
    const text = input.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || streaming || uploading) return;
    setSttError(null);
    setInput("");

    let resolvedAttachments: ChatAttachment[] | undefined;
    if (hasAttachments) {
      setUploading(true);
      const uploaded: ChatAttachment[] = [];
      for (const att of pendingAttachments) {
        try {
          const fd = new FormData();
          fd.append("file", att.file);
          const res = await fetch("/api/ai/upload", { method: "POST", body: fd });
          if (res.ok) {
            const data = await res.json() as { url: string; mimeType: string; fileName: string };
            uploaded.push({ url: data.url, mimeType: data.mimeType, fileName: data.fileName });
          }
        } catch {
          /* non-fatal: skip failed uploads */
        }
      }
      // Revoke preview URLs
      pendingAttachments.forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); });
      setPendingAttachments([]);
      setUploading(false);
      if (uploaded.length > 0) resolvedAttachments = uploaded;
    }

    onSend(text, resolvedAttachments);
  };

  return (
    <>
      <style>{`
        @keyframes glevAiFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes glevAiSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes glevAiCaret { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
        @keyframes glevBtnGlowFast {
          0%, 100% { box-shadow: 0 0 0 0 rgba(79,110,247,0.7); transform: scale(1); }
          50% { box-shadow: 0 0 0 8px rgba(79,110,247,0); transform: scale(1.08); }
        }
        @keyframes glevStatusPulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
      `}</style>

      {/* Backdrop — sheet mode only */}
      {!isFullscreen && (
        <div
          onClick={onClose}
          role="presentation"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: "var(--nav-bottom-total)",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            zIndex: 1100,
            animation: "glevAiFadeIn 0.2s ease",
          }}
        />
      )}

      {/* Sheet / Fullscreen container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Glev AI Chat"
        style={isFullscreen ? {
          position: "fixed",
          top: "var(--nav-top-total)",
          bottom: "var(--nav-bottom-total)",
          left: 0,
          right: 0,
          height: "auto",
          background: SHEET_BG,
          color: "var(--text)",
          borderRadius: 0,
          border: "none",
          zIndex: 1101,
          display: "flex",
          flexDirection: "column",
          animation: "glevAiFadeIn 0.18s ease",
          overflow: "hidden",
        } : {
          position: "fixed",
          bottom: "var(--nav-bottom-total)",
          left: 0,
          right: 0,
          height: "calc(85dvh - var(--nav-bottom-total))",
          background: SHEET_BG,
          color: "var(--text)",
          borderRadius: "20px 20px 0 0",
          border: "1px solid var(--border)",
          borderBottom: "none",
          zIndex: 1101,
          display: "flex",
          flexDirection: "column",
          animation: dragTranslate > 0 ? "none" : "glevAiSlideUp 0.3s cubic-bezier(0.32,0.72,0,1)",
          overflow: "hidden",
          transform: dragTranslate > 0 ? `translateY(${dragTranslate}px)` : "translateY(0)",
          transition: dragTranslate > 0 ? "none" : "transform 0.22s cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* Drag handle — sheet mode only, swipe down ≥ 80 px to close */}
        {!isFullscreen && (
          <div
            aria-hidden="true"
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
            onTouchCancel={handleDragEnd}
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              paddingTop: 10,
              paddingBottom: 4,
              cursor: "grab",
              touchAction: "none",
              userSelect: "none",
            }}
          >
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: "var(--border)",
                opacity: 0.8,
              }}
            />
          </div>
        )}

        {/* Header strip: close/back (left) + reset button (right) */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 4px 0 4px",
            background: SHEET_BG,
            borderBottom: "1px solid var(--border-soft)",
            minHeight: 44,
          }}
        >
          {/* Close / back button */}
          <button
            type="button"
            aria-label={isFullscreen ? t.back : t.close}
            onClick={onClose}
            style={{
              minWidth: 44,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-dim)",
              opacity: 0.75,
              padding: 0,
              flexShrink: 0,
              borderRadius: 8,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.75"; }}
          >
            {isFullscreen ? (
              /* Back chevron */
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            ) : (
              /* Close X */
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          </button>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Revoke AI access */}
          <ResetButton onRevoked={() => { onClearChat?.(); onClose(); }} />
        </div>

        {/* Messages */}
        <div
          ref={scrollerRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: PAGE_BG,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 14,
                textAlign: "center",
                padding: "30px 12px",
              }}
            >
              {t.empty_state}
            </div>
          )}

          {messages.map((m, mIdx) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: m.role === "user" ? "flex-end" : "flex-start",
                gap: 6,
              }}
            >
              <div
                style={{
                  maxWidth: "82%",
                  padding: "10px 14px",
                  borderRadius:
                    m.role === "user"
                      ? "18px 18px 4px 18px"
                      : "18px 18px 18px 4px",
                  background:
                    m.role === "user" ? ACCENT : "var(--surface-soft)",
                  color: m.role === "user" ? "var(--on-accent)" : "var(--text-strong)",
                  border:
                    m.role === "assistant"
                      ? "1px solid var(--border-soft)"
                      : "none",
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content || (m.isStreaming ? "·" : (m.role === "assistant" ? "···" : ""))}
                {m.isStreaming && m.content.length > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 14,
                      marginLeft: 3,
                      verticalAlign: "text-bottom",
                      background: "var(--text-body)",
                      animation: "glevAiCaret 0.9s ease-in-out infinite",
                      borderRadius: 1,
                    }}
                  />
                )}
              </div>

              {/* Per-bubble speaker icon — only for finished assistant messages */}
              {m.role === "assistant" && !m.isStreaming && m.content && (() => {
                const isThisBubblePlaying = tts.speakingId === m.id;
                return (
                  <button
                    type="button"
                    aria-label={isThisBubblePlaying ? t.stop_playback : t.read_aloud}
                    onClick={() => {
                      if (isThisBubblePlaying) {
                        tts.stop();
                      } else {
                        void tts.speak(m.content, m.id);
                      }
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "2px 4px",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
                      color: isThisBubblePlaying ? ACCENT : "var(--text-faint)",
                      fontSize: 11,
                      lineHeight: 1,
                      transition: "color 0.15s",
                      animation: isThisBubblePlaying ? "glevBtnGlowFast 0.7s ease-in-out infinite" : "none",
                      borderRadius: 6,
                    }}
                    onMouseEnter={(e) => {
                      if (!isThisBubblePlaying) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-body)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isThisBubblePlaying) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-faint)";
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                  </button>
                );
              })()}

              {/* Retry button — shown below assistant error bubbles when the error
                  is transient (retryAllowed=true) and a previous user message exists.
                  Re-sends the last user message that preceded this bubble. */}
              {m.role === "assistant" && m.retryAllowed && !m.isStreaming && (() => {
                const prevUser = messages.slice(0, mIdx).reverse().find((p) => p.role === "user");
                if (!prevUser) return null;
                return (
                  <button
                    type="button"
                    onClick={() => onSend(prevUser.content)}
                    style={{
                      alignSelf: "flex-start",
                      background: "none",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 8,
                      color: "var(--text-body)",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: "5px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/>
                      <path d="M3.51 15a9 9 0 1 0 .49-3.96"/>
                    </svg>
                    {t.retry}
                  </button>
                );
              })()}

              {/* Pending-action widgets — one chip per WRITE-tool call in this turn.
                  For log_meal_entry chips: only the first *unresolved* (pending/confirming)
                  meal chip is active; all later unresolved ones are dimmed and show
                  a "Mahlzeit N von M" badge so the user knows more are queued. */}
              {(() => {
                const actions = m.pendingActions ?? [];
                const totalUnresolvedMeals = actions.filter(
                  (a) =>
                    a.kind === "log_meal_entry" &&
                    (a.state === "pending" || a.state === "confirming"),
                ).length;
                let seenUnresolvedMeal = false;
                let mealChipPosition = 0;
                return actions.map((pa) => {
                  let isMealChipActive: boolean | undefined;
                  let mealChipIndex: number | undefined;
                  if (pa.kind === "log_meal_entry") {
                    const isUnresolved =
                      pa.state === "pending" || pa.state === "confirming";
                    if (isUnresolved) {
                      mealChipPosition += 1;
                      mealChipIndex = mealChipPosition;
                    }
                    if (isUnresolved && !seenUnresolvedMeal) {
                      isMealChipActive = true;
                      seenUnresolvedMeal = true;
                    } else if (isUnresolved) {
                      isMealChipActive = false;
                    } else {
                      isMealChipActive = true;
                    }
                  }
                  // Influence-Prep chip (Dual-Emission: alcohol linked to a meal).
                  if (pa.kind === "log_influence_entry" && pa.payload &&
                      typeof (pa.payload as Record<string, unknown>).influence_type === "string" &&
                      (pa.payload as Record<string, unknown>).influence_type === "alcohol" &&
                      typeof (pa.payload as Record<string, unknown>).source_meal_token === "string") {
                    return (
                      <InfluencePrepChip
                        key={pa.token}
                        payload={pa.payload as InfluencePrepPayload}
                        state={pa.state}
                        error={pa.error}
                        onConfirm={() => onConfirmAction?.(m.id, pa.token)}
                        onCancel={() => onCancelAction?.(m.id, pa.token)}
                      />
                    );
                  }

                  return (
                    <PendingActionWidget
                      key={pa.token}
                      pa={pa}
                      onConfirm={() => onConfirmAction?.(m.id, pa.token)}
                      onCancel={() => onCancelAction?.(m.id, pa.token)}
                      onOpenEngine={() => onOpenEngineForMeal?.(m.id, pa.token)}
                      onQuickSave={
                        onQuickSaveAction
                          ? () => onQuickSaveAction(m.id, pa.token)
                          : undefined
                      }
                      onDetailOpen={
                        onDetailOpen
                          ? () => onDetailOpen(m.id, pa.token, pa.kind, pa.payload)
                          : undefined
                      }
                      isMealChipActive={isMealChipActive}
                      mealChipIndex={mealChipIndex}
                      mealChipTotal={
                        totalUnresolvedMeals > 1 ? totalUnresolvedMeals : undefined
                      }
                      t={t}
                    />
                  );
                });
              })()}
            </div>
          ))}
        </div>

        {/* Intent confirmation chip — shown for 2-3 s after voice classification */}
        {pendingIntent && (
          <IntentConfirmChip
            intent={pendingIntent}
            onConfirm={confirmPendingIntent}
            onDismiss={dismissPendingIntent}
          />
        )}

        {/* Attachment preview chips — visible above the input row when files are queued */}
        {pendingAttachments.length > 0 && (
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: "6px 16px 0",
              background: SHEET_BG,
            }}
          >
            {pendingAttachments.map((att) => (
              <div
                key={att.id}
                style={{
                  position: "relative",
                  width: 52,
                  height: 52,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                  background: "var(--surface-soft)",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {att.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={att.preview}
                    alt={att.fileName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                )}
                <button
                  type="button"
                  aria-label={t.attach_remove}
                  onClick={() => removeAttachment(att.id)}
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    background: "rgba(0,0,0,0.55)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 10,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attachment error toast */}
        {attachToast && (
          <div
            style={{
              flexShrink: 0,
              padding: "4px 16px 0",
              fontSize: 11,
              color: "#ff8888",
              background: SHEET_BG,
            }}
          >
            {attachToast}
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />

        {/* Input row: [📷] [📎] [text field] [🎤 / ➤] */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 16px 8px",
            background: SHEET_BG,
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          {/* Camera button */}
          <button
            type="button"
            aria-label="Foto aufnehmen"
            disabled={streaming || uploading}
            onClick={() => cameraInputRef.current?.click()}
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: 17,
              border: "1px solid var(--border)",
              background: "var(--surface-alt)",
              cursor: streaming || uploading ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: streaming || uploading ? 0.4 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {/* Camera icon (inline SVG — Lucide style) */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>

          {/* Paperclip button */}
          <button
            type="button"
            aria-label="Datei anhängen"
            disabled={streaming || uploading}
            onClick={() => fileInputRef.current?.click()}
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: 17,
              border: "1px solid var(--border)",
              background: "var(--surface-alt)",
              cursor: streaming || uploading ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: streaming || uploading ? 0.4 : 1,
              transition: "opacity 0.15s",
            }}
          >
            {/* Paperclip icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>

          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={uploading ? t.attach_uploading : input}
            onChange={(e) => { if (!uploading) setInput(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={isListening ? t.placeholder_listening : t.placeholder_idle}
            disabled={streaming || uploading}
            style={{
              flex: 1,
              border: `1px solid ${isListening ? `${ACCENT}66` : "var(--border)"}`,
              borderRadius: 20,
              padding: "10px 14px",
              background: "var(--surface-soft)",
              color: uploading ? "var(--text-dim)" : "var(--text)",
              fontSize: 14,
              outline: "none",
              opacity: streaming || uploading ? 0.7 : 1,
              transition: "border-color 0.2s",
            }}
          />

          {/* Mic / Send — shows mic when no text+attachments, send otherwise */}
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            {!input.trim() && pendingAttachments.length === 0 && !uploading ? (
              /* Mic button — hold to talk */
              <button
                type="button"
                data-glev-mic="true"
                disabled={!!voiceCountdown}
                aria-label={voiceCountdown ? t.mic_rate_limit(voiceCountdown) : isListening ? t.mic_stop : t.mic_start}
                aria-pressed={isListening}
                onPointerDown={(e) => {
                  if (voiceCountdown) return;
                  e.preventDefault();
                  setSttError(null);
                  setSttPartial(null);
                  void startListening();
                }}
                onPointerUp={() => { if (!voiceCountdown) stopListening(); }}
                onPointerLeave={() => { if (isListening && !voiceCountdown) stopListening(); }}
                style={{
                  flexShrink: 0,
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  border: voiceCountdown
                    ? "1px solid var(--border-soft)"
                    : isListening ? `1px solid ${ACCENT}` : "1px solid var(--border)",
                  cursor: voiceCountdown ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: voiceCountdown
                    ? "var(--surface-alt)"
                    : isListening ? "rgba(139,92,246,0.12)" : "var(--surface-alt)",
                  opacity: voiceCountdown ? 0.4 : 1,
                  touchAction: "none",
                  transition: "background 0.15s, border-color 0.15s, opacity 0.15s",
                }}
              >
                {isListening ? (
                  /* Spinning Glev logo while listening */
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", animation: "glevIconSpin 1.6s linear infinite" }}>
                    <GlevLogo size={18} color={ACCENT} bg="transparent" />
                  </span>
                ) : (
                  /* Mic icon at rest */
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={voiceCountdown ? "var(--text-dim)" : "var(--text-dim)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                )}
                <style>{`
                  @keyframes glevIconSpin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                  }
                `}</style>
              </button>
            ) : (
              /* Send button — active when text or attachments present */
              <button
                type="button"
                onClick={() => void submit()}
                disabled={streaming || uploading}
                aria-label={t.send}
                style={{
                  flexShrink: 0,
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  background: streaming || uploading ? "rgba(79,110,247,0.4)" : ACCENT,
                  border: "none",
                  cursor: streaming || uploading ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--on-accent)">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            )}
            {voiceCountdown && !input.trim() && pendingAttachments.length === 0 ? (
              <span
                data-testid="stt-rate-limit-countdown"
                style={{ fontSize: 9, color: "var(--text-dim)", lineHeight: 1, whiteSpace: "nowrap" }}
              >
                {t.mic_rate_limit(voiceCountdown)}
              </span>
            ) : null}
          </div>
        </div>

        {/* STT partial transcript — greyed-out live preview while speaking */}
        {isListening && sttPartial && (
          <div
            style={{
              flexShrink: 0,
              padding: "2px 16px 4px",
              fontSize: 12,
              color: "var(--text-faint)",
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sttPartial}
          </div>
        )}

        {/* STT error — permission-denied gets a persistent actionable banner;
            all other errors get the brief auto-dismissing red toast */}
        {sttError === MIC_PERM_DENIED ? (
          <div
            data-testid="stt-error-banner"
            style={{
              flexShrink: 0,
              padding: "8px 16px 10px",
              background: "rgba(139,92,246,0.08)",
              borderTop: "1px solid rgba(139,92,246,0.2)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center", lineHeight: 1.4 }}>
              {t.mic_perm_denied}
            </span>
            <button
              type="button"
              onClick={() => {
                setSttError(null);
                void startListening();
              }}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: ACCENT,
                background: "none",
                border: `1px solid ${ACCENT}`,
                borderRadius: 12,
                padding: "3px 12px",
                cursor: "pointer",
              }}
            >
              {t.mic_perm_retry}
            </button>
          </div>
        ) : sttError ? (
          <div
            data-testid="stt-error-banner"
            style={{
              flexShrink: 0,
              padding: "4px 16px 6px",
              background: SHEET_BG,
              fontSize: 11,
              color: "#ff8888",
              textAlign: "center",
            }}
          >
            {sttError}
          </div>
        ) : null}

        {/* Disclaimer footer — below input row, always visible */}
        <div
          style={{
            flexShrink: 0,
            padding: "0 18px calc(10px + env(safe-area-inset-bottom, 0px))",
            background: SHEET_BG,
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--text-dim)",
            textAlign: "center",
          }}
        >
          {t.disclaimer}
        </div>
      </div>
    </>
  );
}

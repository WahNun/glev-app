// UI helper: render structured `AdjustmentMessage[]` produced by
// `lib/engine/*` into a localized string using next-intl's `t()`.
//
// Engine code stays free of i18n imports and emits stable keys plus
// param objects. The renderer here is the single place that walks
// those into translated text. The lookup falls back to the bare key
// (and dim-prints a console warning) when a key is missing so UI
// surfaces still render something readable while a translation is
// being added.

import type { AdjustmentMessage } from "@/lib/engine/adjustment";

type TFn = (key: string, params?: Record<string, string | number | Date>) => string;

/**
 * Render one engine message via the supplied next-intl translator.
 * Always namespaced under `engine`, so callers should pass a
 * `useTranslations("engine")` instance (or compatible function).
 *
 * `params.classKey` is auto-resolved through `t()` so the inner class
 * label (fast carbs / balanced / …) is also localized — it lets the
 * engine layer stay key-only without hard-coding any English.
 */
export function renderEngineMessage(t: TFn, m: AdjustmentMessage): string {
  const params: Record<string, string | number | Date> = {};
  if (m.params) {
    for (const [k, v] of Object.entries(m.params)) {
      if (k === "classKey" && typeof v === "string") {
        params.classLabel = safeT(t, v, v);
      } else if (k === "window" && typeof v === "string" && v.startsWith("engine_lc_window_")) {
        params.window = safeT(t, v, v);
      } else {
        params[k] = v;
      }
    }
  }
  return safeT(t, m.key, m.key, params);
}

export function renderEngineMessages(t: TFn, messages: AdjustmentMessage[], sep: string = " "): string {
  return messages.map(m => renderEngineMessage(t, m)).join(sep);
}

function safeT(t: TFn, key: string, fallback: string, params?: Record<string, string | number | Date>): string {
  try {
    return t(key, params);
  } catch {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn(`[engineMessages] missing translation for "${key}"`);
    }
    return fallback;
  }
}

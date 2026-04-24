"use client";

import { useEffect, useRef, useState } from "react";

export type OrderKey = "dashboard" | "insights";

type PrefsResponse = {
  dashboard_card_order?: string[];
  insights_card_order?: string[];
};

/**
 * useCardOrder
 *
 * Loads the user's saved card order for `orderKey` from /api/preferences and
 * exposes a setter that persists changes back. While the initial GET is in
 * flight `loaded` is false and `order` is the supplied default.
 *
 * The setter is debounced (250ms) so a flurry of drags only writes once.
 */
export function useCardOrder(orderKey: OrderKey, defaultOrder: string[]) {
  const [order, setOrderState] = useState<string[]>(defaultOrder);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/preferences", { credentials: "include" })
      .then(r => r.ok ? r.json() : ({} as PrefsResponse))
      .then((data: PrefsResponse) => {
        if (cancelled) return;
        const saved = orderKey === "dashboard" ? data.dashboard_card_order : data.insights_card_order;
        if (Array.isArray(saved) && saved.length > 0) {
          setOrderState(saved);
        }
      })
      .catch(() => { /* swallow — fall back to defaults */ })
      .finally(() => { if (!cancelled) setLoaded(true); });

    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  function setOrder(newOrder: string[]) {
    setOrderState(newOrder);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const body = orderKey === "dashboard"
        ? { dashboard_card_order: newOrder }
        : { insights_card_order: newOrder };
      fetch("/api/preferences", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => { /* best effort — local state is already updated */ });
    }, 250);
  }

  return { order, setOrder, loaded };
}

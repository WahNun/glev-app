"use client";

import { SWRConfig, type Cache } from "swr";
import { useEffect, useRef, type ReactNode } from "react";

const STORAGE_KEY = "glev_swr_cache_v1";
const MAX_BYTES = 256 * 1024;

function createLocalStorageProvider(): Cache<unknown> {
  if (typeof window === "undefined") return new Map() as Cache<unknown>;
  let initial: Array<[string, unknown]> = [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) initial = JSON.parse(raw) as Array<[string, unknown]>;
  } catch {
  }
  return new Map(initial) as Cache<unknown>;
}

export default function SWRProvider({ children }: { children: ReactNode }) {
  const providerRef = useRef<Cache<unknown> | null>(null);
  if (providerRef.current === null) providerRef.current = createLocalStorageProvider();

  useEffect(() => {
    function persist() {
      const map = providerRef.current as unknown as Map<string, unknown> | null;
      if (!map) return;
      try {
        const entries = Array.from(map.entries());
        const serialized = JSON.stringify(entries);
        if (serialized.length > MAX_BYTES) return;
        window.localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
      }
    }
    window.addEventListener("beforeunload", persist);
    window.addEventListener("pagehide", persist);
    const interval = window.setInterval(persist, 10_000);
    return () => {
      window.removeEventListener("beforeunload", persist);
      window.removeEventListener("pagehide", persist);
      window.clearInterval(interval);
      persist();
    };
  }, []);

  return (
    <SWRConfig
      value={{
        provider: () => providerRef.current!,
        // 2026-05-17 round 6 (lever C — data cache for iOS): the worst
        // perceived "Settings/Insights laden sehr verzögert" case on
        // TestFlight was: open app → tap Insights → 8 parallel fetches
        // run → 1-2 s blank-card window → tab home → tap Insights
        // again → ALL 8 refetch because `revalidateOnFocus` fires on
        // every webview foreground/back-and-forth. We now:
        //   • throttle focus revalidation to one burst per 60 s
        //     (instead of one per focus event) so app-switcher hops
        //     don't trigger storms;
        //   • bump dedupingInterval to 30 s so two cards mounting in
        //     the same render share a single in-flight fetch even when
        //     keyed slightly differently in the same tick;
        //   • keep previous data on key change so scope-switching
        //     (day → week → month) shows the old values dimmed instead
        //     of flashing skeletons.
        // Per-hook overrides (e.g. /insights CGM samples already
        // disable revalidateOnFocus + use a 5-minute poll) still win
        // over these defaults.
        revalidateOnFocus: true,
        focusThrottleInterval: 60_000,
        revalidateOnReconnect: true,
        keepPreviousData: true,
        dedupingInterval: 30_000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}

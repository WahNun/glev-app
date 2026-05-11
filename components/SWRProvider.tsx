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
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        keepPreviousData: true,
        dedupingInterval: 5_000,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}

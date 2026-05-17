"use client";

// Time-format preference hook — mirrors the architecture of
// `hooks/useCarbUnit.ts`:
//   - Module-scoped cache + subscriber set so N list-rendered cards
//     share one auth + profile fetch.
//   - Optimistic setPref() broadcasts immediately, then persists to
//     `profiles.time_format` in the background.
//   - Version stamp so a late DB fetch cannot clobber a fresher user
//     toggle.
//   - SSR-safe: returns the default ('auto') on first render so server
//     HTML and first client paint agree.

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { supabase } from "@/lib/supabase";
import {
  type TimeFormatPref,
  isTimeFormatPref,
  resolveHour12,
  formatTime,
} from "@/lib/timeFormat";

const DEFAULT_PREF: TimeFormatPref = "auto";

let cachedPref: TimeFormatPref = DEFAULT_PREF;
let cachedForUid: string | null = null;
let fetchInFlight: Promise<void> | null = null;
let prefVersion = 0;
const subscribers = new Set<(p: TimeFormatPref) => void>();

function broadcast(next: TimeFormatPref) {
  cachedPref = next;
  prefVersion += 1;
  subscribers.forEach(fn => fn(next));
}

function ensureFetched(): Promise<void> {
  if (fetchInFlight) return fetchInFlight;
  if (!supabase) return Promise.resolve();
  const startVersion = prefVersion;
  fetchInFlight = (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      if (!uid) {
        cachedForUid = null;
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("time_format")
        .eq("user_id", uid)
        .maybeSingle();
      cachedForUid = uid;
      if (prefVersion !== startVersion) return;
      if (isTimeFormatPref(profile?.time_format)) {
        broadcast(profile.time_format);
      }
    } catch {
      // Silent — missing/inaccessible profile must never block the UI.
    }
  })();
  return fetchInFlight;
}

// Auth-state guard: re-fetch when the signed-in user changes so the
// preference of user A never leaks into user B's session.
let __listenerAttached = false;
if (typeof window !== "undefined" && supabase && !__listenerAttached) {
  __listenerAttached = true;
  supabase.auth.onAuthStateChange((_event, session) => {
    const nextUid = session?.user?.id ?? null;
    if (nextUid === cachedForUid) return;
    cachedForUid = null;
    fetchInFlight = null;
    broadcast(DEFAULT_PREF);
    void ensureFetched();
  });
}

export interface UseTimeFormatResult {
  pref: TimeFormatPref;
  hour12: boolean;
  setPref: (next: TimeFormatPref) => void;
  /** Format a Date as locale-aware clock string honouring the user's pref. */
  format: (d: Date) => string;
}

export function useTimeFormat(): UseTimeFormatResult {
  const locale = useLocale();
  const [pref, setPrefState] = useState<TimeFormatPref>(cachedPref);

  useEffect(() => {
    subscribers.add(setPrefState);
    if (cachedPref !== pref) setPrefState(cachedPref);
    void ensureFetched();
    return () => {
      subscribers.delete(setPrefState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPref = useCallback((next: TimeFormatPref) => {
    broadcast(next);
    if (!supabase) return;
    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) return;
        await supabase
          .from("profiles")
          .update({ time_format: next })
          .eq("user_id", uid);
      } catch {
        // Persist errors are non-fatal; local state is correct for this
        // session and a later setPref() / fetch will retry.
      }
    })();
  }, []);

  const hour12 = resolveHour12(pref, locale);
  const format = useCallback(
    (d: Date) => formatTime(d, locale, pref),
    [locale, pref],
  );

  return { pref, hour12, setPref, format };
}

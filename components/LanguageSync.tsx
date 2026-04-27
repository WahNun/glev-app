"use client";

// Pulls the user's persisted language preference from Supabase
// (`profiles.language`) on mount and reconciles it with the
// `NEXT_LOCALE` cookie. If they disagree, the cookie wins for one
// frame, we overwrite it with the DB value, and trigger a reload so
// the server picks up the correct messages bundle on the next request.
//
// This handles the cross-device case: a user changes language on
// device A → DB updates → device B opens the app → cookie may still
// hold the old value → this component reconciles and reloads.
//
// Mounted inside the protected layout so it only runs for logged-in
// users (no point asking Supabase for a profile if there isn't one).

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { readLocaleCookie, writeLocaleCookie, type Locale } from "@/lib/locale";

function coerceLocale(value: unknown): Locale | null {
  return value === "en" ? "en" : value === "de" ? "de" : null;
}

export default function LanguageSync() {
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("language")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;

      const dbLang = coerceLocale(profile?.language);
      if (!dbLang) return;

      const cookieLang = readLocaleCookie();
      if (cookieLang === dbLang) return;

      // Out of sync — apply DB value and reload so messages match.
      writeLocaleCookie(dbLang);
      if (typeof window !== "undefined") window.location.reload();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

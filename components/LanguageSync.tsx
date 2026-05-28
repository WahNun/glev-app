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
// When a language switch was just made (detected via a sessionStorage
// flag set by setLocale()), this component also performs the DB write
// and shows a brief toast confirming success or warning about failure.
//
// Mounted inside the protected layout so it only runs for logged-in
// users (no point asking Supabase for a profile if there isn't one).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabase";
import {
  readLocaleCookie,
  writeLocaleCookie,
  persistLocaleToProfile,
  type Locale,
} from "@/lib/locale";

const TOAST_DURATION_MS = 3500;
const LANG_TOAST_KEY = "glev_lang_toast";

function coerceLocale(value: unknown): Locale | null {
  return value === "en" ? "en" : value === "de" ? "de" : null;
}

type ToastKind = "success" | "error";

export default function LanguageSync() {
  const t = useTranslations("settings");
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const hasPendingWrite =
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(LANG_TOAST_KEY) === "pending";

    (async () => {
      // ── Step 1: if a language switch was just made, persist it to DB ──
      if (hasPendingWrite) {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem(LANG_TOAST_KEY);
        }
        const locale = readLocaleCookie();
        if (locale) {
          const { ok } = await persistLocaleToProfile(locale);
          if (cancelled) return;
          const msg = ok
            ? t("lang_saved_account")
            : t("lang_saved_device_only");
          setToast({ msg, kind: ok ? "success" : "error" });
          setTimeout(() => setToast(null), TOAST_DURATION_MS);
        }
      }

      // ── Step 2: reconcile DB locale with cookie (cross-device sync) ──
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("language")
        .eq("user_id", uid)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!toast) return null;

  const isSuccess = toast.kind === "success";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 80,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        padding: "10px 18px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 500,
        maxWidth: "calc(100vw - 32px)",
        textAlign: "center",
        whiteSpace: "nowrap",
        background: isSuccess ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
        border: `1px solid ${isSuccess ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
        color: isSuccess ? "rgb(34,197,94)" : "rgb(239,68,68)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
      }}
    >
      {toast.msg}
    </div>
  );
}

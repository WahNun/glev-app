"use client";

/**
 * Live onboarding flow — single page, step state in `?step=N`.
 *
 * Reachable only when the protected-layout gate detects
 * `profiles.onboarding_completed_at IS NULL`. Skip and final CTA both
 * call `POST /api/onboarding { action: "complete" }` and then hard-
 * redirect to /dashboard so the gate stops triggering on subsequent
 * navigation. Hard `window.location` (not router.push) is intentional:
 * Next App-Router caches server-rendered layouts, so a soft push back
 * into the dashboard would still pass through the cached gate result
 * of the previous render and bounce the user back here.
 *
 * The 4 step components live in sibling files (`welcome.tsx` etc.)
 * so each screen stays focused and the file diff stays readable.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { trackSignupConversion } from "@/lib/analytics/signupConversion";
import { trackOnboardingStep } from "@/lib/analytics/onboarding";
import WelcomeStep from "./welcome";
import AboutYouStep from "./about-you";
import LogMealStep from "./log-meal";
import EngineStep from "./engine";
import InsightsStep from "./insights";
import CgmStep from "./cgm";
import CriticalAlertsStep from "./critical-alerts";
import GlevButtonStep from "./glev-button";
import type { Step } from "./_shared";

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingFlow />
    </Suspense>
  );
}

function OnboardingFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase?.auth.getUser().then((res) => {
      if (res.data.user?.id) setUserId(res.data.user.id);
    });
  }, []);
  const raw = parseInt(params.get("step") ?? "0", 10);
  const step = (Number.isFinite(raw) ? Math.min(7, Math.max(0, raw)) : 0) as Step;

  const STEP_NAMES = ['welcome', 'about-you', 'log-meal', 'engine', 'insights', 'glev-button', 'cgm', 'critical-alerts'] as const;

  function goTo(n: number) {
    router.push(`/onboarding?step=${n}`);
  }

  async function complete() {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Best-effort. If the request fails (offline, transient 5xx), we
      // STILL hard-redirect — the worst outcome is the user seeing the
      // onboarding once more on next sign-in, which is fine.
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
    } catch {
      /* swallow */
    }
    if (userId) {
      trackSignupConversion(userId);
      // Server-side Meta CAPI via Tarn-Worker (fire-and-forget, deduped)
      const dedupKey = `glev_meta_signup_${userId}`;
      if (!localStorage.getItem(dedupKey)) {
        localStorage.setItem(dedupKey, Date.now().toString());
        fetch('/api/internal/signup-conversion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: `signup-${userId}-${Date.now()}` }),
        }).catch((err) => console.warn('[meta-signup] fetch failed:', err));
      }
    }
    if (typeof window !== "undefined") {
      window.location.href = "/dashboard";
    }
  }

  function next() {
    if (step >= 7) {
      void trackOnboardingStep(STEP_NAMES[step], 'completed');
      void complete();
      return;
    }
    void trackOnboardingStep(STEP_NAMES[step], 'completed');
    void trackOnboardingStep(STEP_NAMES[step + 1], 'entered');
    goTo(step + 1);
  }
  function back() {
    if (step > 0) {
      void trackOnboardingStep(STEP_NAMES[step], 'back');
      goTo(step - 1);
    }
  }
  function skip() {
    void trackOnboardingStep(STEP_NAMES[step], 'skipped');
    void complete();
  }

  if (step === 0) return <WelcomeStep onNext={next} onSkip={skip} />;
  if (step === 1) return <AboutYouStep onNext={next} onBack={back} onSkip={skip} />;
  if (step === 2) return <LogMealStep onNext={next} onBack={back} onSkip={skip} />;
  if (step === 3) return <EngineStep onNext={next} onBack={back} onSkip={skip} />;
  if (step === 4) return <InsightsStep onNext={next} onBack={back} />;
  if (step === 5) return <GlevButtonStep onNext={next} onBack={back} />;
  if (step === 6) return <CgmStep onSkip={() => goTo(7)} onBack={back} />;
  return <CriticalAlertsStep onNext={next} onBack={back} />;
}

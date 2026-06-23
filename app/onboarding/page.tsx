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
import WelcomeStep from "./welcome";
import AboutYouStep from "./about-you";
import LogMealStep from "./log-meal";
import EngineStep from "./engine";
import InsightsStep from "./insights";
import CgmStep from "./cgm";
import CriticalAlertsStep from "./critical-alerts";
import InstallStep from "./install";
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
  const step = (Number.isFinite(raw) ? Math.min(8, Math.max(0, raw)) : 0) as Step;

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
    if (userId) trackSignupConversion(userId);
    if (typeof window !== "undefined") {
      window.location.href = "/dashboard";
    }
  }

  function next() {
    if (step >= 8) {
      // Step 8 (Install) is the final step. Hitting Continue
      // completes onboarding and lands the user on /dashboard.
      void complete();
      return;
    }
    goTo(step + 1);
  }
  function back() {
    if (step > 0) goTo(step - 1);
  }
  function skip() {
    // Decision 2a: Skip = endgültig durch (counted as completed).
    void complete();
  }

  if (step === 0) return <WelcomeStep onNext={next} onSkip={skip} />;
  if (step === 1) return <AboutYouStep onNext={next} onBack={back} onSkip={skip} />;
  if (step === 2) return <LogMealStep onNext={next} onBack={back} onSkip={skip} />;
  if (step === 3) return <EngineStep onNext={next} onBack={back} onSkip={skip} />;
  if (step === 4) return <InsightsStep onNext={next} onBack={back} />;
  if (step === 5) return <GlevButtonStep onNext={next} onBack={back} />;
  if (step === 6) return <CgmStep onSkip={() => goTo(7)} onBack={back} />;
  if (step === 7) return <CriticalAlertsStep onNext={next} onBack={back} />;
  return <InstallStep onNext={next} onBack={back} onSkip={skip} />;
}

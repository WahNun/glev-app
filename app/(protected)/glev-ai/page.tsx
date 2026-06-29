"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGlevAIContext } from "@/lib/glevAIContext";
import GlevAIChatSheet from "@/components/GlevAIChatSheet";
import { useGlevAIAccess } from "@/lib/useGlevAIAccess";
import { useFeatureFlag } from "@/lib/featureFlags";
import PaywallSheet from "@/components/PaywallSheet";

/**
 * /glev-ai — fullscreen Glev AI chat page.
 *
 * Consent-granted users land here when they tap the FAB on any tab
 * other than /engine. The page renders GlevAIChatSheet in its
 * `variant="fullscreen"` mode (same UI as the engine embed) and
 * shares the same useGlevAI state provided by LayoutInner via
 * GlevAIProvider — so messages, streaming state, and pending
 * action chips persist seamlessly between this page and the sheet.
 *
 * Mic auto-starts 350 ms after mount (same pattern as the engine
 * fullscreen panel) so users can speak immediately without tapping.
 *
 * Non-consent or non-AI users are redirected to /dashboard.
 *
 * Legacy Engine stays the sole path for editing existing entries.
 */
export default function GlevAIPage() {
  const router = useRouter();
  const glevAiAccess = useGlevAIAccess();
  const voiceIntentEnabled = useFeatureFlag("voice_intent_routing") === true;
  const glevAi = useGlevAIContext();
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Auto-start mic on mount — only when the user has opted into "record" mode.
  // Default behaviour ("navigate") navigates here without triggering the mic,
  // so the user can decide themselves when to speak.
  useEffect(() => {
    if (localStorage.getItem("fab_behavior") !== "record") return;
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("glev:voice-start"));
    }, 350);
    return () => window.clearTimeout(timer);
  }, []);

  // No-access → open PaywallSheet (stays on this page, no redirect).
  useEffect(() => {
    if (glevAiAccess === null) return; // still loading
    if (glevAiAccess === false) {
      setPaywallOpen(true);
      return;
    }
    // Access granted but consent not yet given → back to dashboard.
    if (!glevAi.consentGranted) {
      router.replace("/dashboard");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glevAiAccess, glevAi.consentGranted]);

  if (glevAiAccess === false || paywallOpen) {
    return (
      <PaywallSheet
        open={true}
        onClose={() => router.back()}
        initialTier="smart"
      />
    );
  }

  return (
    <GlevAIChatSheet
      variant="fullscreen"
      open={true}
      onClose={() => router.back()}
      messages={glevAi.messages}
      streaming={glevAi.streaming}
      onSend={glevAi.sendMessage}
      onConfirmAction={glevAi.confirmAction}
      onCancelAction={glevAi.cancelAction}
      onOpenEngineForMeal={glevAi.openEngineForMeal}
      onQuickSaveAction={glevAi.quickSaveAction}
      onDetailOpen={glevAi.navigateToLogScreen}
      onClearChat={glevAi.clearMessages}
      onListeningChange={() => {}}
      voiceIntentEnabled={voiceIntentEnabled}
      pendingMealNavQueue={glevAi.pendingMealNavQueue}
      onMealNavTap={glevAi.fireMealNav}
    />
  );
}

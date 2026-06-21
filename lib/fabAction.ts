/**
 * Pure helper that decides what the FAB short-tap should do.
 * Extracted from Layout.tsx so the decision logic can be unit-tested
 * without mounting the full component tree.
 *
 * Returns one of five action types:
 *   "toggle-fullscreen"  – on /engine with AI+consent: toggle fullscreen chat
 *   "consent-modal"      – AI enabled but consent not yet granted: show modal
 *   "voice-start"        – on /glev-ai: start a new voice take in the fullscreen page
 *   "navigate-glev-ai"   – consent granted on any other tab: navigate to /glev-ai
 *   "open-paywall"       – no AI flag (free user): show Smart-tier PaywallSheet
 */
export type FabAction =
  | { type: "toggle-fullscreen"; willOpen: boolean }
  | { type: "consent-modal" }
  | { type: "voice-start" }
  | { type: "navigate-glev-ai" }
  | { type: "open-paywall" };

export function resolveFabAction(opts: {
  pathname: string;
  /** `null` = feature-flag still loading — treated as `false`. */
  aiVoiceEnabled: boolean | null;
  consentGranted: boolean;
  sheetOpen: boolean;
  fullscreenOpen: boolean;
}): FabAction {
  const {
    pathname,
    consentGranted,
    fullscreenOpen,
  } = opts;
  // Treat null (flag still loading) as false so the FAB shows the paywall
  // rather than triggering a premature consent modal.
  const aiVoiceEnabled = opts.aiVoiceEnabled === true;

  // ── Engine page ──────────────────────────────────────────────────────────
  if (pathname.startsWith("/engine")) {
    if (aiVoiceEnabled && consentGranted) {
      return { type: "toggle-fullscreen", willOpen: !fullscreenOpen };
    }
    if (aiVoiceEnabled && !consentGranted) {
      return { type: "consent-modal" };
    }
    return { type: "open-paywall" };
  }

  // ── Glev AI fullscreen page ───────────────────────────────────────────────
  // The page IS the fullscreen AI chat — FAB tap starts a new voice take.
  if (pathname.startsWith("/glev-ai")) {
    if (aiVoiceEnabled && consentGranted) {
      return { type: "voice-start" };
    }
    return { type: "open-paywall" };
  }

  // ── Non-engine, non-glev-ai pages ────────────────────────────────────────
  if (aiVoiceEnabled && consentGranted) {
    return { type: "navigate-glev-ai" };
  }

  if (aiVoiceEnabled && !consentGranted) {
    return { type: "consent-modal" };
  }

  return { type: "open-paywall" };
}

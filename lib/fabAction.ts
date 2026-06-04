/**
 * Pure helper that decides what the FAB short-tap should do.
 * Extracted from Layout.tsx so the decision logic can be unit-tested
 * without mounting the full component tree.
 *
 * Returns one of four action types:
 *   "toggle-fullscreen"  – on /engine with AI+consent: toggle fullscreen chat
 *   "consent-modal"      – AI enabled but consent not yet granted: show modal
 *   "voice-start"        – sheet already open: start new voice take
 *   "open-sheet-voice"   – open sheet then trigger voice after animation
 *   "legacy-navigate"    – no AI flag: navigate to /engine?voice=1
 */
export type FabAction =
  | { type: "toggle-fullscreen"; willOpen: boolean }
  | { type: "consent-modal" }
  | { type: "voice-start" }
  | { type: "open-sheet-voice" }
  | { type: "legacy-navigate" };

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
    sheetOpen,
    fullscreenOpen,
  } = opts;
  // Treat null (flag still loading) as false so the FAB gracefully falls
  // back to legacy voice rather than triggering a premature consent modal.
  const aiVoiceEnabled = opts.aiVoiceEnabled === true;

  // ── Engine page ──────────────────────────────────────────────────────────
  if (pathname.startsWith("/engine")) {
    if (aiVoiceEnabled && consentGranted) {
      return { type: "toggle-fullscreen", willOpen: !fullscreenOpen };
    }
    if (aiVoiceEnabled && !consentGranted) {
      return { type: "consent-modal" };
    }
    return { type: "legacy-navigate" };
  }

  // ── Non-engine pages ─────────────────────────────────────────────────────
  if (aiVoiceEnabled && consentGranted) {
    if (sheetOpen) {
      return { type: "voice-start" };
    }
    return { type: "open-sheet-voice" };
  }

  if (aiVoiceEnabled && !consentGranted) {
    return { type: "consent-modal" };
  }

  return { type: "legacy-navigate" };
}

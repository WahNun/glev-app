// Unit tests for the FAB short-tap routing logic (resolveFabAction).
//
// Background: Two bugs were fixed:
//   1. Voice-Auto-Trigger: FAB opened the chat sheet but did NOT start
//      voice recording automatically. Root cause: the old code gated
//      voice+sheet on an explicit `glev_fab_mode === "ai"` localStorage
//      preference — users who hadn't set that fell through to the legacy
//      /engine?voice=1 navigation instead.
//   2. Nav-Flash: the legacy router.push('/engine?voice=1') added /engine
//      to the navigation stack, so the previous entry page briefly showed
//      through during the transition. Fixed by using router.replace.
//
// Task #1229: consent-granted users now navigate to /glev-ai (fullscreen
// page) instead of opening the sheet. The sheet remains reachable via
// swipe-up only. `open-sheet-voice` is retired; `navigate-glev-ai` is
// the new primary consent action on non-engine pages.
//
// resolveFabAction is a pure function extracted for testability.
// No DOM, no DB, no Next.js runtime.

import { test, expect } from "@playwright/test";
import { resolveFabAction } from "@/lib/fabAction";

// ── Engine page ─────────────────────────────────────────────────────────────

test("engine + AI+consent: toggles fullscreen (closed → open)", () => {
  const action = resolveFabAction({
    pathname: "/engine",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "toggle-fullscreen", willOpen: true });
});

test("engine + AI+consent: toggles fullscreen (open → closed)", () => {
  const action = resolveFabAction({
    pathname: "/engine",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: true,
  });
  expect(action).toEqual({ type: "toggle-fullscreen", willOpen: false });
});

test("engine + AI but no consent: shows consent modal", () => {
  const action = resolveFabAction({
    pathname: "/engine",
    aiVoiceEnabled: true,
    consentGranted: false,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "consent-modal" });
});

test("engine + no AI: legacy navigate", () => {
  const action = resolveFabAction({
    pathname: "/engine",
    aiVoiceEnabled: false,
    consentGranted: false,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "legacy-navigate" });
});

test("engine sub-path (/engine/something) is also handled as engine", () => {
  const action = resolveFabAction({
    pathname: "/engine/something",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action.type).toBe("toggle-fullscreen");
});

// ── /glev-ai page ────────────────────────────────────────────────────────────

test("/glev-ai + AI+consent: starts voice take (already on fullscreen page)", () => {
  const action = resolveFabAction({
    pathname: "/glev-ai",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "voice-start" });
});

test("/glev-ai + no AI: legacy navigate", () => {
  const action = resolveFabAction({
    pathname: "/glev-ai",
    aiVoiceEnabled: false,
    consentGranted: false,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "legacy-navigate" });
});

// ── Non-engine pages — primary AI+consent flow ──────────────────────────────

test("dashboard + AI+consent + sheet closed: navigates to /glev-ai", () => {
  const action = resolveFabAction({
    pathname: "/dashboard",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "navigate-glev-ai" });
});

test("entries + AI+consent: navigates to /glev-ai", () => {
  const action = resolveFabAction({
    pathname: "/entries",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "navigate-glev-ai" });
});

test("insights + AI+consent + sheet already open: still navigates to /glev-ai", () => {
  const action = resolveFabAction({
    pathname: "/insights",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: true,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "navigate-glev-ai" });
});

test("settings + AI+consent: navigates to /glev-ai", () => {
  const action = resolveFabAction({
    pathname: "/settings",
    aiVoiceEnabled: true,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "navigate-glev-ai" });
});

// ── Non-engine + AI but no consent ──────────────────────────────────────────

test("dashboard + AI but no consent: shows consent modal (not legacy-navigate)", () => {
  const action = resolveFabAction({
    pathname: "/dashboard",
    aiVoiceEnabled: true,
    consentGranted: false,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  // Must prompt for consent rather than silently fall through to engine nav.
  expect(action).toEqual({ type: "consent-modal" });
});

// ── Legacy fallback (no AI feature flag) ────────────────────────────────────

test("no AI flag: legacy navigate (router.replace path)", () => {
  const action = resolveFabAction({
    pathname: "/dashboard",
    aiVoiceEnabled: false,
    consentGranted: false,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "legacy-navigate" });
});

test("no AI flag, on entries after a save: legacy navigate (nav-flash fix)", () => {
  // Regression guard: this was the nav-flash scenario — user saved an entry
  // and was still on /entries; FAB used to router.push (add to stack) → flash.
  // Now we return legacy-navigate (which uses router.replace in Layout.tsx).
  const action = resolveFabAction({
    pathname: "/entries",
    aiVoiceEnabled: false,
    consentGranted: false,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "legacy-navigate" });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test("consentGranted=true but aiVoiceEnabled=false: legacy navigate", () => {
  // Consent without flag is meaningless — should still fall back to legacy.
  const action = resolveFabAction({
    pathname: "/dashboard",
    aiVoiceEnabled: false,
    consentGranted: true,
    sheetOpen: false,
    fullscreenOpen: false,
  });
  expect(action).toEqual({ type: "legacy-navigate" });
});

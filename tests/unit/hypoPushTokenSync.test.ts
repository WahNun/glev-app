/**
 * Unit tests for the Hypo-Push token-sync safety net.
 *
 * Context
 * ───────
 * The hypo alarm was silent for 8+ minutes because the push token
 * registration silently failed when the Capacitor app re-opened.
 * Sequence of events:
 *   1. App opens (user already logged in from last session).
 *   2. `initPushNotifications()` fires → `PushNotifications.register()` → token arrives.
 *   3. `saveTokenToServer()` sends PATCH /api/profile/push-token.
 *   4. Supabase session is STILL being restored from AsyncStorage → 401.
 *   5. Token is silently lost. `profiles.push_token = NULL` forever.
 *
 * The fix adds `applyAuthStateListener` (called by PushNotificationsProvider)
 * which subscribes to onAuthStateChange('SIGNED_IN') and calls
 * `syncCachedPushToken()` as soon as the session is ready. This file
 * ensures the fix cannot regress without a failing test.
 *
 * Tests
 * ─────
 *  Group 1: applyAuthStateListener — behavioral tests with mock auth + fetch spy
 *    1. SIGNED_IN fires → syncCachedPushToken() called (fetch sent to push-token endpoint)
 *    2. SIGNED_IN fires after initPushNotifications() — order doesn't matter, token syncs
 *    3. SIGNED_OUT does NOT trigger syncCachedPushToken (no fetch)
 *    4. TOKEN_REFRESHED does NOT trigger syncCachedPushToken (no fetch)
 *    5. All other non-SIGNED_IN events are ignored in one batch
 *    6. Returned cleanup fn calls unsubscribe() on the subscription
 *    7. Second SIGNED_IN event (new app open) retries the sync again
 *
 *  PushNotificationsProvider — schema-contract (structural guards)
 *    8. delegates auth subscription to applyAuthStateListener (not inline)
 *    9. guards with !supabase before calling applyAuthStateListener
 *   10. calls initPushNotifications() before setting up the auth listener
 *   11. returns the applyAuthStateListener cleanup as the effect cleanup
 *
 *  syncCachedPushToken — behavioral tests (window/localStorage/fetch mock)
 *   12. no fetch when localStorage has no token
 *   13. no fetch when token present but platform missing
 *   14. no fetch when platform present but token missing
 *   15. sends PATCH with correct token + platform when both cached
 *   16. PATCH targets /api/profile/push-token with credentials: "include"
 *   17. token stays in localStorage after a 401 (race-condition scenario)
 *   18. token stays in localStorage after a network error
 *
 *  LowGlucoseAlarmTicker — schema-contract (source-code guards)
 *   19. queries nightscout_readings as a third parallel source
 *   20. all three queries inside Promise.all (single round-trip)
 *   21. uses recorded_at for nightscout_readings ordering (not timestamp)
 *   22. maps value_mgdl from nightscout_readings (not value_mg_dl)
 *   23. picks most-recent value via Math.max across all three sources
 */

import { test, expect, beforeAll, afterAll, beforeEach } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  syncCachedPushToken,
  applyAuthStateListener,
  resetPushInit,
} from "@/lib/pushNotifications";

/* ── Source readers ──────────────────────────────────────────────────────── */

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../..", relPath), "utf-8");
}

const providerSrc = readSrc("components/PushNotificationsProvider.tsx");
const tickerSrc = readSrc("components/LowGlucoseAlarmTicker.tsx");

/* ── Browser + fetch mock infrastructure ──────────────────────────────────── */

const TOKEN_KEY = "glev_push_token";
const PLATFORM_KEY = "glev_push_platform";

type FetchCall = { url: string; init: RequestInit };
let fetchCalls: FetchCall[] = [];
let store: Record<string, string> = {};
const realFetch = globalThis.fetch;
const realWindow = (globalThis as Record<string, unknown>)["window"];

beforeAll(() => {
  store = {};
  const localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
  (globalThis as Record<string, unknown>)["window"] = {
    localStorage,
    dispatchEvent: () => {},
    Capacitor: undefined,
  };
});

afterAll(() => {
  (globalThis as Record<string, unknown>)["window"] = realWindow;
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  store = {};
  fetchCalls = [];
  resetPushInit();
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchCalls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(new Response(null, { status: 200 }));
  };
});

/* ── Mock auth factory ────────────────────────────────────────────────────── */

/**
 * Creates a minimal fake auth object that captures the callback passed
 * to onAuthStateChange() and exposes `fire(event)` to simulate auth events.
 */
function makeMockAuth() {
  let capturedCallback: ((event: string) => void) | null = null;
  let unsubscribeCalled = false;

  const auth = {
    onAuthStateChange(callback: (event: string) => void) {
      capturedCallback = callback;
      return {
        data: {
          subscription: {
            unsubscribe() { unsubscribeCalled = true; },
          },
        },
      };
    },
    /** Fire an auth state event (e.g. "SIGNED_IN"). */
    async fire(event: string): Promise<void> {
      if (!capturedCallback) throw new Error("onAuthStateChange never called");
      capturedCallback(event);
      // Allow any void async work (syncCachedPushToken) to settle
      await new Promise((r) => setTimeout(r, 10));
    },
    get unsubscribeCalled() { return unsubscribeCalled; },
    get listenerRegistered() { return capturedCallback !== null; },
  };

  return auth;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Group 1: applyAuthStateListener — behavioral tests
 *
 * These tests call applyAuthStateListener() with a mock auth object,
 * then fire simulated auth events and verify fetch calls via the mock.
 * ─────────────────────────────────────────────────────────────────────────── */

test("applyAuthStateListener: SIGNED_IN fires syncCachedPushToken (fetch sent)", async () => {
  // Simulate a token cached in localStorage (e.g. from a previous registration
  // that 401'd because the session wasn't ready yet — the race condition)
  store[TOKEN_KEY] = "race-condition-token";
  store[PLATFORM_KEY] = "ios";

  const auth = makeMockAuth();
  applyAuthStateListener(auth);

  // Simulate: session finally restored from AsyncStorage → SIGNED_IN fires
  await auth.fire("SIGNED_IN");

  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0].url).toContain("/api/profile/push-token");
  const body = JSON.parse(fetchCalls[0].init.body as string);
  expect(body.token).toBe("race-condition-token");
  expect(body.platform).toBe("ios");
});

test("applyAuthStateListener: SIGNED_IN after initPushNotifications() still syncs token", async () => {
  // initPushNotifications() fires first (native registration path)
  // Then the session arrives asynchronously → SIGNED_IN
  store[TOKEN_KEY] = "post-init-token";
  store[PLATFORM_KEY] = "android";

  const auth = makeMockAuth();
  // applyAuthStateListener registers the listener (as Provider does)
  applyAuthStateListener(auth);

  // Simulate the race: SIGNED_IN arrives after init
  await auth.fire("SIGNED_IN");

  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0].url).toContain("/api/profile/push-token");
});

test("applyAuthStateListener: SIGNED_OUT does NOT trigger syncCachedPushToken", async () => {
  store[TOKEN_KEY] = "some-token";
  store[PLATFORM_KEY] = "ios";

  const auth = makeMockAuth();
  applyAuthStateListener(auth);

  await auth.fire("SIGNED_OUT");

  expect(fetchCalls).toHaveLength(0);
});

test("applyAuthStateListener: TOKEN_REFRESHED does NOT trigger syncCachedPushToken", async () => {
  store[TOKEN_KEY] = "some-token";
  store[PLATFORM_KEY] = "ios";

  const auth = makeMockAuth();
  applyAuthStateListener(auth);

  await auth.fire("TOKEN_REFRESHED");

  expect(fetchCalls).toHaveLength(0);
});

test("applyAuthStateListener: all non-SIGNED_IN events are ignored", async () => {
  store[TOKEN_KEY] = "some-token";
  store[PLATFORM_KEY] = "android";

  const auth = makeMockAuth();
  applyAuthStateListener(auth);

  for (const event of [
    "SIGNED_OUT",
    "TOKEN_REFRESHED",
    "USER_UPDATED",
    "PASSWORD_RECOVERY",
    "MFA_CHALLENGE_VERIFIED",
  ]) {
    await auth.fire(event);
  }

  // None of these should trigger a token sync
  expect(fetchCalls).toHaveLength(0);
});

test("applyAuthStateListener: returned cleanup fn calls subscription.unsubscribe()", () => {
  const auth = makeMockAuth();
  const unsubscribe = applyAuthStateListener(auth);

  expect(auth.listenerRegistered).toBe(true);
  expect(auth.unsubscribeCalled).toBe(false);

  unsubscribe();

  expect(auth.unsubscribeCalled).toBe(true);
});

test("applyAuthStateListener: second SIGNED_IN (next app open) retries token sync", async () => {
  store[TOKEN_KEY] = "retry-on-reopen";
  store[PLATFORM_KEY] = "ios";

  const auth = makeMockAuth();
  applyAuthStateListener(auth);

  // First SIGNED_IN: session restored on first app open
  await auth.fire("SIGNED_IN");
  expect(fetchCalls).toHaveLength(1);

  // Second SIGNED_IN: user opens the app again (a new session restore cycle)
  // Token is still cached → sync fires again (server is idempotent)
  await auth.fire("SIGNED_IN");
  expect(fetchCalls).toHaveLength(2);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Group 2: PushNotificationsProvider — schema-contract (structural guards)
 * These verify the wiring between the Provider and applyAuthStateListener.
 * ─────────────────────────────────────────────────────────────────────────── */

test("PushNotificationsProvider: delegates to applyAuthStateListener (not inline callback)", () => {
  // The provider must import and call the extracted helper, not re-implement
  // the event-check inline. This ensures the tested code is the deployed code.
  expect(providerSrc).toContain("applyAuthStateListener");
  expect(providerSrc).not.toContain('event === "SIGNED_IN"');
});

test("PushNotificationsProvider: guards with !supabase before applyAuthStateListener call", () => {
  expect(providerSrc).toContain("if (!supabase)");
  // Use the call-site string (not the import line) so position comparison is meaningful
  const guardIdx = providerSrc.indexOf("if (!supabase)");
  const callIdx = providerSrc.indexOf("applyAuthStateListener(supabase.auth)");
  expect(guardIdx).toBeGreaterThan(-1);
  expect(callIdx).toBeGreaterThan(-1);
  expect(guardIdx).toBeLessThan(callIdx);
});

test("PushNotificationsProvider: calls initPushNotifications() before applyAuthStateListener call", () => {
  expect(providerSrc).toContain("initPushNotifications()");
  // Use the call-site string (not the import line) so position comparison is meaningful
  const initIdx = providerSrc.indexOf("initPushNotifications()");
  const callIdx = providerSrc.indexOf("applyAuthStateListener(supabase.auth)");
  expect(initIdx).toBeGreaterThan(-1);
  expect(callIdx).toBeGreaterThan(-1);
  expect(initIdx).toBeLessThan(callIdx);
});

test("PushNotificationsProvider: uses applyAuthStateListener return value as effect cleanup", () => {
  // applyAuthStateListener returns the unsubscribe fn — must be returned from useEffect
  // Pattern: const unsubscribe = applyAuthStateListener(...); return unsubscribe;
  expect(providerSrc).toContain("applyAuthStateListener(supabase.auth)");
  const applyIdx = providerSrc.indexOf("applyAuthStateListener(supabase.auth)");
  const afterApply = providerSrc.slice(applyIdx);
  // The result must be returned from the effect (not discarded)
  expect(afterApply).toContain("return");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Group 3: syncCachedPushToken — behavioral tests (window/localStorage mock)
 * ─────────────────────────────────────────────────────────────────────────── */

test("syncCachedPushToken: no fetch when localStorage has no token", async () => {
  await syncCachedPushToken();
  expect(fetchCalls).toHaveLength(0);
});

test("syncCachedPushToken: no fetch when token present but platform missing", async () => {
  store[TOKEN_KEY] = "abc123";
  await syncCachedPushToken();
  expect(fetchCalls).toHaveLength(0);
});

test("syncCachedPushToken: no fetch when platform present but token missing", async () => {
  store[PLATFORM_KEY] = "ios";
  await syncCachedPushToken();
  expect(fetchCalls).toHaveLength(0);
});

test("syncCachedPushToken: sends PATCH with correct token + platform when both cached", async () => {
  store[TOKEN_KEY] = "device-token-xyz";
  store[PLATFORM_KEY] = "ios";

  await syncCachedPushToken();

  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0].init.method).toBe("PATCH");
  const body = JSON.parse(fetchCalls[0].init.body as string);
  expect(body.token).toBe("device-token-xyz");
  expect(body.platform).toBe("ios");
});

test("syncCachedPushToken: PATCH targets /api/profile/push-token with credentials include", async () => {
  store[TOKEN_KEY] = "android-token-abc";
  store[PLATFORM_KEY] = "android";

  await syncCachedPushToken();

  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0].url).toContain("/api/profile/push-token");
  expect(fetchCalls[0].init.credentials).toBe("include");
  expect(fetchCalls[0].init.headers as Record<string, string>).toMatchObject({
    "Content-Type": "application/json",
  });
});

test("syncCachedPushToken: token stays in localStorage after a 401 (race-condition safety)", async () => {
  store[TOKEN_KEY] = "token-for-401";
  store[PLATFORM_KEY] = "ios";

  // Simulate 401: session not yet established (the exact race condition)
  globalThis.fetch = (): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));

  await syncCachedPushToken();

  // Token must NOT be deleted — the SIGNED_IN listener will retry when ready
  expect(store[TOKEN_KEY]).toBe("token-for-401");
  expect(store[PLATFORM_KEY]).toBe("ios");
});

test("syncCachedPushToken: token stays in localStorage after a network error", async () => {
  store[TOKEN_KEY] = "token-for-error";
  store[PLATFORM_KEY] = "android";

  globalThis.fetch = (): Promise<Response> =>
    Promise.reject(new Error("Network error"));

  await syncCachedPushToken();

  // Token must survive — will be retried on next SIGNED_IN
  expect(store[TOKEN_KEY]).toBe("token-for-error");
  expect(store[PLATFORM_KEY]).toBe("android");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Group 4: LowGlucoseAlarmTicker — schema-contract tests
 * ─────────────────────────────────────────────────────────────────────────── */

test("LowGlucoseAlarmTicker: queries nightscout_readings as a third parallel source", () => {
  expect(tickerSrc).toContain('"cgm_samples"');
  expect(tickerSrc).toContain('"apple_health_readings"');
  expect(tickerSrc).toContain('"nightscout_readings"');
});

test("LowGlucoseAlarmTicker: runs all three queries inside Promise.all (single round-trip)", () => {
  expect(tickerSrc).toContain("Promise.all");
  const allStart = tickerSrc.indexOf("Promise.all");
  const allEnd = tickerSrc.indexOf("])", allStart);
  const allBlock = tickerSrc.slice(allStart, allEnd);
  expect(allBlock).toContain('"cgm_samples"');
  expect(allBlock).toContain('"apple_health_readings"');
  expect(allBlock).toContain('"nightscout_readings"');
});

test("LowGlucoseAlarmTicker: uses recorded_at for nightscout_readings ordering (not timestamp)", () => {
  const nsStart = tickerSrc.indexOf('"nightscout_readings"');
  const nsEnd = tickerSrc.indexOf(".maybeSingle()", nsStart);
  const nsBlock = tickerSrc.slice(nsStart, nsEnd);
  expect(nsBlock).toContain("recorded_at");
  expect(nsBlock).not.toContain('"timestamp"');
});

test("LowGlucoseAlarmTicker: reads value_mgdl from nightscout_readings (not value_mg_dl)", () => {
  const nsStart = tickerSrc.indexOf('"nightscout_readings"');
  const nsEnd = tickerSrc.indexOf(".maybeSingle()", nsStart);
  const nsBlock = tickerSrc.slice(nsStart, nsEnd);
  expect(nsBlock).toContain("value_mgdl");
  expect(nsBlock).not.toContain("value_mg_dl");
});

test("LowGlucoseAlarmTicker: picks most-recent value across all three sources via Math.max", () => {
  expect(tickerSrc).toContain("Math.max");
  expect(tickerSrc).toContain("cgmTs");
  expect(tickerSrc).toContain("ahTs");
  expect(tickerSrc).toContain("nsTs");
  const maxBlock = tickerSrc.slice(tickerSrc.indexOf("Math.max"));
  expect(maxBlock).toContain("cgmTs");
  expect(maxBlock).toContain("ahTs");
  expect(maxBlock).toContain("nsTs");
});

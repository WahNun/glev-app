// Regression guard for LandscapeGlucoseOverlay (Tasks #641, #642, #1002).
//
// ── Describe block 1 — viewport detection (Task #641) ──────────────────────
//   The LandscapeGlucoseOverlay was silently broken because the deprecated
//   `orientationchange` event stopped firing in modern browsers/WebViews and
//   there was no automated check to catch it. Task #640 fixed the detection
//   by also listening to `resize` and `screen.orientation.change`. This spec
//   guards against future regressions where the orientation/resize listener
//   is accidentally removed or the landscape condition (w > h && h <= 600)
//   changes.
//
//   What this asserts:
//     1. Portrait viewport (375×812): the overlay is NOT in the DOM.
//     2. Landscape viewport (844×390): Playwright's `setViewportSize` fires
//        a real `resize` event. The overlay must become visible.
//     3. Back to portrait (375×812): the overlay disappears again.
//
// ── Describe block 2 — CGM data rendering (Task #642) ──────────────────────
//   The first block only checked overlay presence/absence. A bug in the
//   data-loading or chart rendering path would go undetected. This block
//   seeds a mock CGM response via Playwright route interception, rotates to
//   landscape, and then asserts:
//     1. The glucose value (numeric, in mg/dL) is rendered visibly.
//     2. The trend SVG arrow element is present (TrendSvg renders an <svg>).
//     3. The chart SVG contains at least one <path> element (the glucose trace).
//
// ── Describe block 3 — fingerstick data consistency (Task #1002) ───────────
//   The landscape overlay loads fingerstick data via fetchRecentFingersticks()
//   and applies the same 5-minute override logic as the portrait
//   CurrentDayGlucoseCard. This block guards against regressions where the
//   two views diverge (e.g. one stops loading FS data or loses the override).
//
//   Test A — fresh fingerstick override (measured_at < 5 min ago):
//     • The 🩸 chip must appear next to the mg/dL label.
//     • The TrendSvg must be absent (it is replaced by the chip while the
//       override is active, mirroring CurrentDayGlucoseCard HeroFront).
//     • The large glucose number must show the FS value, not the CGM value.
//
//   Test B — historical fingerstick dot (measured_at = 90 min ago):
//     • No 🩸 chip (reading is outside the 5-min override window).
//     • A fingerstick halo circle (SVG <circle fill-opacity="0.15">) must
//       be attached in the chart SVG — same visual marker used by the
//       portrait RollingChart so both views are in sync.
//
// Why we navigate to /login (not /dashboard):
//   LandscapeGlucoseOverlay is mounted in app/layout.tsx (the root layout),
//   so it is present on *every* page, including the public /login page.
//   Using /login avoids auth setup and the protected-route compilation path,
//   making this test faster and more self-contained.
//
// Why setViewportSize works:
//   The component listens to `window.addEventListener("resize", check)`.
//   Playwright's setViewportSize resizes the browser window and dispatches
//   a native resize event, triggering the React state update.
//
// Why page.route() is enough for the mock:
//   fetchCgmHistory() calls fetch("/api/cgm/history") in the browser. Playwright
//   route interception happens at the browser network layer — the mock response
//   is returned before the server sees the request. The module-level cache in
//   clientCache.ts starts empty for each fresh page, so the first fetch always
//   hits the interceptor.
//
// Why **/rest/v1/fingerstick_readings** for the FS mock:
//   fetchRecentFingersticks() uses the Supabase browser client, which issues
//   a GET request to https://<project>.supabase.co/rest/v1/fingerstick_readings?…
//   The wildcard pattern matches regardless of which project URL is configured
//   in the environment, so the test is hermetic and needs no credentials.

import { expect, test } from "@playwright/test";

// Match the overlay regardless of UI locale: the test suite does not pin
// NEXT_LOCALE, so Next-intl resolves the language from Accept-Language (often
// "en" in headless Chromium).  The CSS comma selector is a union that matches
// whichever variant is in the DOM.
const OVERLAY_SELECTOR =
  '[aria-label="Live-Glukose Querformat"], [aria-label="Live glucose landscape view"]';

const PORTRAIT  = { width: 375, height: 812 };
const LANDSCAPE = { width: 844, height: 390 };

// ── 1. Viewport detection ──────────────────────────────────────────────────

test.describe("LandscapeGlucoseOverlay — viewport detection", () => {
  test.use({ viewport: PORTRAIT });

  test("overlay hidden in portrait, visible in landscape, hidden again in portrait", async ({ page }) => {
    // Navigate to the login page — LandscapeGlucoseOverlay is in the root
    // layout, so it renders on every page including public ones.
    await page.goto("/login");

    // Wait for the page to be interactive so the client component hydrates.
    await page.waitForLoadState("domcontentloaded");

    // ── 1. Portrait: overlay must be absent ─────────────────────────────────
    // The component returns null when !landscape, so the element is not in
    // the DOM at all.
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should NOT be present in portrait (375×812)",
    ).not.toBeVisible();

    // ── 2. Rotate to landscape ───────────────────────────────────────────────
    // setViewportSize dispatches a real browser resize event, which triggers
    // the `check` callback inside the useEffect and flips `landscape` to true.
    await page.setViewportSize(LANDSCAPE);

    // The overlay must appear. The React state update + re-render takes a few
    // animation frames so we give it a generous timeout.
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should be visible after rotating to landscape (844×390)",
    ).toBeVisible({ timeout: 8_000 });

    // ── 3. Back to portrait: overlay must disappear ──────────────────────────
    await page.setViewportSize(PORTRAIT);

    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should NOT be visible after returning to portrait (375×812)",
    ).not.toBeVisible({ timeout: 8_000 });
  });
});

// ── 2. CGM data rendering ──────────────────────────────────────────────────

test.describe("LandscapeGlucoseOverlay — CGM data rendering", () => {
  test.use({ viewport: PORTRAIT });

  test("glucose value, trend arrow SVG, and chart path are visible when CGM data is present", async ({ page }) => {
    // Build a mock CGM payload.
    // Timestamps are ISO strings — parseLluTs() falls back to parseDbTs()
    // which handles ISO-8601 correctly.
    const now = Date.now();
    const mkTs = (minsAgo: number) =>
      new Date(now - minsAgo * 60_000).toISOString();

    // Glucose value chosen to be clearly in-range (green) and easy to assert.
    const MOCK_VALUE = 142;

    const mockPayload = {
      current: {
        value: MOCK_VALUE,
        unit:  "mg/dL",
        timestamp: mkTs(4),
        trend: "flat",
      },
      history: [
        { value: 108, timestamp: mkTs(120), trend: "flat" },
        { value: 115, timestamp: mkTs(100), trend: "up" },
        { value: 122, timestamp: mkTs(80),  trend: "up" },
        { value: 131, timestamp: mkTs(60),  trend: "up" },
        { value: 137, timestamp: mkTs(40),  trend: "flat" },
        { value: 140, timestamp: mkTs(20),  trend: "flat" },
        { value: MOCK_VALUE, timestamp: mkTs(4), trend: "flat" },
      ],
    };

    // Intercept /api/cgm/history before navigating so the first fetch that
    // the component makes (when it enters landscape) is served the mock.
    await page.route("/api/cgm/history", (route) => {
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body:        JSON.stringify(mockPayload),
      });
    });

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    // Rotate to landscape — triggers the resize event + data fetch.
    await page.setViewportSize(LANDSCAPE);

    // The overlay wrapper must appear first.
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should be visible after rotating to landscape",
    ).toBeVisible({ timeout: 8_000 });

    // ── 1. Glucose value ─────────────────────────────────────────────────────
    // The component renders Math.round(current.v) as a large <span>. We look
    // for the exact text "142" inside the overlay. The unit label "mg/dL" is
    // a separate sibling span so the text node itself is just the number.
    await expect(
      page.locator(OVERLAY_SELECTOR).getByText(String(MOCK_VALUE), { exact: true }),
      `Glucose value ${MOCK_VALUE} should be rendered inside the overlay`,
    ).toBeVisible({ timeout: 8_000 });

    // ── 2. Trend SVG arrow ───────────────────────────────────────────────────
    // TrendSvg is rendered in a column-flex div that is a sibling of the
    // glucose number span and contains the "mg/dL" unit label plus the arrow:
    //
    //   <div style="flexDirection:column">
    //     <span>mg/dL</span>
    //     <TrendSvg />   ← renders <svg><line .../><polyline .../></svg>
    //   </div>
    //
    // Scoping via the "mg/dL" parent ensures we assert the arrow SVG
    // specifically — not any other SVG in the overlay (chart, crosshair, etc.).
    const trendContainer = page
      .locator(OVERLAY_SELECTOR)
      .getByText("mg/dL")
      .locator("..");
    await expect(
      trendContainer.locator("svg"),
      "TrendSvg should be attached in the mg/dL column (confirms arrow rendered)",
    ).toBeAttached({ timeout: 8_000 });

    // ── 3. Chart SVG path ────────────────────────────────────────────────────
    // LandscapeChart builds `path = visible.map((r, i) => ...).join(" ")` and
    // renders <path d={path} ...>. With 7 history points all within the last
    // 2 hours, visible.length > 0 is guaranteed, so the <path> must exist.
    // We use toBeAttached() on the first match — it verifies the element is in
    // the DOM without requiring a non-zero bounding box (SVG children can
    // report zero area in some Playwright/OS configurations).
    await expect(
      page.locator(`${OVERLAY_SELECTOR} svg path`).first(),
      "Chart SVG should contain at least one <path> element (the glucose trace)",
    ).toBeAttached({ timeout: 8_000 });
  });
});

// ── 3. Fingerstick data consistency ───────────────────────────────────────

test.describe("LandscapeGlucoseOverlay — fingerstick override chip and chart dot", () => {
  test.use({ viewport: PORTRAIT });

  // ── Test A: fresh fingerstick triggers the 🩸 override chip ─────────────
  //
  // The overlay applies the same FS_OVERRIDE_WINDOW_MS (5 min) rule as the
  // portrait CurrentDayGlucoseCard: if the most-recent fingerstick was
  // measured within 5 minutes, it becomes "current" and a 🩸 chip replaces
  // the TrendSvg arrow.
  //
  // Why CGM_VALUE ≠ FS_VALUE:
  //   Using distinct values (142 vs 138) lets us assert that the large hero
  //   number is FS_VALUE and not the CGM reading — the override is active.
  //
  // Why **/rest/v1/fingerstick_readings** for the Supabase mock:
  //   fetchRecentFingersticks() uses the Supabase JS client, which issues a
  //   GET request to https://<project>.supabase.co/rest/v1/fingerstick_readings
  //   The wildcard captures this regardless of which project URL is in env.
  //   On the unauthenticated /login page the client would otherwise return an
  //   empty array (no session), so we must intercept before the request fires.
  test("🩸 chip visible and trend arrow absent when fresh fingerstick overrides CGM", async ({ page }) => {
    const now    = Date.now();
    const mkTs   = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

    const CGM_VALUE = 142;
    const FS_VALUE  = 138; // distinct from CGM so assertion is unambiguous

    // Mock the CGM history endpoint — CGM current is 6 min old so it would
    // normally be displayed, but the fresh FS (2 min) should override it.
    await page.route("/api/cgm/history", (route) => {
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body: JSON.stringify({
          current: {
            value:     CGM_VALUE,
            unit:      "mg/dL",
            timestamp: mkTs(6),
            trend:     "flat",
          },
          history: [
            { value: 108, timestamp: mkTs(120), trend: "flat" },
            { value: 120, timestamp: mkTs(60),  trend: "up"   },
            { value: 130, timestamp: mkTs(20),  trend: "up"   },
            { value: CGM_VALUE, timestamp: mkTs(6), trend: "flat" },
          ],
        }),
      });
    });

    // Mock the Supabase REST fingerstick query with a reading 2 minutes old
    // — well within the 5-minute FS_OVERRIDE_WINDOW_MS.
    await page.route("**/rest/v1/fingerstick_readings**", (route) => {
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id:          "mock-fs-fresh-001",
            user_id:     "mock-user",
            measured_at: mkTs(2),
            value_mg_dl: FS_VALUE,
            notes:       null,
            created_at:  mkTs(2),
          },
        ]),
      });
    });

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    await page.setViewportSize(LANDSCAPE);

    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should be visible in landscape",
    ).toBeVisible({ timeout: 8_000 });

    // Scope assertions to the column-flex div that holds "mg/dL" + chip/arrow:
    //   <div style="flexDirection:column">
    //     <span>mg/dL</span>
    //     <span>🩸</span>   ← chip when fsOverride active
    //     — or —
    //     <TrendSvg />      ← SVG when no override
    //   </div>
    // Scoping prevents a stray 🩸 elsewhere on the page from causing a
    // false-pass, and mirrors the scope already used for the TrendSvg check.
    const mgDlColumn = page
      .locator(OVERLAY_SELECTOR)
      .getByText("mg/dL")
      .locator("..");

    // ── A-1. 🩸 chip must appear in the mg/dL column ─────────────────────────
    await expect(
      mgDlColumn.getByText("🩸"),
      "Blood-drop chip (🩸) should be visible in the mg/dL column (fsOverride active)",
    ).toBeVisible({ timeout: 10_000 });

    // ── A-2. TrendSvg must be absent from the mg/dL column ───────────────────
    // The 🩸 chip and TrendSvg are mutually exclusive: when fsOverride is on
    // the component renders the chip instead of the arrow SVG.
    await expect(
      mgDlColumn.locator("svg"),
      "TrendSvg should be absent while fingerstick override is active",
    ).not.toBeAttached({ timeout: 5_000 });

    // ── A-3. Hero number must show FS value ──────────────────────────────────
    // fsOverride replaces cgmCurrent, so Math.round(current.v) === FS_VALUE.
    await expect(
      page.locator(OVERLAY_SELECTOR).getByText(String(FS_VALUE), { exact: true }),
      `Hero number should display fingerstick value (${FS_VALUE}), not CGM value (${CGM_VALUE})`,
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── Test B: historical fingerstick produces a dot on the landscape chart ─
  //
  // A fingerstick from 90 minutes ago is outside the 5-min override window
  // (so no 🩸 chip), but it falls inside the chart's adaptive window (minimum
  // 4 hours). LandscapeChart renders each visible FS as a pair of SVG circles:
  //   <circle r="9"   fill={color} fillOpacity="0.15" />  — halo
  //   <circle r="4.5" fill={color} stroke=… />             — inner dot
  //
  // The halo's fill-opacity="0.15" attribute is unique to fingerstick markers
  // in this SVG (the CGM trace <path> and last-point <circle> don't use it),
  // so it is the most reliable selector for "a fingerstick dot is rendered".
  test("historical fingerstick dot (halo circle) renders on landscape chart", async ({ page }) => {
    const now  = Date.now();
    const mkTs = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

    const FS_VALUE = 115;

    // Mock CGM history — current reading is 5 min old (borderline, but NOT
    // within the FS override window since FS is 90 min old).
    await page.route("/api/cgm/history", (route) => {
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body: JSON.stringify({
          current: {
            value:     142,
            unit:      "mg/dL",
            timestamp: mkTs(5),
            trend:     "flat",
          },
          history: [
            { value: 108, timestamp: mkTs(120), trend: "flat" },
            { value: 120, timestamp: mkTs(60),  trend: "up"   },
            { value: 130, timestamp: mkTs(30),  trend: "up"   },
            { value: 142, timestamp: mkTs(5),   trend: "flat" },
          ],
        }),
      });
    });

    // Fingerstick from 90 minutes ago — inside the 4-hour minimum chart
    // window (winStart = now − MAX(4h, span+30min)), but outside the 5-min
    // override window, so no 🩸 chip.
    await page.route("**/rest/v1/fingerstick_readings**", (route) => {
      route.fulfill({
        status:      200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id:          "mock-fs-hist-002",
            user_id:     "mock-user",
            measured_at: mkTs(90),
            value_mg_dl: FS_VALUE,
            notes:       null,
            created_at:  mkTs(90),
          },
        ]),
      });
    });

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    await page.setViewportSize(LANDSCAPE);

    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should be visible in landscape",
    ).toBeVisible({ timeout: 8_000 });

    // Chart SVG must be present (LandscapeChart rendered with data).
    await expect(
      page.locator(`${OVERLAY_SELECTOR} svg path`).first(),
      "Chart SVG should contain a CGM glucose trace path",
    ).toBeAttached({ timeout: 8_000 });

    // ── B-1. Halo circle count must be exactly 2 ────────────────────────────
    // Two components render circle[fill-opacity="0.15"] inside this SVG:
    //
    //   a) CrosshairOverlay (ChartCrosshair.tsx line ~167):
    //        active = rawActive ?? lastCrosshairPt
    //        renders <circle r="9" fillOpacity="0.15" /> on the latest point.
    //        With CGM data present, this is ALWAYS rendered → contributes 1.
    //
    //   b) LandscapeChart fingerstick markers (lines ~459–461):
    //        visibleFs.map(r => <g><circle r="9" fillOpacity="0.15" /></g>)
    //        One per visible fingerstick → our single 90-min-old reading contributes 1.
    //
    // Total with our fixture = 2.  If fingerstick marker rendering regresses,
    // the count drops to 1 (crosshair only) and the assertion fails.
    // If the CGM feed is absent, the crosshair is absent too → count = 1 → fail.
    await expect(
      page.locator(`${OVERLAY_SELECTOR} svg circle[fill-opacity="0.15"]`),
      "Exactly 2 halo circles expected: 1 crosshair (latest CGM) + 1 fingerstick marker",
    ).toHaveCount(2, { timeout: 10_000 });

    // ── B-2. 🩸 chip must NOT appear ─────────────────────────────────────────
    // The FS is 90 min old — outside the 5-min override window.
    await expect(
      page.locator(OVERLAY_SELECTOR).getByText("🩸"),
      "Blood-drop chip should NOT appear for a 90-min-old fingerstick",
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ── 4. ScreenOrientation API calls (Task #1068) ────────────────────────────
//
// These tests verify that LandscapeGlucoseOverlay correctly calls the
// @capacitor/screen-orientation plugin at the right moments:
//
//   A. unlock() is called on component mount (so iOS WKWebView is allowed to
//      rotate even if a previous lock() call was in effect).
//
//   B. lock({ orientation: "portrait" }) is called when `landscape` state
//      transitions true → false (so all other screens stay portrait-only
//      after the overlay is dismissed).
//
//   C. Neither call fires in a plain browser context where
//      window.Capacitor is undefined (isNativePlatform = false). The
//      loadScreenOrientation() guard exits early, returning null.
//
// ── How the Capacitor mock works ──────────────────────────────────────────
//
// @capacitor/core's `createCapacitor()` starts with:
//
//   const cap = win.Capacitor ?? {};
//
// …then adds its own methods, but does NOT overwrite `nativePromise` or
// `nativeCallback`. This means properties we pre-set via addInitScript()
// survive the Capacitor bootstrap.
//
// Two pre-populated properties are sufficient:
//
//   1. PluginHeaders — Capacitor's internal isNativePlatform() checks for
//      the presence of this array. Setting it makes isNativePlatform()
//      return true. The component's own isNativePlatformForOrientation()
//      calls window.Capacitor.isNativePlatform(), so flipping this flag
//      is enough to open the loadScreenOrientation() gate.
//
//   2. nativePromise — Capacitor routes promise-based plugin method calls
//      through cap.nativePromise(pluginName, methodName, options).
//      createCapacitor() does NOT overwrite this property, so our spy
//      function survives initialisation and intercepts every call to
//      ScreenOrientation.unlock() and ScreenOrientation.lock().
//
//   We also include the PluginHeaders methods array so that
//   getPluginHeader('ScreenOrientation') finds the plugin and routes
//   unlock()/lock() through nativePromise rather than falling back to the
//   web JS implementation (ScreenOrientationWeb).
//
// Why /login and not /dashboard:
//   LandscapeGlucoseOverlay is in app/layout.tsx (root layout), so it
//   renders on every page — including the public /login page. Using /login
//   avoids auth setup and makes the test self-contained.
//
// Why waitForFunction instead of waitForTimeout:
//   The orientation calls happen inside async useEffect callbacks. Polling
//   with waitForFunction is more reliable than a fixed sleep because it
//   stops as soon as the condition is met, making the test faster and
//   deterministic rather than dependent on an arbitrary delay.

test.describe("LandscapeGlucoseOverlay — screen-orientation API calls", () => {
  test.use({ viewport: PORTRAIT });

  // addInitScript callback — serialised and evaluated in the browser before
  // any page scripts run. Must be plain JS (no TypeScript, no imports).
  // It pre-populates window.Capacitor so that when @capacitor/core
  // initialises, it treats the environment as native iOS.
  function nativeCapacitorScript() {
    // Call log shared across the test assertion boundary.
    (window as unknown as Record<string, unknown>).__screenOrientationCalls = [];

    const calls = (window as unknown as { __screenOrientationCalls: Array<{ method: string; options: unknown }> }).__screenOrientationCalls;

    const cap = (window as unknown as { Capacitor?: Record<string, unknown> }).Capacitor ?? {};

    // 1. PluginHeaders — makes Capacitor's isNativePlatform() return true.
    //    The methods array tells createPluginMethod() to use nativePromise
    //    for unlock() and lock() instead of the JS web implementation.
    (cap as Record<string, unknown>).PluginHeaders = [
      {
        name: "ScreenOrientation",
        methods: [
          { name: "unlock", rtype: "promise" },
          { name: "lock",   rtype: "promise" },
        ],
      },
    ];

    // 2. nativePromise spy — intercepts all promise-based plugin calls.
    //    createCapacitor() does NOT overwrite this, so our spy survives init.
    (cap as Record<string, unknown>).nativePromise = (
      pluginName: string,
      method: string,
      options: unknown,
    ) => {
      if (pluginName === "ScreenOrientation") {
        calls.push({ method, options });
      }
      return Promise.resolve({});
    };

    (window as unknown as { Capacitor: unknown }).Capacitor = cap;
  }

  // ── Test A: unlock() is called on mount ─────────────────────────────────
  //
  // The mount useEffect unconditionally calls unlock() so that any previous
  // lock() left by another page does not prevent iOS WKWebView rotation.
  // We assert at least one `unlock` entry in the call log.
  test("unlock() is called on mount when Capacitor is native", async ({ page }) => {
    await page.addInitScript(nativeCapacitorScript);

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    // Poll until the async useEffect resolves and unlock() fires.
    await page.waitForFunction(
      () => {
        const calls = (window as unknown as { __screenOrientationCalls?: Array<{ method: string }> }).__screenOrientationCalls;
        return Array.isArray(calls) && calls.some((c) => c.method === "unlock");
      },
      { timeout: 10_000 },
    );

    const calls = await page.evaluate(
      () => (window as unknown as { __screenOrientationCalls: Array<{ method: string; options: unknown }> }).__screenOrientationCalls,
    );
    const unlockCalls = calls.filter((c) => c.method === "unlock");

    expect(
      unlockCalls.length,
      "unlock() should have been called at least once on mount",
    ).toBeGreaterThan(0);
    // unlock() takes no arguments — options must be undefined or absent.
    expect(
      unlockCalls[0].options == null,
      "unlock() should be called without arguments",
    ).toBe(true);
  });

  // ── Test B: lock("portrait") fires on landscape true → false ─────────────
  //
  // When the user returns from landscape to portrait, the landscape-watcher
  // useEffect detects the true→false transition and calls
  // lock({ orientation: "portrait" }) so all other app screens remain locked.
  test("lock(portrait) is called when rotating back to portrait in native context", async ({ page }) => {
    await page.addInitScript(nativeCapacitorScript);

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    // Rotate to landscape — triggers the false→true branch (unlock again).
    await page.setViewportSize(LANDSCAPE);

    // Wait for the overlay to confirm landscape=true is active.
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should appear in landscape",
    ).toBeVisible({ timeout: 8_000 });

    // Rotate back to portrait — triggers the true→false branch (lock).
    await page.setViewportSize(PORTRAIT);

    // Overlay must disappear (landscape=false).
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should disappear when returning to portrait",
    ).not.toBeVisible({ timeout: 8_000 });

    // Poll until a lock call with orientation:"portrait" appears.
    await page.waitForFunction(
      () => {
        const calls = (window as unknown as { __screenOrientationCalls?: Array<{ method: string; options: { orientation?: string } }> }).__screenOrientationCalls;
        return Array.isArray(calls) && calls.some(
          (c) => c.method === "lock" && c.options?.orientation === "portrait",
        );
      },
      { timeout: 10_000 },
    );

    const calls = await page.evaluate(
      () => (window as unknown as { __screenOrientationCalls: Array<{ method: string; options: unknown }> }).__screenOrientationCalls,
    );
    const lockCalls = calls.filter((c) => c.method === "lock");

    expect(
      lockCalls.length,
      "lock() should have been called at least once after returning to portrait",
    ).toBeGreaterThan(0);
    expect(
      lockCalls[lockCalls.length - 1].options,
      "lock() should be called with { orientation: 'portrait' }",
    ).toMatchObject({ orientation: "portrait" });
  });

  // ── Test C: no orientation calls in plain browser (isNativePlatform=false) ─
  //
  // When window.Capacitor is absent (standard browser environment),
  // LandscapeGlucoseOverlay's isNativePlatformForOrientation() returns false
  // and loadScreenOrientation() exits early with null — so ScreenOrientation
  // is never imported and neither unlock() nor lock() is ever invoked.
  test("no orientation API calls fire in a plain browser (isNativePlatform = false)", async ({ page }) => {
    // Install a minimal tracker so we can measure the call count.
    // We do NOT set window.Capacitor.PluginHeaders — the env stays web-only.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__screenOrientationCalls = [];
    });

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    // Exercise both landscape-watcher branches (false→true, true→false).
    await page.setViewportSize(LANDSCAPE);
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should appear in landscape",
    ).toBeVisible({ timeout: 8_000 });

    await page.setViewportSize(PORTRAIT);
    await expect(
      page.locator(OVERLAY_SELECTOR),
      "Overlay should disappear in portrait",
    ).not.toBeVisible({ timeout: 8_000 });

    // Give any delayed async calls a short window to appear (they shouldn't).
    await page.waitForTimeout(500);

    const calls = await page.evaluate(
      () => (window as unknown as { __screenOrientationCalls?: unknown[] }).__screenOrientationCalls ?? [],
    );

    expect(
      calls,
      "No orientation API calls should fire in a plain browser context",
    ).toHaveLength(0);
  });
});

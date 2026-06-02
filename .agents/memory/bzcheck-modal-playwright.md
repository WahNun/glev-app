---
name: BzCheckModal Playwright Dismiss
description: How to dismiss BzCheckModal in Playwright E2E tests — it never detaches from DOM, and its cancel button is below the viewport in headless mode.
---

BzCheckModal is a CSS-transform bottom-sheet (`position: fixed; bottom: 0; transform: translateY(100%)` when closed). It is always in the DOM — never detached. Its "Abbrechen" button is physically below the headless Chromium viewport (720px default height).

**What does NOT work:**
- `locator.click()` → "Element is outside of the viewport"
- `locator.click({ force: true })` → same error (force does not override viewport check)
- `page.evaluate(() => btn.click())` → React synthetic `onKeyDown`/`onClick` do not fire from programmatic JS `.click()`
- `expect(dialog).not.toBeAttached()` → always fails; dialog stays in DOM

**What works:**
```typescript
const bzInput = page.locator('[role="dialog"][aria-modal="true"] input[type="number"]');
await bzInput.focus(); // off-screen focus is fine in Playwright
await page.keyboard.press("Escape");
await page.waitForTimeout(500); // wait for 0.28s CSS transition
```

**Why:** BzCheckModal attaches `handleKeyDown` as a React `onKeyDown` on the numeric input. Playwright's `focus()` works on off-screen elements. Pressing Escape while that input is focused triggers React's synthetic event → calls `onClose()` → sets `open = false` → CSS slides the sheet away.

**Do not check:** `not.toBeAttached()` or `not.toBeVisible()` after dismiss — both remain true due to CSS-only hide. Just wait 500ms for the transition and proceed.

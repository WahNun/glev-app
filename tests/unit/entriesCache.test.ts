// Unit tests for the entries localStorage TTL cache helpers in
// app/(protected)/entries/cache.ts
//
// The three TTL branches must be explicitly covered so a future refactor
// cannot silently regress the behaviour:
//
//   1. Fresh cache  (cachedAt = now)          → data is returned
//   2. Expired cache (cachedAt = now - 11min) → removeItem called, null returned
//   3. Malformed cache (no cachedAt field)    → removeItem called, null returned
//   4. UID isolation: uid-A cache not read when uid-B is active
//
// Additionally covers the boundary at exactly TTL (should still be fresh),
// and JSON-parse failures.
//
// Runs as a Playwright unit test — no browser, no dev server required.

import { test, expect } from "@playwright/test";
import {
  ENTRIES_CACHE_KEY_PREFIX,
  ENTRIES_CACHE_TTL_MS,
  readEntriesCache,
  writeEntriesCache,
  type StorageLike,
  type WritableStorageLike,
} from "@/app/(protected)/entries/cache";

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage stubs
// ---------------------------------------------------------------------------

function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  store: Record<string, string>;
  removed: string[];
} {
  const store = { ...initial };
  const removed: string[] = [];
  return {
    store,
    removed,
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    removeItem(k) {
      removed.push(k);
      delete store[k];
    },
  };
}

function makeWritableStorage(initial: Record<string, string> = {}): WritableStorageLike & {
  store: Record<string, string>;
  removed: string[];
} {
  const store = { ...initial };
  const removed: string[] = [];
  return {
    store,
    removed,
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    removeItem(k) {
      removed.push(k);
      delete store[k];
    },
    setItem(k, v) {
      store[k] = v;
    },
  };
}

function makePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    cachedAt: 1_000_000,
    meals: [{ id: "m1" }],
    insulin: [],
    exercise: [],
    cycle: [],
    symptoms: [],
    influences: [],
    ...overrides,
  });
}

const UID_A = "uid-aaaa-1111";
const UID_B = "uid-bbbb-2222";
const KEY_A = `${ENTRIES_CACHE_KEY_PREFIX}:${UID_A}`;
const KEY_B = `${ENTRIES_CACHE_KEY_PREFIX}:${UID_B}`;

// ---------------------------------------------------------------------------
// 1. Fresh cache — data is returned
// ---------------------------------------------------------------------------

test("fresh cache (cachedAt = now) — returns cached data", () => {
  const now = 5_000_000;
  const storage = makeStorage({ [KEY_A]: makePayload({ cachedAt: now }) });

  const result = readEntriesCache(UID_A, storage, now);

  expect(result).not.toBeNull();
  expect(result!.meals).toEqual([{ id: "m1" }]);
  expect(storage.removed).toHaveLength(0);
});

test("fresh cache at exactly TTL boundary — still returned (not discarded)", () => {
  const now = 5_000_000;
  const cachedAt = now - ENTRIES_CACHE_TTL_MS; // exactly at TTL, not beyond
  const storage = makeStorage({ [KEY_A]: makePayload({ cachedAt }) });

  const result = readEntriesCache(UID_A, storage, now);

  expect(result).not.toBeNull();
  expect(storage.removed).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// 2. Expired cache — removeItem called, null returned
// ---------------------------------------------------------------------------

test("expired cache (cachedAt = now - 11 min) — removeItem called, null returned", () => {
  const now = 5_000_000;
  const cachedAt = now - ENTRIES_CACHE_TTL_MS - 1; // 1 ms beyond TTL
  const storage = makeStorage({ [KEY_A]: makePayload({ cachedAt }) });

  const result = readEntriesCache(UID_A, storage, now);

  expect(result).toBeNull();
  expect(storage.removed).toContain(KEY_A);
});

test("expired cache (11 minutes old) — key is deleted from storage", () => {
  const now = 10_000_000;
  const elevenMinutes = 11 * 60 * 1000;
  const storage = makeStorage({
    [KEY_A]: makePayload({ cachedAt: now - elevenMinutes }),
  });

  readEntriesCache(UID_A, storage, now);

  expect(storage.store[KEY_A]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 3. Malformed cache — removeItem called, null returned
// ---------------------------------------------------------------------------

test("malformed cache — missing cachedAt field — removeItem called, null returned", () => {
  const payload = JSON.stringify({ meals: [{ id: "m1" }] }); // no cachedAt
  const storage = makeStorage({ [KEY_A]: payload });

  const result = readEntriesCache(UID_A, storage, Date.now());

  expect(result).toBeNull();
  expect(storage.removed).toContain(KEY_A);
});

test("malformed cache — cachedAt is a string, not a number — treated as miss", () => {
  const storage = makeStorage({
    [KEY_A]: makePayload({ cachedAt: "not-a-number" }),
  });

  const result = readEntriesCache(UID_A, storage, Date.now());

  expect(result).toBeNull();
  expect(storage.removed).toContain(KEY_A);
});

test("malformed cache — invalid JSON — removeItem called, null returned", () => {
  const storage = makeStorage({ [KEY_A]: "{not valid json" });

  const result = readEntriesCache(UID_A, storage, Date.now());

  expect(result).toBeNull();
  expect(storage.removed).toContain(KEY_A);
});

test("malformed cache — meals is not an array — null returned", () => {
  const storage = makeStorage({
    [KEY_A]: makePayload({ cachedAt: Date.now(), meals: "oops" }),
  });

  const result = readEntriesCache(UID_A, storage, Date.now());

  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// 4. Cache miss — nothing in storage
// ---------------------------------------------------------------------------

test("cache miss — key absent — returns null without calling removeItem", () => {
  const storage = makeStorage(); // empty

  const result = readEntriesCache(UID_A, storage, Date.now());

  expect(result).toBeNull();
  expect(storage.removed).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// 5. UID isolation — uid-A cache not read when uid-B is queried
// ---------------------------------------------------------------------------

test("uid isolation — uid-A cache is not returned when querying uid-B", () => {
  const now = 5_000_000;
  const storage = makeStorage({
    [KEY_A]: makePayload({ cachedAt: now }), // only uid-A has a cache entry
  });

  const resultB = readEntriesCache(UID_B, storage, now);

  expect(resultB).toBeNull();
  expect(storage.removed).toHaveLength(0);
});

test("uid isolation — both users can have independent fresh caches", () => {
  const now = 5_000_000;
  const storage = makeStorage({
    [KEY_A]: makePayload({ cachedAt: now, meals: [{ id: "meal-a" }] }),
    [KEY_B]: makePayload({ cachedAt: now, meals: [{ id: "meal-b" }] }),
  });

  const resultA = readEntriesCache(UID_A, storage, now);
  const resultB = readEntriesCache(UID_B, storage, now);

  expect(resultA!.meals).toEqual([{ id: "meal-a" }]);
  expect(resultB!.meals).toEqual([{ id: "meal-b" }]);
  expect(storage.removed).toHaveLength(0);
});

test("uid isolation — expiring uid-A does not affect uid-B", () => {
  const now = 5_000_000;
  const storage = makeStorage({
    [KEY_A]: makePayload({ cachedAt: now - ENTRIES_CACHE_TTL_MS - 1 }), // expired
    [KEY_B]: makePayload({ cachedAt: now }), // fresh
  });

  const resultA = readEntriesCache(UID_A, storage, now);
  const resultB = readEntriesCache(UID_B, storage, now);

  expect(resultA).toBeNull();
  expect(storage.removed).toContain(KEY_A);
  expect(storage.removed).not.toContain(KEY_B);
  expect(resultB).not.toBeNull();
});

// ---------------------------------------------------------------------------
// 6. Write path — correct key, cachedAt, all six arrays
// ---------------------------------------------------------------------------

const EMPTY_DATA = {
  meals: [] as unknown[],
  insulin: [] as unknown[],
  exercise: [] as unknown[],
  cycle: [] as unknown[],
  symptoms: [] as unknown[],
  influences: [] as unknown[],
};

test("writeEntriesCache — writes to the correct localStorage key", () => {
  const storage = makeWritableStorage();
  const now = 5_000_000;

  writeEntriesCache(UID_A, storage, EMPTY_DATA, now);

  expect(Object.prototype.hasOwnProperty.call(storage.store, KEY_A)).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(storage.store, KEY_B)).toBe(false);
});

test("writeEntriesCache — written JSON has a numeric cachedAt equal to injected now", () => {
  const storage = makeWritableStorage();
  const now = 9_999_999;

  writeEntriesCache(UID_A, storage, EMPTY_DATA, now);

  const written = JSON.parse(storage.store[KEY_A]);
  expect(typeof written.cachedAt).toBe("number");
  expect(written.cachedAt).toBe(now);
});

test("writeEntriesCache — written JSON contains all six data arrays", () => {
  const storage = makeWritableStorage();
  const data = {
    meals:     [{ id: "m1" }],
    insulin:   [{ id: "i1" }],
    exercise:  [{ id: "e1" }],
    cycle:     [{ id: "c1" }],
    symptoms:  [{ id: "s1" }],
    influences:[{ id: "inf1" }],
  };

  writeEntriesCache(UID_A, storage, data, 1_000_000);

  const written = JSON.parse(storage.store[KEY_A]);
  expect(written.meals).toEqual([{ id: "m1" }]);
  expect(written.insulin).toEqual([{ id: "i1" }]);
  expect(written.exercise).toEqual([{ id: "e1" }]);
  expect(written.cycle).toEqual([{ id: "c1" }]);
  expect(written.symptoms).toEqual([{ id: "s1" }]);
  expect(written.influences).toEqual([{ id: "inf1" }]);
});

// ---------------------------------------------------------------------------
// 7. Write path — storage-quota errors are swallowed
// ---------------------------------------------------------------------------

test("writeEntriesCache — setItem quota error is swallowed, page does not crash", () => {
  const throwingStorage: WritableStorageLike = {
    getItem: () => null,
    removeItem: () => {},
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  expect(() =>
    writeEntriesCache(UID_A, throwingStorage, EMPTY_DATA, 1_000_000),
  ).not.toThrow();
});

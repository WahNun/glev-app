// Side-effect-only module that installs a fake supabase client on
// `globalThis._supabase` BEFORE `lib/supabase.ts` runs its singleton
// initializer. ES module imports execute in source order at evaluation
// time, so importing this file ahead of `@/lib/userSettings` guarantees
// the real client never gets constructed during the test run.
//
// The fake records the last upsert payload (visible to tests via
// `getLastUpsert()`) and serves a mutable in-memory row that tests
// reset in `beforeEach` (`setStoredRow(...)`).

export type StoredRow = {
  user_id: string;
  icr_g_per_unit: number;
  cf_mgdl_per_unit: number;
  adjustment_history: unknown[];
};

export const TEST_USER_ID = "test-user-id";

let storedRow: StoredRow | null = null;
let lastUpsert: Record<string, unknown> | null = null;

export function setStoredRow(row: StoredRow | null) { storedRow = row; }
export function getStoredRow(): StoredRow | null { return storedRow; }
export function getLastUpsert(): Record<string, unknown> | null { return lastUpsert; }
export function clearLastUpsert() { lastUpsert = null; }

const fakeClient = {
  auth: {
    async getUser() {
      return { data: { user: { id: TEST_USER_ID } }, error: null };
    },
  },
  from(_table: string) {
    return {
      select(_cols: string) {
        return {
          eq(_col: string, _val: unknown) {
            return {
              async maybeSingle() {
                return { data: storedRow, error: null };
              },
            };
          },
        };
      },
      async upsert(payload: Record<string, unknown>, _opts?: unknown) {
        lastUpsert = payload;
        storedRow = {
          user_id: payload.user_id as string,
          icr_g_per_unit: payload.icr_g_per_unit as number,
          cf_mgdl_per_unit: payload.cf_mgdl_per_unit as number,
          adjustment_history: payload.adjustment_history as unknown[],
        };
        return { error: null };
      },
    };
  },
};

(globalThis as { _supabase?: unknown })._supabase = fakeClient;

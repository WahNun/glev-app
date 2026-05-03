type DebugStore = Record<string, unknown>;

const g = globalThis as typeof globalThis & { _debugStore?: DebugStore };
if (!g._debugStore) g._debugStore = {};

export function logDebug(tag: string, payload: unknown): void {
  g._debugStore![tag] = { ...((typeof payload === "object" && payload) ? payload : { value: payload }), _ts: new Date().toISOString() };
  console.log(`[DEBUG:${tag}]`, JSON.stringify(payload, null, 2));
}

// Single-line variant of `logDebug`. Same in-memory snapshot behaviour,
// but emits one compact JSON line so log aggregators / `grep` can treat
// each emission as a single record. Useful for high-volume server-side
// diagnostics where the multi-line pretty-printed form would interleave
// with other log output and hurt readability.
export function logDebugLine(tag: string, payload: unknown): void {
  g._debugStore![tag] = { ...((typeof payload === "object" && payload) ? payload : { value: payload }), _ts: new Date().toISOString() };
  console.log(`[DEBUG:${tag}] ${JSON.stringify(payload)}`);
}

export function getDebug(tag: string): unknown {
  return g._debugStore?.[tag] ?? null;
}

export function getAllDebug(): DebugStore {
  return { ...(g._debugStore ?? {}) };
}

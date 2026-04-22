type DebugStore = Record<string, unknown>;

const g = globalThis as typeof globalThis & { _debugStore?: DebugStore };
if (!g._debugStore) g._debugStore = {};

export function logDebug(tag: string, payload: unknown): void {
  g._debugStore![tag] = { ...((typeof payload === "object" && payload) ? payload : { value: payload }), _ts: new Date().toISOString() };
  console.log(`[DEBUG:${tag}]`, JSON.stringify(payload, null, 2));
}

export function getDebug(tag: string): unknown {
  return g._debugStore?.[tag] ?? null;
}

export function getAllDebug(): DebugStore {
  return { ...(g._debugStore ?? {}) };
}

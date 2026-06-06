// Fire-and-forget ping to Healthchecks.io endpoint.
// Never throws — a healthcheck failure must never block Edge Function success.
export async function pingHealthcheck(envVarName: string): Promise<void> {
  const url = Deno.env.get(envVarName);
  if (!url) {
    console.warn(`[healthcheck] ${envVarName} not set — ping skipped`);
    return;
  }
  try {
    // 5s timeout so a hanging HC.io connection doesn't delay the Edge Function return
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    console.log(`[healthcheck] ${envVarName} pinged successfully`);
  } catch (err) {
    console.warn(`[healthcheck] ${envVarName} ping failed:`, err);
    // intentionally not rethrown
  }
}

// Todoist → Asana sync webhook
// Todoist ruft diesen Endpoint auf wenn ein Task abgehakt wird.
// Wir suchen den Task in Asana anhand des Namens und markieren ihn als erledigt.
//
// Auth: ?secret=TODOIST_WEBHOOK_SECRET (Query-Param)
// Vercel env vars benötigt: TODOIST_WEBHOOK_SECRET, ASANA_PAT
//
// Webhook registriert für Projekt "Glev Dev" (Todoist Project ID via API)
// Endpoint: https://glev.app/api/todoist/webhook?secret=<TODOIST_WEBHOOK_SECRET>

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const ASANA_WORKSPACE_GID = "1213452700618853";

// Sucht einen Asana-Task anhand des Namens (fuzzy: enthält den Suchstring)
async function findAsanaTask(name: string): Promise<string | null> {
  const pat = process.env.ASANA_PAT;
  if (!pat) throw new Error("ASANA_PAT nicht gesetzt");

  const url = new URL(
    `https://app.asana.com/api/1.0/workspaces/${ASANA_WORKSPACE_GID}/tasks/search`
  );
  url.searchParams.set("text", name);
  url.searchParams.set("completed_since", "now");
  url.searchParams.set("opt_fields", "gid,name,completed");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asana search fehlgeschlagen: ${res.status} ${err}`);
  }
  const { data } = (await res.json()) as { data: { gid: string; name: string }[] };
  if (!data || data.length === 0) return null;

  // Bestes Match: exakter Name zuerst, dann erstes Ergebnis
  const exact = data.find(
    (t) => t.name.toLowerCase() === name.toLowerCase()
  );
  return (exact ?? data[0]).gid;
}

// Setzt einen Asana-Task auf erledigt
async function completeAsanaTask(taskGid: string): Promise<void> {
  const pat = process.env.ASANA_PAT;
  if (!pat) throw new Error("ASANA_PAT nicht gesetzt");

  const res = await fetch(`https://app.asana.com/api/1.0/tasks/${taskGid}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { completed: true } }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asana complete fehlgeschlagen: ${res.status} ${err}`);
  }
}

export async function POST(req: NextRequest) {
  // 1. Secret prüfen
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.TODOIST_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Body parsen
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName = body.event_name as string;
  const eventData = body.event_data as Record<string, string> | undefined;

  // Nur item:completed verarbeiten — alles andere ignorieren (200 zurück damit Todoist nicht erneut sendet)
  if (eventName !== "item:completed" || !eventData) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const taskName = eventData.content;
  if (!taskName) {
    return NextResponse.json({ ok: true, skipped: "no content" });
  }

  // 3. Asana-Task suchen + abhaken
  try {
    const asanaGid = await findAsanaTask(taskName);
    if (!asanaGid) {
      console.log(`[todoist-webhook] Kein Asana-Task gefunden für: "${taskName}"`);
      return NextResponse.json({ ok: true, asana: "not_found", taskName });
    }

    await completeAsanaTask(asanaGid);
    console.log(`[todoist-webhook] ✓ Asana-Task erledigt: "${taskName}" (${asanaGid})`);
    return NextResponse.json({ ok: true, asana: "completed", taskGid: asanaGid, taskName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[todoist-webhook] Fehler: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Todoist sendet manchmal HEAD/GET zur Verifizierung
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.TODOIST_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

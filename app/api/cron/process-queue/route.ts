import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/process-queue
 *
 * Picks up pending tasks from replit_queue (written by the Asana webhook
 * receiver), sends each task's prompt to Claude, and posts the response
 * as an Asana comment. Only marks a task "done" after the comment is
 * successfully posted — failures are marked "failed".
 *
 * Called every minute by GitHub Actions (.github/workflows/process-queue.yml).
 * Auth: Bearer CRON_SECRET (same secret used by all other crons).
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 8) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === cronSecret;
}

// ─── Asana helpers ───────────────────────────────────────────────────────────

interface AsanaTaskDetail {
  gid: string;
  name: string;
  notes: string;
  permalink_url: string;
}

async function fetchAsanaTaskDetail(taskGid: string): Promise<AsanaTaskDetail> {
  const res = await fetch(
    `https://app.asana.com/api/1.0/tasks/${taskGid}?opt_fields=gid,name,notes,permalink_url`,
    {
      headers: {
        Authorization: `Bearer ${process.env.ASANA_PAT}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) throw new Error(`Asana task fetch failed: ${res.status}`);
  const json = (await res.json()) as { data: AsanaTaskDetail };
  return json.data;
}

async function postAsanaComment(taskGid: string, text: string): Promise<void> {
  const res = await fetch(
    `https://app.asana.com/api/1.0/tasks/${taskGid}/stories`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ASANA_PAT}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: { text } }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) throw new Error(`Asana comment failed: ${res.status}`);
}

async function markAsanaDone(taskGid: string): Promise<void> {
  const res = await fetch(`https://app.asana.com/api/1.0/tasks/${taskGid}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.ASANA_PAT}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { completed: true } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Asana mark-done failed: ${res.status}`);
}

// ─── Claude API ──────────────────────────────────────────────────────────────

const GLEV_CONTEXT = `
Du arbeitest autonom als Replit-Agent im Glev-Projekt.
Glev ist eine Next.js 15 App für Typ-1-Diabetes Insulin-Entscheidungsunterstützung.
Stack: Next.js 15, TypeScript, Supabase (PostgreSQL), Vercel, Capacitor (iOS/Android).
Deine Aufgabe: Die Anfrage aus dem Asana-Task analysieren, umsetzen oder beantworten.
Sei präzise und direkt. Wenn du Code änderst, zeige den vollständigen geänderten Block.
Antworte auf Deutsch.
`.trim();

async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Kein AI API Key gesetzt (ANTHROPIC_API_KEY oder OPENAI_API_KEY)");

  // Prefer Anthropic if key starts with "sk-ant", otherwise fall back to OpenAI
  if ((process.env.ANTHROPIC_API_KEY ?? "").startsWith("sk-ant")) {
    return callAnthropic(prompt);
  }
  return callOpenAI(prompt);
}

async function callAnthropic(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: GLEV_CONTEXT,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const json = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return json.content.find((b) => b.type === "text")?.text ?? "(leere Antwort)";
}

async function callOpenAI(prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        { role: "system", content: GLEV_CONTEXT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content ?? "(leere Antwort)";
}

// ─── Queue processing ────────────────────────────────────────────────────────

interface QueueRow {
  id: number;
  asana_task_id: string;
  task_name: string;
}

async function claimPendingTasks(): Promise<QueueRow[]> {
  // Atomic claim: update pending → processing and return the claimed rows.
  const { data, error } = await supabase
    .from("replit_queue")
    .update({ status: "processing" })
    .eq("status", "pending")
    .select("id, asana_task_id, task_name")
    .limit(5); // max 5 per run to stay within Vercel timeout
  if (error) throw new Error(`Supabase claim failed: ${error.message}`);
  return (data ?? []) as QueueRow[];
}

async function setDone(id: number): Promise<void> {
  await supabase
    .from("replit_queue")
    .update({ status: "done", processed_at: new Date().toISOString() })
    .eq("id", id);
}

async function setFailed(id: number, reason: string): Promise<void> {
  await supabase
    .from("replit_queue")
    .update({
      status: "failed",
      processed_at: new Date().toISOString(),
      task_name: `[FAILED: ${reason.slice(0, 120)}]`,
    })
    .eq("id", id);
}

async function processTask(row: QueueRow): Promise<void> {
  // 1. Fetch full task details (notes = prompt from Claude Desktop)
  const task = await fetchAsanaTaskDetail(row.asana_task_id);
  const prompt = [task.name, task.notes].filter(Boolean).join("\n\n").trim();

  if (!prompt) {
    await postAsanaComment(
      row.asana_task_id,
      "⚠️ Dieser Task hat keinen Inhalt (Titel und Notes leer). Bitte füge einen Prompt in die Task-Notizen ein."
    );
    await setDone(row.id);
    return;
  }

  // 2. Call Claude
  const aiResponse = await callClaude(prompt);

  // 3. Post response as Asana comment — only mark done after success
  await postAsanaComment(row.asana_task_id, `🤖 Replit Agent:\n\n${aiResponse}`);

  // 4. Mark task complete in Asana
  await markAsanaDone(row.asana_task_id);

  // 5. Mark done in Supabase
  await setDone(row.id);
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tasks: QueueRow[];
  try {
    tasks = await claimPendingTasks();
  } catch (err) {
    console.error("[process-queue] claim failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  if (tasks.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const results: Array<{ id: number; task: string; ok: boolean; error?: string }> = [];

  for (const row of tasks) {
    try {
      await processTask(row);
      results.push({ id: row.id, task: row.task_name, ok: true });
      console.log(`[process-queue] ✅ done: ${row.asana_task_id} "${row.task_name}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setFailed(row.id, msg);
      results.push({ id: row.id, task: row.task_name, ok: false, error: msg });
      console.error(`[process-queue] ❌ failed: ${row.asana_task_id}`, err);
    }
  }

  return NextResponse.json({
    processed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}

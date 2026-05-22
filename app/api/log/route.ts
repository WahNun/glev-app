import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncEntryToSheets } from "@/lib/sheets";
import type { LogEntry } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    glucoseBefore, glucoseAfter, carbsGrams, fiberGrams,
    insulinUnits, mealType, mealDescription, notes,
    created_at, date, time, timezone,
  } = body as Record<string, unknown>;

  if (!glucoseBefore || !carbsGrams || !insulinUnits) {
    return NextResponse.json({ error: "glucoseBefore, carbsGrams, and insulinUnits are required" }, { status: 400 });
  }

  const now = created_at ? new Date(created_at as string) : new Date();

  const row: LogEntry & { time?: string; timezone?: string } = {
    date: (date as string | undefined) ?? now.toISOString().split("T")[0],
    time: (time as string | undefined) ?? now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    timezone: (timezone as string | undefined) ?? "UTC",
    meal: (mealDescription as string | undefined) ?? "",
    glucose_before: Number(glucoseBefore),
    glucose_after: glucoseAfter != null ? Number(glucoseAfter) : null,
    carbs: Number(carbsGrams),
    fiber: fiberGrams != null ? Number(fiberGrams) : null,
    protein: null,
    fat: null,
    net_carbs: fiberGrams != null ? Math.max(0, Number(carbsGrams) - Number(fiberGrams)) : null,
    bolus_units: Number(insulinUnits),
    meal_type: (mealType as string | undefined) ?? "BALANCED",
    evaluation: null,
    notes: (notes as string | undefined) ?? null,
  };

  const { data, error } = await supabase.from("logs").insert(row).select().single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  syncEntryToSheets(row as unknown as LogEntry).catch((e: Error) =>
    console.warn("[sheets] entry sync skipped:", e.message),
  );

  // NOTE: This legacy route inserts into the `logs` table, not `meals`.
  // IOBCard reads from `meals` only, so the meal-bolus mirror into
  // `insulin_logs` (Task #471) does not apply here — the supabase client
  // in this server route also has no authenticated session to satisfy
  // insulin_logs RLS. Meal saves via saveMeal() (lib/meals.ts) do the
  // mirror correctly.

  return NextResponse.json({ ok: true, entry: data }, { status: 201 });
}

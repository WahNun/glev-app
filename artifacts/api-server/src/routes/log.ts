import { Router, type IRouter } from "express";
import { supabase } from "../lib/supabase";
import { syncEntryToSheets } from "../lib/sheets";
import { calculateMetrics } from "../lib/calculation";
import { db, entriesTable } from "@workspace/db";

interface LogBody {
  glucoseBefore: number;
  glucoseAfter?: number | null;
  carbsGrams: number;
  fiberGrams?: number | null;
  insulinUnits: number;
  mealType: string;
  mealDescription?: string | null;
  timeDifferenceMinutes?: number | null;
  notes?: string | null;
  created_at?: string;
  date?: string;
  time?: string;
  timezone?: string;
}

function validateLogBody(body: unknown): { data: LogBody } | { error: string } {
  const b = body as Record<string, unknown>;
  if (typeof b.glucoseBefore !== "number") return { error: "glucoseBefore must be a number" };
  if (typeof b.carbsGrams !== "number") return { error: "carbsGrams must be a number" };
  if (typeof b.insulinUnits !== "number") return { error: "insulinUnits must be a number" };
  return { data: b as unknown as LogBody };
}

const router: IRouter = Router();

router.post("/log", async (req, res): Promise<void> => {
  const validated = validateLogBody(req.body);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const d = validated.data;
  const now = d.created_at ? new Date(d.created_at) : new Date();

  const { delta, speed, evaluation } = calculateMetrics(
    d.glucoseBefore,
    d.glucoseAfter ?? undefined,
    d.timeDifferenceMinutes ?? undefined,
    d.insulinUnits,
    d.carbsGrams,
  );

  const row = {
    date: d.date ?? now.toISOString().split("T")[0],
    time: d.time ?? now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    timezone: d.timezone ?? "UTC",
    meal: d.mealDescription ?? "",
    glucose_before: d.glucoseBefore,
    glucose_after: d.glucoseAfter ?? null,
    carbs: d.carbsGrams,
    fiber: d.fiberGrams ?? null,
    protein: null as null,
    fat: null as null,
    net_carbs: d.fiberGrams != null ? Math.max(0, d.carbsGrams - d.fiberGrams) : null,
    bolus_units: d.insulinUnits,
    meal_type: d.mealType,
    evaluation: evaluation ?? null,
    notes: d.notes ?? null,
  };

  if (!supabase) {
    res.status(503).json({ error: "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });
    return;
  }

  const { data: saved, error } = await supabase.from("logs").insert(row).select().single();
  if (error) {
    res.status(500).json({ error: `Supabase error: ${error.message}` });
    return;
  }

  syncEntryToSheets(row as Record<string, unknown>).catch((e: Error) =>
    console.warn("[sheets] entry sync skipped:", e.message),
  );

  db.insert(entriesTable).values({
    timestamp: now,
    glucoseBefore: d.glucoseBefore,
    glucoseAfter: d.glucoseAfter ?? null,
    carbsGrams: d.carbsGrams,
    fiberGrams: d.fiberGrams ?? null,
    insulinUnits: d.insulinUnits,
    mealType: d.mealType,
    mealDescription: d.mealDescription ?? null,
    timeDifferenceMinutes: d.timeDifferenceMinutes ?? null,
    notes: d.notes ?? null,
    delta,
    speed,
    evaluation,
  }).then(() => {}).catch((e: Error) => console.warn("[local-db] shadow write skipped:", e.message));

  res.status(201).json({ ok: true, entry: saved });
});

export default router;

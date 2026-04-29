import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "../../../insulin/_helpers";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

type Timepoint = "30min" | "1h" | "90min" | "2h" | "3h";

const COLUMN_MAP: Record<Timepoint, { value: string; at: string }> = {
  "30min": { value: "glucose_30min", at: "glucose_30min_at" },
  "1h":    { value: "glucose_1h",    at: "glucose_1h_at"    },
  "90min": { value: "glucose_90min", at: "glucose_90min_at" },
  "2h":    { value: "glucose_2h",    at: "glucose_2h_at"    },
  "3h":    { value: "glucose_3h",    at: "glucose_3h_at"    },
};

function isTimepoint(s: unknown): s is Timepoint {
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(COLUMN_MAP, s);
}

/**
 * PATCH /api/meals/[id]/glucose
 * Body: { timepoint: '30min' | '1h' | '90min' | '2h' | '3h', value: number }
 *
 * Writes the matching glucose_<tp> column AND its glucose_<tp>_at
 * timestamp on the meals row, scoped to the authenticated user.
 *
 * Returns 400 on bad payload, 401 unauth, 404 if the row isn't owned by
 * the caller, 500 on DB error. The response includes which column was
 * touched so clients can refresh local state.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const { timepoint, value } = (body ?? {}) as { timepoint?: unknown; value?: unknown };
  if (!isTimepoint(timepoint)) {
    return NextResponse.json({ error: "timepoint must be one of 30min,1h,90min,2h,3h" }, { status: 400 });
  }
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 20 || num > 600) {
    return NextResponse.json({ error: "value must be a number between 20 and 600" }, { status: 400 });
  }

  const cols = COLUMN_MAP[timepoint];
  const patch: Record<string, number | string> = {
    [cols.value]: Math.round(num),
    [cols.at]:    new Date().toISOString(),
  };

  const { data, error } = await auth.sb
    .from("meals")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "meal not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, column: cols.value, timepoint, value: Math.round(num) });
}

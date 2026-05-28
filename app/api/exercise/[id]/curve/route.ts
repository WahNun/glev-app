import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "../../../insulin/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/exercise/[id]/curve
 *
 * Returns the dense 0–180 min CGM samples stored in `exercise_glucose_samples`
 * for the given exercise log. The window is anchored at workout END
 * (created_at + duration_minutes), so t_offset_min = 0 is the moment the
 * workout finished.
 *
 * Response shape:
 *   { samples: { t_offset_min: number; value_mgdl: number }[] }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const auth = await authedClient(req);
  if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { sb, user } = auth;

  const { data, error } = await sb
    .from("exercise_glucose_samples")
    .select("t_offset_min,value_mgdl")
    .eq("log_id", id)
    .order("t_offset_min", { ascending: true });

  if (error) {
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist/i.test(error.message ?? "")
    ) {
      return NextResponse.json({ samples: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ samples: [] });
  }

  const filtered = (data as { t_offset_min: number; value_mgdl: number }[]).filter(
    (s) => Number.isFinite(s.t_offset_min) && Number.isFinite(s.value_mgdl),
  );

  void user;

  return NextResponse.json({ samples: filtered });
}

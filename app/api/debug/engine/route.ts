import { NextResponse } from "next/server";
import { getDebug } from "@/lib/debug";

export async function GET() {
  const lastRun = getDebug("ENGINE") ?? { input: null, matchedMeals: [], suggestedDose: null, confidence: null };
  return NextResponse.json({ lastRun });
}

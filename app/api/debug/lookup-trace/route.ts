export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { parseFoodText } from "@/lib/nutrition/parseFood";
import { lookupOpenFoodFacts } from "@/lib/nutrition/openFoodFacts";
import { lookupUSDA } from "@/lib/nutrition/usda";

export async function GET(req: NextRequest) {
  if (!await isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const term   = searchParams.get("term") ?? "";
  const source = searchParams.get("source") ?? "all";

  if (!term) {
    return NextResponse.json({ error: "?term= is required" }, { status: 400 });
  }
  if (!["off", "usda", "all"].includes(source)) {
    return NextResponse.json({ error: "?source= must be off|usda|all" }, { status: 400 });
  }

  let parseResult: Awaited<ReturnType<typeof parseFoodText>> | null = null;
  let parseError: string | null = null;
  try {
    parseResult = await parseFoodText(term, "de");
  } catch (e) {
    parseError = String(e);
  }

  const items = parseResult?.items ?? [];

  const trace = await Promise.all(
    items.map(async (item) => {
      const result: Record<string, unknown> = {
        name:           item.name,
        grams:          item.grams,
        is_branded:     item.is_branded,
        search_term_en: item.search_term_en,
        search_term_de: item.search_term_de,
      };

      if (source === "off" || source === "all") {
        const offTerm = item.search_term_de || item.name;
        const t0 = Date.now();
        const offResult = await lookupOpenFoodFacts(offTerm).catch(() => null);
        result.off = {
          term: offTerm,
          hit:  offResult !== null,
          data: offResult,
          ms:   Date.now() - t0,
        };
      }

      if (source === "usda" || source === "all") {
        const usdaTerm = item.search_term_en || item.name;
        const t0 = Date.now();
        const usdaResult = await lookupUSDA(usdaTerm).catch(() => null);
        result.usda = {
          term: usdaTerm,
          hit:  usdaResult !== null,
          data: usdaResult,
          ms:   Date.now() - t0,
        };
      }

      return result;
    }),
  );

  return NextResponse.json({
    input:        term,
    parse_error:  parseError,
    description:  parseResult?.description ?? null,
    item_count:   items.length,
    trace,
  });
}

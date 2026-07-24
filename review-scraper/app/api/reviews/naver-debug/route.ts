import { NextResponse } from "next/server";
import { naverDebug } from "@/lib/reviews/adapters/naver";

// Temporary diagnostic endpoint to inspect what Scrapingdog returns for a
// Naver Place review page, so we can refine the HTML parser against real
// markup. Remove once the parser is confirmed working.
//   /api/reviews/naver-debug?q=스타벅스 뉴코아강남점
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  try {
    const out = await naverDebug(q);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

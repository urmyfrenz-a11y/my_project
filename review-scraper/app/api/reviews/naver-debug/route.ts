import { NextResponse } from "next/server";
import { naverDebug } from "@/lib/reviews/adapters/naver";

// Temporary diagnostic endpoint to inspect what Scrapingdog returns for a
// Naver Place review page, so we can refine the HTML parser against real
// markup. Remove once the parser is confirmed working.
//   /api/reviews/naver-debug?q=스타벅스 뉴코아강남점
// (prod build trigger: 새 SHA로 프로덕션 재빌드 — 환경변수 반영)
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim();
  const type = sp.get("type")?.trim();
  const id = sp.get("id")?.trim();
  // Single Scrapingdog call per request to stay under the 60s function limit:
  //  - ?type=X&id=Y  → fetch that place's review page, parse + sample HTML
  //  - ?q=...        → resolve the place only (no review fetch)
  if (!q && !(type && id)) {
    return NextResponse.json({ error: "q, or type&id, required" }, { status: 400 });
  }
  try {
    const out = await naverDebug({ q, type, id });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

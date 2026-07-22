import { NextRequest, NextResponse } from "next/server";
import { analyzeLocation } from "@/lib/sangkwon/analyze";

// 임시 검증용 — 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat,lng 필요" }, { status: 400 });
  }
  const r = await analyzeLocation({ lat, lng }, "테스트");
  return NextResponse.json({
    areaName: r.areaName,
    notSeoul: r.notSeoul,
    live: r.factors.filter((f) => f.source === "live").length,
    factors: r.factors.map((f) => `${f.key}:${f.source}:${f.score} ${f.detail}`),
  });
}

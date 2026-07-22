import { NextRequest, NextResponse } from "next/server";
import { analyzeIndustry } from "@/lib/sangkwon/industry";

// 임시 검증용 — 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const industry = req.nextUrl.searchParams.get("industry") ?? "cafe";
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat,lng 필요" }, { status: 400 });
  }
  const r = await analyzeIndustry({ lat, lng }, industry);
  return NextResponse.json(r);
}

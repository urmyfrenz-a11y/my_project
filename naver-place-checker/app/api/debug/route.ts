import { NextRequest, NextResponse } from "next/server";
import { fetchPlaceViaApify, hasApify } from "@/lib/apify";

// 브라우저 주소창으로 바로 열어 액터 원본 필드를 확인하는 전용 GET 엔드포인트.
//   /api/debug?url=<네이버 플레이스 URL>
// 응답 전체가 JSON 이라 스크롤·박스 찾기 없이 화면에 그대로 보인다. (no-store)

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** 원본 객체를 필드명+타입+짧은 값으로 압축(깊이 3) — 실제 필드명 확인용 */
function summarize(v: unknown, depth = 3): unknown {
  if (Array.isArray(v)) {
    return (
      `Array(${v.length})` +
      (v.length && depth > 0 ? ` of ${JSON.stringify(summarize(v[0], depth - 1))}` : "")
    );
  }
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = depth > 0 ? summarize(val, depth - 1) : typeof val;
    }
    return o;
  }
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "…" : v;
  return v;
}

export async function GET(req: NextRequest) {
  const headers = { "cache-control": "no-store" };
  const url = (req.nextUrl.searchParams.get("url") ?? "").trim();
  if (!url) {
    return NextResponse.json(
      { error: "주소창에 ?url=<네이버 플레이스 URL> 을 붙여 주세요." },
      { headers },
    );
  }
  if (!hasApify()) {
    return NextResponse.json({ error: "APIFY_TOKEN 미설정" }, { headers });
  }
  const r = await fetchPlaceViaApify(url);
  return NextResponse.json(
    { ok: r.ok, error: r.error ?? null, status: r.status ?? null, fields: r.item ? summarize(r.item) : null },
    { headers },
  );
}

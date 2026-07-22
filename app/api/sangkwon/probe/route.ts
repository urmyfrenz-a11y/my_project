import { NextRequest, NextResponse } from "next/server";

// 임시 진단용 — 서울 열린데이터광장 OpenAPI 응답 규격 확인용. 확정 후 삭제.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const svc = req.nextUrl.searchParams.get("svc");
  const args = req.nextUrl.searchParams.get("args") ?? ""; // 예: "/20241/11110515"
  const key = process.env.SEOUL_OPENAPI_KEY;
  if (!key) {
    return NextResponse.json({ error: "SEOUL_OPENAPI_KEY 미설정" }, { status: 500 });
  }
  if (!svc) {
    return NextResponse.json({ error: "svc 파라미터 필요" }, { status: 400 });
  }
  const url = `http://openapi.seoul.go.kr:8088/${key}/json/${svc}/1/5${args}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* JSON 아님 */
    }
    return NextResponse.json({
      httpStatus: res.status,
      url: url.replace(key, "KEY"),
      json,
      rawHead: json ? undefined : text.slice(0, 800),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}

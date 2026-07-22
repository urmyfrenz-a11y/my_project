import { NextRequest, NextResponse } from "next/server";
import { debugRent } from "@/lib/sangkwon/rone";

// 임시 진단용. 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

/** R-ONE 응답에서 row 배열을 추출 */
function extractRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  // 형태: { <ServiceName>: [ {head:[...]}, {row:[...]} ] }
  for (const v of Object.values(json as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      for (const part of v) {
        if (part && typeof part === "object" && Array.isArray((part as Record<string, unknown>).row)) {
          return (part as { row: Record<string, unknown>[] }).row;
        }
      }
    }
  }
  return [];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // R_ONE_KEY 존재 여부 확인
  if (sp.get("check") === "1") {
    return NextResponse.json({ hasRoneKey: !!process.env.R_ONE_KEY });
  }

  // 임대료·공실률 런타임 탐색 결과 확인 (rone.ts 실제 경로 그대로 실행)
  if (sp.get("rent_test") != null) {
    try {
      return NextResponse.json(await debugRent());
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // R-ONE 통계표 목록 검색: ?rone_search=임대 [&stat=S237220284]
  if (sp.get("rone_search") != null) {
    const kw = sp.get("rone_search") ?? "";
    const statFilter = sp.get("stat") ?? "";
    const key = process.env.R_ONE_KEY;
    if (!key) return NextResponse.json({ error: "R_ONE_KEY 미설정" }, { status: 500 });

    const base = "https://www.reb.or.kr/r-one/openapi/SttsApiTbl.do";
    const matched: Record<string, unknown>[] = [];
    let total = 0;
    // pSize 1000, 여러 페이지 순회
    for (let pIndex = 1; pIndex <= 5; pIndex++) {
      const url = `${base}?KEY=${encodeURIComponent(key)}&Type=json&pIndex=${pIndex}&pSize=1000`;
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        return NextResponse.json({ pIndex, status: res.status, parseError: true, text: text.slice(0, 800) });
      }
      const rows = extractRows(json);
      if (rows.length === 0) break;
      total += rows.length;
      for (const r of rows) {
        const blob = JSON.stringify(r);
        const nameOk = kw ? blob.includes(kw) : true;
        const statOk = statFilter ? blob.includes(statFilter) : true;
        if (nameOk && statOk) matched.push(r);
      }
      if (rows.length < 1000) break;
    }
    return NextResponse.json({ scanned: total, matchedCount: matched.length, matched: matched.slice(0, 60) });
  }

  // R-ONE 통계 데이터 직접 조회: ?rone_data=<STATBL_ID>&dtacycle=YQ&start=201501&end=202504
  if (sp.get("rone_data") != null) {
    const statblId = sp.get("rone_data") ?? "";
    const key = process.env.R_ONE_KEY;
    if (!key) return NextResponse.json({ error: "R_ONE_KEY 미설정" }, { status: 500 });
    const dtacycle = sp.get("dtacycle") ?? "";
    const start = sp.get("start") ?? "";
    const end = sp.get("end") ?? "";
    let url =
      `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?KEY=${encodeURIComponent(key)}&Type=json&STATBL_ID=${encodeURIComponent(statblId)}&pIndex=1&pSize=1000`;
    if (dtacycle) url += `&DTACYCLE_CD=${encodeURIComponent(dtacycle)}`;
    if (start) url += `&START_WRTTIME=${encodeURIComponent(start)}`;
    if (end) url += `&END_WRTTIME=${encodeURIComponent(end)}`;
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return NextResponse.json({
      status: res.status,
      len: text.length,
      json: json ?? undefined,
      text: json ? undefined : text.slice(0, 4000),
    });
  }

  const target = sp.get("url") ?? "";
  if (!/^https?:\/\/(www\.)?(reb\.or\.kr|openapi\.reb\.or\.kr|data\.seoul\.go\.kr|www\.data\.go\.kr|apis\.data\.go\.kr)\//.test(target)) {
    return NextResponse.json({ error: "허용되지 않은 URL" }, { status: 400 });
  }

  let url = target;
  if (sp.get("ronekey") === "1") {
    const k = process.env.R_ONE_KEY;
    if (!k) return NextResponse.json({ error: "R_ONE_KEY 미설정" }, { status: 500 });
    url += (url.includes("?") ? "&" : "?") + "KEY=" + encodeURIComponent(k);
    if (!/Type=/.test(url)) url += "&Type=json";
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "application/json,text/html,application/xml",
      },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return NextResponse.json({
      status: res.status,
      len: text.length,
      json: json ?? undefined,
      text: json ? undefined : text.slice(0, 4000),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}

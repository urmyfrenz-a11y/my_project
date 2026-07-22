import { NextRequest, NextResponse } from "next/server";

// 임시 진단용. 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // R_ONE_KEY 존재 여부 확인
  if (req.nextUrl.searchParams.get("check") === "1") {
    return NextResponse.json({ hasRoneKey: !!process.env.R_ONE_KEY });
  }

  const target = req.nextUrl.searchParams.get("url") ?? "";
  if (!/^https?:\/\/(www\.)?(reb\.or\.kr|openapi\.reb\.or\.kr|data\.seoul\.go\.kr|www\.data\.go\.kr|apis\.data\.go\.kr)\//.test(target)) {
    return NextResponse.json({ error: "허용되지 않은 URL" }, { status: 400 });
  }

  let url = target;
  if (req.nextUrl.searchParams.get("ronekey") === "1") {
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

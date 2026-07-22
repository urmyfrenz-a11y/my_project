import { NextRequest, NextResponse } from "next/server";

// 임시 진단용. 확인 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

function ctx(text: string, needle: string, span = 140, max = 5): string[] {
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (out.length < max) {
    const idx = lower.indexOf(n, i);
    if (idx < 0) break;
    out.push(text.slice(Math.max(0, idx - span), idx + needle.length + span).replace(/\s+/g, " "));
    i = idx + needle.length;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url") ?? "";
  if (!/^https:\/\/data\.seoul\.go\.kr\//.test(target)) {
    return NextResponse.json({ error: "data.seoul.go.kr URL만 허용" }, { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept: "text/html",
        "X-Requested-With": "XMLHttpRequest",
      },
      cache: "no-store",
    });
    const text = await res.text();
    return NextResponse.json({
      status: res.status,
      len: text.length,
      doPaths: [...new Set(text.match(/[A-Za-z0-9_/]+\.do/g) ?? [])].slice(0, 40),
      openApiCtx: ctx(text, "openApi"),
      serviceCtx: ctx(text, "service"),
      infId: ctx(text, "infId").concat(ctx(text, "OA-22166")),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}

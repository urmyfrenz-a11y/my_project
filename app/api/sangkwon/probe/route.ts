import { NextRequest, NextResponse } from "next/server";

// 임시 진단용 — 여러 서비스명 후보를 한 번에 검사. 확정 후 삭제.
export const runtime = "nodejs";
export const maxDuration = 30;

async function probeOne(key: string, svc: string, args: string) {
  const url = `http://openapi.seoul.go.kr:8088/${key}/json/${svc}/1/1${args}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json()) as Record<string, unknown>;
    const block = (data[svc] ?? data) as {
      RESULT?: { CODE?: string; MESSAGE?: string };
      list_total_count?: number;
      row?: Array<Record<string, unknown>>;
    };
    const result = block.RESULT ?? (data.RESULT as { CODE?: string; MESSAGE?: string });
    return {
      svc,
      code: result?.CODE ?? "?",
      message: result?.MESSAGE ?? "",
      total: block.list_total_count,
      fields: block.row?.[0] ? Object.keys(block.row[0]) : undefined,
      sample: block.row?.[0],
    };
  } catch (e) {
    return { svc, code: "FETCH_ERR", message: String(e) };
  }
}

export async function GET(req: NextRequest) {
  const key = process.env.SEOUL_OPENAPI_KEY;
  if (!key) return NextResponse.json({ error: "no key" }, { status: 500 });
  const svcs = (req.nextUrl.searchParams.get("svcs") ?? "").split(",").filter(Boolean);
  const args = req.nextUrl.searchParams.get("args") ?? "";
  if (!svcs.length) return NextResponse.json({ error: "svcs required" }, { status: 400 });
  const out = await Promise.all(svcs.map((s) => probeOne(key, s.trim(), args)));
  return NextResponse.json(out);
}

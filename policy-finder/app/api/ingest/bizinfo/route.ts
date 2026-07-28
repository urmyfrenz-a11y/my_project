import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchBizinfoPrograms, NormalizedProgram, RegionLite } from "@/lib/bizinfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 기업마당 API → 정규화된 공고 목록을 JSON 으로 반환(가져오기 전용).
//   GET|POST /api/ingest/bizinfo?token=INGEST_TOKEN[&cnt=100]
// 실제 DB 적재는 관리자(MCP)가 이 응답을 받아 수행한다 → service_role 불필요.
// regions 마스터는 public read(anon)로 읽는다.
async function handle(req: NextRequest) {
  const token =
    req.nextUrl.searchParams.get("token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const expected = process.env.INGEST_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.BIZINFO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "BIZINFO_API_KEY 미설정" }, { status: 500 });
  }

  const cnt = Number(req.nextUrl.searchParams.get("cnt") ?? "100");
  const searchCnt = Number.isFinite(cnt) ? Math.min(Math.max(cnt, 1), 300) : 100;

  try {
    const sb = getSupabase(); // anon, public read
    const { data: regions, error: rErr } = await sb
      .from("regions")
      .select("id, province, district");
    if (!regions) {
      return NextResponse.json(
        { error: "regions 로드 실패", detail: rErr?.message },
        { status: 500 },
      );
    }
    const regionLite = regions as RegionLite[];

    const [seoul, gyeonggi, national] = await Promise.all([
      fetchBizinfoPrograms({ apiKey, regions: regionLite, searchCnt, hashtags: "서울", forcedProvince: "서울" }),
      fetchBizinfoPrograms({ apiKey, regions: regionLite, searchCnt, hashtags: "경기", forcedProvince: "경기" }),
      fetchBizinfoPrograms({ apiKey, regions: regionLite, searchCnt }),
    ]);

    const byId = new Map<string, NormalizedProgram>();
    for (const p of [...national, ...seoul, ...gyeonggi]) byId.set(p.external_id, p);
    const programs = [...byId.values()];

    return NextResponse.json({
      ok: true,
      fetched: { seoul: seoul.length, gyeonggi: gyeonggi.length, national: national.length },
      unique: programs.length,
      programs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

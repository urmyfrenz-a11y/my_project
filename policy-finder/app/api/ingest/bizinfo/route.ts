import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchBizinfoPrograms, NormalizedProgram, RegionLite } from "@/lib/bizinfo";
import { fetchKstartupPrograms } from "@/lib/kstartup";
import { fetchBojoPrograms } from "@/lib/bojo";
import { classifyIndustry } from "@/lib/industry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 통합 수집 라우트 — "스타트업·소상공인 지원사업"
//   GET|POST /api/ingest/bizinfo?token=INGEST_TOKEN[&cnt=300]
//
// 확정 소스(lib/sources.ts):
//   [live/api]  bizinfo(기업마당) · kstartup(K-Startup) · bojo(보조금24)
//   [planned/crawl] nipa · kocca · sbiz24  ← 공식 API 없어 크롤러(별도 워커) 순차 연동
// external_id 접두어로 소스 구분(PBLN…, kstartup:, bojo:, nipa:, kocca:, sbiz:).
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

  // 기업마당은 "모집중 공고 전 페이지" 지향 → 기본 커버리지를 넓게(최대 500).
  const cnt = Number(req.nextUrl.searchParams.get("cnt") ?? "300");
  const searchCnt = Number.isFinite(cnt) ? Math.min(Math.max(cnt, 1), 500) : 300;

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

    // 소스 1: 기업마당 — 각 공고의 내용으로 지역 판정, 타지역 제외
    const raw = await fetchBizinfoPrograms({ apiKey, regions: regionLite, searchCnt });

    // data.go.kr 인증키는 계정당 1개 → K-Startup·보조금24가 같은 키 공유
    const dataGoKrKey =
      process.env.DATA_GO_KR_API_KEY || process.env.KSTARTUP_API_KEY;
    const perPage = Math.min(searchCnt, 100); // 대량요청 시 502 방지

    // 소스 2: K-Startup(창업진흥원) — best-effort
    let kstartup: NormalizedProgram[] = [];
    let kstartupError: string | null = null;
    if (dataGoKrKey) {
      try {
        kstartup = await fetchKstartupPrograms({ apiKey: dataGoKrKey, regions: regionLite, perPage });
      } catch (e) {
        kstartupError = e instanceof Error ? e.message : String(e);
      }
    }

    // 소스 3: 보조금24(공공서비스 혜택) — best-effort. 소상공인/기업만 필터.
    let bojo: NormalizedProgram[] = [];
    let bojoError: string | null = null;
    if (dataGoKrKey) {
      try {
        bojo = await fetchBojoPrograms({ apiKey: dataGoKrKey, regions: regionLite, perPage });
      } catch (e) {
        bojoError = e instanceof Error ? e.message : String(e);
      }
    }

    const byId = new Map<string, NormalizedProgram>();
    for (const p of [...raw, ...kstartup, ...bojo]) byId.set(p.external_id, p);
    const programs = [...byId.values()].map((p) => ({
      ...p,
      industry: classifyIndustry(p.title, p.summary, p.institution_name),
    }));

    // DB 적재 함수 호출(SECURITY DEFINER, RLS 우회). anon 클라이언트로 호출하되
    // secret(=INGEST_TOKEN)로 보호. service_role 불필요.
    const { data: result, error: rpcErr } = await sb.rpc("ingest_programs", {
      p: programs,
      secret: expected,
    });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      fetched: { bizinfo: raw.length, kstartup: kstartup.length, bojo: bojo.length },
      kstartupError,
      bojoError,
      unique: programs.length,
      result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchBizinfoPrograms, NormalizedProgram, RegionLite } from "@/lib/bizinfo";
import { fetchKstartupPrograms } from "@/lib/kstartup";
import { fetchBojoPrograms } from "@/lib/bojo";
import { fetchSbiz24Programs, fetchSbiz24Raw, SBIZ_BUILD_TAG } from "@/lib/sbiz24";
import { fetchEgbizRaw, fetchEgbizDiag } from "@/lib/egbiz";
import { fetchNipaRaw } from "@/lib/nipa";
import { fetchFanfanRaw } from "@/lib/fanfan";
import { fetchGbsaRaw } from "@/lib/gbsa";
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
  // Vercel Cron 은 요청에 Authorization: Bearer <CRON_SECRET> 를 자동으로 붙인다.
  // 그래서 INGEST_TOKEN(수동 호출) 또는 CRON_SECRET(자동 크론) 둘 다 허용한다.
  const cronSecret = process.env.CRON_SECRET;
  const authorized =
    (!!expected && token === expected) || (!!cronSecret && token === cronSecret);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const debug = req.nextUrl.searchParams.get("debug");
  // 진단: GBSA(경기도경제과학진흥원) G-PMS 원본 응답 형식/세션 확인(DB 미적재).
  if (debug === "gbsa") {
    try {
      const raw = await fetchGbsaRaw();
      return NextResponse.json({ ok: true, gbsa: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }
  // 진단: 판판대로(fanfandaero) 원본 응답 형식/세션 확인(DB 미적재).
  if (debug === "fanfan") {
    try {
      const raw = await fetchFanfanRaw();
      return NextResponse.json({ ok: true, fanfan: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }
  // 진단: 경기기업비서(egbiz) 원본 응답 형식/세션 확인(DB 미적재).
  if (debug === "egbiz") {
    try {
      const raw = await fetchEgbizRaw();
      return NextResponse.json({ ok: true, egbiz: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }
  // 진단: egbiz 정규화 결과(경기 선별) 카운트/샘플. DB 미적재.
  if (debug === "egbiz2") {
    try {
      const sb = getSupabase();
      const { data: regions } = await sb.from("regions").select("id, province, district");
      const diag = await fetchEgbizDiag((regions ?? []) as RegionLite[]);
      return NextResponse.json({ ok: true, egbiz: diag });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }
  // 진단: NIPA(과기정통부 사업공고) API 원본 응답/필드명 확인(DB 미적재).
  if (debug === "nipa") {
    const key = process.env.DATA_GO_KR_API_KEY || process.env.KSTARTUP_API_KEY;
    if (!key) {
      return NextResponse.json({ ok: false, error: "DATA_GO_KR_API_KEY 미설정" }, { status: 500 });
    }
    try {
      const raw = await fetchNipaRaw(key);
      return NextResponse.json({ ok: true, nipa: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }
  // 진단: 소상공인24 원본 응답의 필드명/상태 확인(DB 미적재).
  if (debug === "sbizraw") {
    try {
      const raw = await fetchSbiz24Raw();
      return NextResponse.json({ ok: true, sbiz24: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }
  // 진단: 소상공인24 정규화 결과 미리보기(제목·기관·기간·지역·카테고리). DB 미적재.
  if (debug === "sbiz") {
    try {
      const sb = getSupabase();
      const { data: regions } = await sb.from("regions").select("id, province, district");
      const programs = await fetchSbiz24Programs({
        regions: (regions ?? []) as RegionLite[],
      });
      return NextResponse.json({
        ok: true,
        buildTag: SBIZ_BUILD_TAG,
        count: programs.length,
        sample: programs.slice(0, 6),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, buildTag: SBIZ_BUILD_TAG, error: msg }, { status: 500 });
    }
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

    // 소스 4: 소상공인24(sbiz24) — 통합공고 내부 JSON API. 인증키 불필요.
    let sbiz: NormalizedProgram[] = [];
    let sbizError: string | null = null;
    try {
      sbiz = await fetchSbiz24Programs({ regions: regionLite });
    } catch (e) {
      sbizError = e instanceof Error ? e.message : String(e);
    }

    const byId = new Map<string, NormalizedProgram>();
    for (const p of [...raw, ...kstartup, ...bojo, ...sbiz]) byId.set(p.external_id, p);
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

    // 소스 피드에서 사라진 지 오래된(4일+) 공고 정리 — DB가 자동으로 깔끔히 유지됨.
    const { data: purge } = await sb.rpc("purge_stale_programs", {
      secret: expected,
      older_than_days: 4,
    });

    return NextResponse.json({
      ok: true,
      fetched: {
        bizinfo: raw.length,
        kstartup: kstartup.length,
        bojo: bojo.length,
        sbiz: sbiz.length,
      },
      kstartupError,
      bojoError,
      sbizError,
      unique: programs.length,
      result,
      purged: purge,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

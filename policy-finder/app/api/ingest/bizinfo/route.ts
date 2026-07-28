import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchBizinfoPrograms, NormalizedProgram, RegionLite } from "@/lib/bizinfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 기업마당 API → programs 테이블 적재.
//   GET|POST /api/ingest/bizinfo?token=INGEST_TOKEN[&cnt=100]
// 서울·경기 hashtags 타겟 호출 + 전국 피드를 합쳐 external_id 기준 upsert.
// service_role 로 RLS 우회. GET 도 허용(브라우저 주소창에서 트리거 가능).
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
    const sb = getServiceSupabase();

    const [{ data: regions, error: rErr }, { data: categories, error: cErr }] =
      await Promise.all([
        sb.from("regions").select("id, province, district"),
        sb.from("categories").select("id, name"),
      ]);
    if (!regions || !categories) {
      return NextResponse.json(
        {
          error: "마스터 로드 실패",
          detail: rErr?.message || cErr?.message || "데이터 없음",
          hint: "SUPABASE_SERVICE_ROLE_KEY 값 확인 필요할 수 있음",
        },
        { status: 500 },
      );
    }
    const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
    const regionIdByKey = new Map(
      regions.map((r) => [`${r.province}|${r.district}`, r.id]),
    );
    const regionLite = regions as RegionLite[];

    // 서울 / 경기 타겟 + 전국 피드 3종 호출
    const [seoul, gyeonggi, national] = await Promise.all([
      fetchBizinfoPrograms({ apiKey, regions: regionLite, searchCnt, hashtags: "서울", forcedProvince: "서울" }),
      fetchBizinfoPrograms({ apiKey, regions: regionLite, searchCnt, hashtags: "경기", forcedProvince: "경기" }),
      fetchBizinfoPrograms({ apiKey, regions: regionLite, searchCnt }),
    ]);

    // external_id 기준 중복 제거 (지역 특정 결과 우선)
    const byId = new Map<string, NormalizedProgram>();
    for (const p of [...national, ...seoul, ...gyeonggi]) byId.set(p.external_id, p);
    const normalized = [...byId.values()];

    if (normalized.length === 0) {
      return NextResponse.json({ ok: true, fetched: 0, upserted: 0, note: "서울·경기·전국 대상 공고 없음" });
    }

    // 기관 upsert
    const instNames = [...new Set(normalized.map((n) => n.institution_name).filter(Boolean))] as string[];
    const instIdByName = new Map<string, string>();
    if (instNames.length) {
      await sb.from("institutions").upsert(
        instNames.map((name) => ({ name })),
        { onConflict: "name", ignoreDuplicates: true },
      );
      const { data: insts } = await sb.from("institutions").select("id, name").in("name", instNames);
      for (const i of insts ?? []) instIdByName.set(i.name, i.id);
    }

    const rows = normalized.map((n) => {
      const region_id =
        n.region_scope === "district" && n.region_district
          ? regionIdByKey.get(`${n.province ?? "서울"}|${n.region_district}`) ??
            regionIdByKey.get(`서울|${n.region_district}`) ??
            regionIdByKey.get(`경기|${n.region_district}`) ??
            null
          : null;
      const scope =
        n.region_scope === "district" && !region_id ? "national" : n.region_scope;

      return {
        external_id: n.external_id,
        title: n.title,
        institution_id: n.institution_name ? instIdByName.get(n.institution_name) ?? null : null,
        category_id: categoryIdByName.get(n.category_name) ?? null,
        region_scope: scope,
        region_id,
        province: scope === "province_wide" ? n.province : null,
        summary: n.summary,
        support_amount: n.support_amount,
        apply_start: n.apply_start,
        apply_end: n.apply_end,
        is_ongoing: n.is_ongoing,
        source_url: n.source_url,
        last_verified_at: new Date().toISOString(),
        status: "open" as const,
      };
    });

    const { error: upErr, count } = await sb
      .from("programs")
      .upsert(rows, { onConflict: "external_id", count: "exact" });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // '기타' 누적 경고
    const etcId = categoryIdByName.get("기타");
    let etcCount = 0;
    if (etcId) {
      const { count: c } = await sb
        .from("programs")
        .select("id", { count: "exact", head: true })
        .eq("category_id", etcId);
      etcCount = c ?? 0;
    }

    return NextResponse.json({
      ok: true,
      fetched: { seoul: seoul.length, gyeonggi: gyeonggi.length, national: national.length },
      unique: normalized.length,
      upserted: count ?? rows.length,
      etc_total: etcCount,
      etc_review_needed: etcCount >= 10,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchBizinfoPrograms, RegionLite } from "@/lib/bizinfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 기업마당 API → programs 테이블 적재 파이프라인.
//   POST /api/ingest/bizinfo?token=INGEST_TOKEN[&cnt=100]
// service_role 로 RLS 를 우회해 upsert 한다(external_id 기준 중복 방지).
export async function POST(req: NextRequest) {
  // 1) 보호 토큰 검증
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
    return NextResponse.json(
      { error: "BIZINFO_API_KEY 미설정" },
      { status: 500 },
    );
  }

  const cnt = Number(req.nextUrl.searchParams.get("cnt") ?? "100");

  try {
    const sb = getServiceSupabase();

    // 2) 마스터 로드 (regions, categories)
    const [{ data: regions }, { data: categories }] = await Promise.all([
      sb.from("regions").select("id, province, district"),
      sb.from("categories").select("id, name"),
    ]);
    if (!regions || !categories) {
      return NextResponse.json({ error: "마스터 로드 실패" }, { status: 500 });
    }
    const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
    const regionIdByKey = new Map(
      regions.map((r) => [`${r.province}|${r.district}`, r.id]),
    );

    // 3) 기업마당 호출 + 정규화
    const normalized = await fetchBizinfoPrograms({
      apiKey,
      regions: regions as RegionLite[],
      searchCnt: Number.isFinite(cnt) ? cnt : 100,
    });

    if (normalized.length === 0) {
      return NextResponse.json({ ok: true, fetched: 0, upserted: 0, note: "응답 없음" });
    }

    // 4) 기관 upsert 후 id 매핑
    const instNames = [...new Set(normalized.map((n) => n.institution_name).filter(Boolean))] as string[];
    const instIdByName = new Map<string, string>();
    if (instNames.length) {
      await sb.from("institutions").upsert(
        instNames.map((name) => ({ name })),
        { onConflict: "name", ignoreDuplicates: true },
      );
      const { data: insts } = await sb
        .from("institutions")
        .select("id, name")
        .in("name", instNames);
      for (const i of insts ?? []) instIdByName.set(i.name, i.id);
    }

    // 5) programs 레코드 구성
    const rows = normalized.map((n) => {
      const region_id =
        n.region_scope === "district" && n.region_district
          ? regionIdByKey.get(
              `${n.province ?? "서울"}|${n.region_district}`,
            ) ??
            // province 미확정이면 서울/경기 양쪽에서 district 로 탐색
            regionIdByKey.get(`서울|${n.region_district}`) ??
            regionIdByKey.get(`경기|${n.region_district}`) ??
            null
          : null;
      // district 로 잡았지만 매칭 실패 시 national 로 강등 (제약조건 위반 방지)
      const scope =
        n.region_scope === "district" && !region_id ? "national" : n.region_scope;

      return {
        external_id: n.external_id,
        title: n.title,
        institution_id: n.institution_name
          ? instIdByName.get(n.institution_name) ?? null
          : null,
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

    // 6) upsert (external_id 기준)
    const { error: upErr, count } = await sb
      .from("programs")
      .upsert(rows, { onConflict: "external_id", count: "exact" });
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    // 7) '기타' 누적 경고 (handoff 운영 규칙: 10건 이상이면 분류체계 재검토)
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
      fetched: normalized.length,
      upserted: count ?? rows.length,
      etc_total: etcCount,
      etc_review_needed: etcCount >= 10,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

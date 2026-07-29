import { getSupabase } from "@/lib/supabase";
import { Category, Region } from "@/lib/types";
import SearchClient from "./SearchClient";

export const dynamic = "force-dynamic";

async function loadMasters(): Promise<{
  regions: Region[];
  categories: Category[];
  error: string | null;
}> {
  try {
    const sb = getSupabase();
    const [{ data: regions, error: rErr }, { data: categories, error: cErr }] =
      await Promise.all([
        sb.from("regions").select("id, province, district"),
        sb.from("categories").select("id, name, sort_order").order("sort_order"),
      ]);
    if (rErr || cErr) throw new Error(rErr?.message || cErr?.message);
    return {
      regions: (regions ?? []) as Region[],
      categories: (categories ?? []) as Category[],
      error: null,
    };
  } catch (e) {
    return {
      regions: [],
      categories: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export default async function Page() {
  const { regions, categories, error } = await loadMasters();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <header className="mb-10 border-b border-line pb-8">
        <p className="eyebrow">서울 · 경기 스타트업·소상공인 지원사업</p>
        <h1 className="font-serif mt-3 text-[1.75rem] font-bold leading-tight tracking-tight sm:text-4xl">
          스타트업·소상공인 지원사업 찾기
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted sm:text-[0.95rem]">
          서울시·경기도 스타트업·소상공인 지원사업을{" "}
          <span className="font-medium text-foreground">지역</span>과{" "}
          <span className="font-medium text-foreground">카테고리</span>로
          검색합니다. 검색 시점 기준 신청이 마감되지 않은 사업만 카테고리별로
          정리해 원문 공고까지 연결합니다.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-line bg-card p-6 text-sm">
          <p className="font-semibold text-red-500">
            데이터를 불러오지 못했습니다.
          </p>
          <p className="mt-2 text-muted">
            Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL /
            NEXT_PUBLIC_SUPABASE_ANON_KEY)를 확인하세요.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-black/5 p-3 text-xs dark:bg-white/5">
            {error}
          </pre>
        </div>
      ) : (
        <SearchClient regions={regions} categories={categories} />
      )}

      <footer className="mt-20 border-t border-line pt-6 text-xs leading-relaxed text-muted">
        데이터 출처: K-Startup · 기업마당(bizinfo) · 보조금24 · 소상공인24 등
        공공 오픈API (NIPA 순차 추가 예정). 게시 내용은 수집 시점 기준이며,
        각 사업의 정확한 자격·일정·금액은 반드시 원문 공고를 확인하시기
        바랍니다.
      </footer>
    </main>
  );
}

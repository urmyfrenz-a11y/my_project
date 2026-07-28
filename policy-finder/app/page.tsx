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
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          소상공인 정책자금 찾기
        </h1>
        <p className="mt-2 text-sm text-muted sm:text-base">
          서울·경기 소상공인 지원사업을{" "}
          <span className="font-medium text-foreground">지역</span>과{" "}
          <span className="font-medium text-foreground">카테고리</span>로
          검색하세요. 검색 시점 기준 신청 마감되지 않은 사업만 보여드립니다.
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

      <footer className="mt-16 border-t border-line pt-6 text-xs text-muted">
        데이터 출처: 기업마당(bizinfo.go.kr) 등 공공 오픈API · 각 사업의 정확한
        내용은 반드시 원문 공고를 확인하세요.
      </footer>
    </main>
  );
}

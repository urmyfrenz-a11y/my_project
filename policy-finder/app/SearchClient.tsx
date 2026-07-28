"use client";

import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { Category, ProgramRow, Province, Region } from "@/lib/types";

const PROVINCES: Province[] = ["서울", "경기"];

export default function SearchClient({
  regions,
  categories,
}: {
  regions: Region[];
  categories: Category[];
}) {
  const [activeProvince, setActiveProvince] = useState<Province>("서울");
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(), // 기본 전체 언체크 (선택 안 함 = 전체)
  );

  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<ProgramRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const regionsByProvince = useMemo(() => {
    const map: Record<Province, Region[]> = { 서울: [], 경기: [] };
    for (const r of regions) map[r.province]?.push(r);
    // 가나다순 정렬 (행정코드 순이 아니라 찾기 쉽게)
    for (const p of PROVINCES) {
      map[p].sort((a, b) => a.district.localeCompare(b.district, "ko"));
    }
    return map;
  }, [regions]);

  const allCategoriesSelected = selectedCategories.size === categories.length;

  // 선택된 지역 목록 (탭과 무관하게 항상 표시 — 광역+기초 함께)
  const selectedRegionList = useMemo(
    () =>
      regions
        .filter((r) => selectedRegions.has(r.id))
        .sort(
          (a, b) =>
            a.province.localeCompare(b.province, "ko") ||
            a.district.localeCompare(b.district, "ko"),
        ),
    [regions, selectedRegions],
  );

  function toggleRegion(id: string) {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllInProvince(p: Province) {
    const ids = regionsByProvince[p].map((r) => r.id);
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) allOn ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleCategory(id: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllCategories() {
    setSelectedCategories((prev) =>
      prev.size === categories.length
        ? new Set()
        : new Set(categories.map((c) => c.id)),
    );
  }

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      const sb = getSupabase();
      const { data, error } = await sb.rpc("search_programs", {
        p_region_ids: [...selectedRegions],
        // 선택 안 함(또는 전체) = 전체 카테고리
        p_category_ids:
          selectedCategories.size === 0 || allCategoriesSelected
            ? []
            : [...selectedCategories],
      });
      if (error) throw new Error(error.message);
      setResults((data ?? []) as ProgramRow[]);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // 카테고리별 그룹핑 (sort_order 순)
  const grouped = useMemo(() => {
    const order = new Map(categories.map((c) => [c.name, c.sort_order]));
    const buckets = new Map<string, ProgramRow[]>();
    for (const row of results) {
      const key = row.category_name ?? "기타";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(row);
    }
    return [...buckets.entries()].sort(
      (a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99),
    );
  }, [results, categories]);

  const selectedRegionCount = selectedRegions.size;

  return (
    <div className="space-y-8">
      {/* ── 지역 선택 ─────────────────────────────── */}
      <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">1. 지역 선택</h2>
          <span className="text-xs text-muted">
            {selectedRegionCount > 0
              ? `${selectedRegionCount}개 선택`
              : "선택 안 함 = 전체"}
          </span>
        </div>

        {/* 선택한 지역: 탭 넘나들며 고른 것을 한눈에 (칩 클릭 시 해제) */}
        {selectedRegionList.length > 0 && (
          <div className="mb-4 rounded-xl bg-brand/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                선택한 지역 {selectedRegionList.length}
              </span>
              <button
                type="button"
                onClick={() => setSelectedRegions(new Set())}
                className="text-xs text-muted hover:text-foreground hover:underline"
              >
                전체 해제
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedRegionList.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRegion(r.id)}
                  title="클릭하면 선택 해제"
                  className="inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-brand-foreground hover:opacity-90"
                >
                  <span className="opacity-80">
                    {r.province === "서울" ? "서울" : "경기"}
                  </span>
                  {r.district}
                  <span aria-hidden className="ml-0.5 text-sm leading-none">
                    ×
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 inline-flex rounded-lg border border-line p-1">
          {PROVINCES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setActiveProvince(p)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                activeProvince === p
                  ? "bg-brand text-brand-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {p === "서울" ? "서울특별시" : "경기도"}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <button
            type="button"
            onClick={() => toggleAllInProvince(activeProvince)}
            className="text-xs font-medium text-brand hover:underline"
          >
            {activeProvince} 전체 선택/해제
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {regionsByProvince[activeProvince].map((r) => {
            const on = selectedRegions.has(r.id);
            return (
              <label
                key={r.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  on
                    ? "border-brand bg-brand/10 font-medium"
                    : "border-line hover:border-brand/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleRegion(r.id)}
                  className="accent-brand"
                />
                {r.district}
              </label>
            );
          })}
        </div>
      </section>

      {/* ── 카테고리 선택 ─────────────────────────── */}
      <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">2. 카테고리 선택</h2>
          <span className="text-xs text-muted">
            {selectedCategories.size > 0
              ? `${selectedCategories.size}개 선택`
              : "선택 안 함 = 전체"}
          </span>
        </div>

        <div className="mb-3">
          <button
            type="button"
            onClick={toggleAllCategories}
            className="text-xs font-medium text-brand hover:underline"
          >
            전체 선택/해제
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {categories.map((c) => {
            const on = selectedCategories.has(c.id);
            return (
              <label
                key={c.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  on
                    ? "border-brand bg-brand/10 font-medium"
                    : "border-line hover:border-brand/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleCategory(c.id)}
                  className="accent-brand"
                />
                {c.name}
              </label>
            );
          })}
        </div>
      </section>

      {/* ── 검색 ─────────────────────────────────── */}
      <div className="sticky bottom-4 z-10">
        <button
          type="button"
          onClick={runSearch}
          disabled={loading}
          className="w-full rounded-xl bg-brand py-3.5 text-center text-base font-semibold text-brand-foreground shadow-lg shadow-brand/20 transition hover:opacity-95 disabled:opacity-60"
        >
          {loading ? "검색 중…" : "지원사업 검색"}
        </button>
      </div>

      {/* ── 결과 ─────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          검색 오류: {error}
        </div>
      )}

      {searched && !error && (
        <Results grouped={grouped} total={results.length} />
      )}
    </div>
  );
}

function Results({
  grouped,
  total,
}: {
  grouped: [string, ProgramRow[]][];
  total: number;
}) {
  if (total === 0) {
    return (
      <div className="rounded-xl border border-line bg-card p-8 text-center text-sm text-muted">
        조건에 맞는 신청 가능한 지원사업이 없습니다.
        <br />
        지역이나 카테고리를 넓혀 다시 검색해 보세요.
      </div>
    );
  }
  return (
    <section className="space-y-8">
      <p className="text-sm text-muted">
        총 <span className="font-semibold text-foreground">{total}</span>건의
        신청 가능한 지원사업
      </p>
      {grouped.map(([name, rows]) => (
        <div key={name}>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-bold">
            {name}
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              {rows.length}
            </span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <ProgramCard key={row.id} row={row} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ProgramCard({ row }: { row: ProgramRow }) {
  const dday = computeDday(row.apply_end, row.is_ongoing);
  const regionBadge =
    row.region_scope === "national"
      ? "전국"
      : row.region_scope === "province_wide"
        ? `${row.province} 전역`
        : (row.region_district ?? "지역");

  return (
    <article className="flex flex-col rounded-xl border border-line bg-card p-4 transition hover:border-brand/50">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge>{regionBadge}</Badge>
        <DdayBadge dday={dday} />
      </div>
      <h4 className="font-semibold leading-snug">{row.title}</h4>
      {row.institution_name && (
        <p className="mt-1 text-xs text-muted">{row.institution_name}</p>
      )}
      {row.summary && (
        <p className="mt-2 line-clamp-3 text-sm text-muted">{row.summary}</p>
      )}
      {row.support_amount && (
        <p className="mt-2 text-sm">
          <span className="text-muted">지원규모 </span>
          {row.support_amount}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
        <span>최종확인 {formatDate(row.last_verified_at)}</span>
        {row.source_url && (
          <a
            href={row.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-brand px-2.5 py-1 font-medium text-brand-foreground hover:opacity-90"
          >
            원문보기 →
          </a>
        )}
      </div>
    </article>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-line px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

function DdayBadge({ dday }: { dday: { label: string; urgent: boolean } }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
        dday.urgent
          ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
      }`}
    >
      {dday.label}
    </span>
  );
}

function computeDday(
  applyEnd: string | null,
  isOngoing: boolean,
): { label: string; urgent: boolean } {
  if (isOngoing || !applyEnd) return { label: "상시모집", urgent: false };
  const end = new Date(applyEnd + "T23:59:59");
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: "마감", urgent: true };
  if (diff === 0) return { label: "D-day", urgent: true };
  return { label: `D-${diff}`, urgent: diff <= 7 };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

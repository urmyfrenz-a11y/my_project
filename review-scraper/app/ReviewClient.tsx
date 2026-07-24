"use client";

import { useState } from "react";

import type {
  Platform,
  UnifiedReview,
  CollectResult,
  PlaceSearchResult,
} from "@/lib/reviews/types";

const ALL_PLATFORMS: Platform[] = ["kakao", "web", "naver"];

const META: Record<
  Platform,
  { label: string; short: string; dot: string; solid: string; soft: string }
> = {
  web: {
    label: "네이버 검색",
    short: "네이버검색",
    dot: "bg-blue-500",
    solid: "bg-blue-600 text-white border-blue-600",
    soft: "text-blue-600 dark:text-blue-400",
  },
  kakao: {
    label: "카카오맵",
    short: "카카오",
    dot: "bg-amber-400",
    solid: "bg-amber-500 text-white border-amber-500",
    soft: "text-amber-600 dark:text-amber-400",
  },
  naver: {
    label: "네이버 플레이스",
    short: "네이버",
    dot: "bg-emerald-500",
    solid: "bg-emerald-600 text-white border-emerald-600",
    soft: "text-emerald-600 dark:text-emerald-400",
  },
};

/* ── txt export helpers ───────────────────────────────── */

function avgOf(reviews: UnifiedReview[]): number | null {
  const rated = reviews.filter((r) => r.rating !== null) as (UnifiedReview & {
    rating: number;
  })[];
  if (rated.length === 0) return null;
  return (
    Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) /
    10
  );
}

/** Newest-first by createdAt; entries without a valid date sink to the end. */
function newestFirst(reviews: UnifiedReview[]): UnifiedReview[] {
  const t = (r: UnifiedReview) => {
    const ms = r.createdAt ? Date.parse(r.createdAt) : NaN;
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  return [...reviews].sort((a, b) => t(b) - t(a));
}

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR");
}

function reviewBlock(r: UnifiedReview): string {
  const bits: string[] = [];
  if (r.rating !== null) bits.push(`★${r.rating}`);
  if (r.author) bits.push(r.author);
  const date = fmtDate(r.createdAt);
  if (date) bits.push(date);
  const head = bits.join(" · ");
  return `${head ? head + "\n" : ""}${r.text}`;
}

function txtForSource(r: CollectResult): string {
  const place = r.place?.name ?? "";
  const avg = avgOf(r.reviews);
  const lines = [
    `[${META[r.platform].label}] ${place}`.trim(),
    `수집 리뷰 ${r.reviews.length}개` +
      (avg !== null ? ` · 평균 별점 ${avg.toFixed(1)}` : ""),
    r.place?.url ? `원본: ${r.place.url}` : "",
    "=".repeat(48),
    "",
  ].filter(Boolean);
  const body = r.reviews.map(reviewBlock).join("\n\n----\n\n");
  return lines.join("\n") + "\n" + body + "\n";
}

function txtCombined(title: string, results: CollectResult[]): string {
  const usable = results.filter((r) => r.ok && r.reviews.length > 0);
  const header = [
    `장소 리뷰 수집 — ${title}`,
    `수집 소스: ${usable.map((r) => META[r.platform].label).join(", ")}`,
    `총 ${usable.reduce((s, r) => s + r.reviews.length, 0)}개 리뷰`,
    "#".repeat(48),
    "",
    "",
  ].join("\n");
  return header + usable.map(txtForSource).join("\n\n\n");
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeName(s: string): string {
  return (s || "reviews").replace(/[^\w가-힣]+/g, "_").slice(0, 40);
}

/* ── component ────────────────────────────────────────── */

type Phase = "idle" | "searching" | "picking" | "notfound" | "collecting" | "done";

export default function ReviewClient() {
  const [query, setQuery] = useState("");
  // 네이버 플레이스는 브라우저 확장으로 따로 수집 → 기본 언체크.
  const [selected, setSelected] = useState<Platform[]>(["kakao", "web"]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [candidates, setCandidates] = useState<PlaceSearchResult[]>([]);
  const [chosen, setChosen] = useState<PlaceSearchResult | null>(null);
  const [results, setResults] = useState<CollectResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "searching" || phase === "collecting";
  const totalReviews = results
    ? results.reduce((s, r) => s + (r.ok ? r.reviews.length : 0), 0)
    : 0;

  function togglePlatform(p: Platform) {
    setSelected((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  // Step 1 — resolve the query to real place candidates (Kakao).
  async function findPlaces(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || selected.length === 0 || busy) return;
    setPhase("searching");
    setError(null);
    setResults(null);
    setChosen(null);
    setCandidates([]);
    try {
      const res = await fetch(
        `/api/reviews/search?q=${encodeURIComponent(query.trim())}`,
      );
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
      const data = (await res.json()) as { places: PlaceSearchResult[] };
      const places = data.places ?? [];
      if (places.length === 0) {
        setPhase("notfound");
        return;
      }
      setCandidates(places);
      setPhase("picking");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  // Step 2 — collect reviews for the exact place the user picked.
  async function collectFor(place: PlaceSearchResult) {
    setChosen(place);
    setPhase("collecting");
    setError(null);
    setResults(null);
    // 네이버 플레이스 방문자 리뷰는 서버(데이터센터 IP)가 막혀 브라우저 확장으로
    // 직접 수집합니다. 서버에 보내지 않고, 결과 화면에서 안내 카드만 보여줍니다.
    const backendPlatforms = selected.filter((p) => p !== "naver");
    try {
      if (backendPlatforms.length === 0) {
        setResults([]);
        setPhase("done");
        return;
      }
      const res = await fetch("/api/reviews/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: place.name,
          platforms: backendPlatforms,
          place,
        }),
      });
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
      const data = (await res.json()) as { results: CollectResult[] };
      setResults(data.results);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("picking");
    }
  }

  const canSubmit = query.trim().length > 0 && selected.length > 0 && !busy;
  const downloadable = (results ?? []).filter(
    (r) => r.ok && r.reviews.length > 0,
  );

  return (
    <div className="w-full space-y-8">
      {/* Search card */}
      <form onSubmit={findPlaces}>
        <div className="rounded-2xl border border-line bg-card p-2.5 shadow-sm shadow-black/[0.03] ring-1 ring-black/[0.02]">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (phase !== "idle" && phase !== "searching") {
                    setPhase("idle");
                    setResults(null);
                    setCandidates([]);
                    setChosen(null);
                  }
                }}
                placeholder="장소명을 입력하세요 (예: 스타벅스 뉴코아강남점)"
                className="w-full rounded-xl bg-transparent py-3 pl-11 pr-3 text-[15px] outline-none placeholder:text-muted"
              />
            </div>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {phase === "searching" ? (
                <>
                  <Spinner /> 찾는 중
                </>
              ) : (
                "장소 찾기"
              )}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1">
          <span className="text-xs text-muted">수집 대상</span>
          {ALL_PLATFORMS.map((p) => {
            const active = selected.includes(p);
            return (
              <button
                key={p}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => togglePlatform(p)}
                className="inline-flex items-center gap-2 text-sm transition"
              >
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border bg-card transition ${
                    active
                      ? "border-neutral-400 text-neutral-800 dark:border-neutral-400 dark:text-neutral-100"
                      : "border-neutral-300 dark:border-neutral-600"
                  }`}
                >
                  {active && <CheckIcon />}
                </span>
                <span className={active ? "font-medium" : "text-muted"}>
                  {META[p].label}
                </span>
                {p === "naver" && (
                  <span className="text-[11px] text-muted">(확장 프로그램)</span>
                )}
              </button>
            );
          })}
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {phase === "idle" && !error && <EmptyState />}

      {phase === "searching" && <SkeletonList lines={2} />}

      {phase === "notfound" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            ‘{query.trim()}’ 와(과) 일치하는 장소를 찾지 못했어요.
          </p>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/70">
            지점명까지 정확히 입력해 보세요 (예: “스타벅스 뉴코아강남점”).
          </p>
        </div>
      )}

      {/* Step: pick the exact place */}
      {(phase === "picking" || (phase === "done" && chosen)) && (
        <PlacePicker
          candidates={candidates}
          chosen={chosen}
          collapsed={phase === "done"}
          onPick={collectFor}
          onReselect={() => {
            setResults(null);
            setChosen(null);
            setPhase("picking");
          }}
        />
      )}

      {phase === "collecting" && (
        <SkeletonList lines={selected.length} />
      )}

      {phase === "done" && results && (
        <div className="space-y-4">
          {downloadable.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/80 to-card px-5 py-4 shadow-sm dark:border-indigo-900/50 dark:from-indigo-950/30">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  리뷰 {totalReviews}개 수집 완료
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {downloadable.map((r) => META[r.platform].short).join(" · ")}{" "}
                  리뷰를 텍스트 파일로 내려받아 분석에 쓰세요.
                </p>
              </div>
              {downloadable.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    download(
                      `${safeName(chosen?.name ?? query)}_전체리뷰.txt`,
                      txtCombined(chosen?.name ?? query, results),
                    )
                  }
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:brightness-110"
                >
                  <DownloadIcon />
                  전체 .txt 다운로드
                </button>
              )}
            </div>
          )}

          {results.map((r) => (
            <PlatformCard
              key={r.platform}
              result={r}
              query={chosen?.name ?? query}
            />
          ))}

          {selected.includes("naver") && (
            <NaverExtensionGuide placeName={chosen?.name ?? query} />
          )}
        </div>
      )}
    </div>
  );
}

function NaverExtensionGuide({ placeName }: { placeName: string }) {
  const naverUrl = `https://map.naver.com/p/search/${encodeURIComponent(placeName)}`;
  return (
    <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <div className="flex items-center gap-2.5 border-b border-emerald-200/70 px-5 py-3.5 dark:border-emerald-900/50">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <span className="text-sm font-semibold">네이버 플레이스</span>
        <span className="ml-auto rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          확장 프로그램으로 수집
        </span>
      </div>
      <div className="px-5 py-4 text-sm leading-relaxed">
        <p className="text-muted">
          네이버는 서버(데이터센터 IP)로는 리뷰를 막습니다. 그래서 네이버 플레이스
          방문자 리뷰는 <b className="text-foreground">본인 브라우저의 확장
          프로그램</b>으로 직접 수집합니다. (한국 IP라 안 막혀요.)
        </p>
        <ol className="mt-3 space-y-2">
          {[
            <>
              확장 설치:{" "}
              <a
                href="https://chromewebstore.google.com/search/web%20scraper"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-emerald-700 underline dark:text-emerald-400"
              >
                Web Scraper
              </a>{" "}
              (완성도) 또는{" "}
              <a
                href="https://chromewebstore.google.com/search/instant%20data%20scraper"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-emerald-700 underline dark:text-emerald-400"
              >
                Instant Data Scraper
              </a>{" "}
              (간편). 설치 후 브라우저 새로고침.
            </>,
            <>
              <a
                href={naverUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-emerald-700 underline dark:text-emerald-400"
              >
                네이버 지도에서 ‘{placeName}’ 열기
              </a>{" "}
              → 리뷰 → 방문자 탭.
            </>,
            <>리뷰 목록을 아래로 스크롤해 원하는 만큼 로드(각 리뷰 “더보기”로 본문 펼침).</>,
            <>확장 실행 → CSV로 내보내기.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <span className="text-neutral-700 dark:text-neutral-300">
                {step}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t border-emerald-200/70 pt-3 text-xs text-muted dark:border-emerald-900/50">
          난독화된 페이지라 자동 감지가 어긋나면 Web Scraper가 더 안정적이에요.
          설정이 필요하면 리뷰 페이지 DOM을 알려주시면 선택자를 만들어 드립니다.
        </p>
      </div>
    </section>
  );
}

function PlacePicker({
  candidates,
  chosen,
  collapsed,
  onPick,
  onReselect,
}: {
  candidates: PlaceSearchResult[];
  chosen: PlaceSearchResult | null;
  collapsed: boolean;
  onPick: (p: PlaceSearchResult) => void;
  onReselect: () => void;
}) {
  if (collapsed && chosen) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-card px-4 py-3">
        <span className="text-xs text-muted">수집 대상</span>
        <span className="text-sm font-semibold">{chosen.name}</span>
        {chosen.address && (
          <span className="truncate text-xs text-muted">{chosen.address}</span>
        )}
        {candidates.length > 1 && (
          <button
            type="button"
            onClick={onReselect}
            className="ml-auto text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            다른 장소 선택
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="px-1 text-sm">
        <b>이 장소가 맞나요?</b>{" "}
        <span className="text-muted">정확한 곳을 선택하면 리뷰를 모읍니다.</span>
      </p>
      <ul className="space-y-2">
        {candidates.map((c) => (
          <li key={c.placeId}>
            <button
              type="button"
              onClick={() => onPick(c)}
              className="group flex w-full items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                <PinIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {c.name}
                </span>
                <span className="block truncate text-xs text-muted">
                  {[c.category, c.address].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-indigo-500">
                <ChevronIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlatformCard({
  result,
  query,
}: {
  result: CollectResult;
  query: string;
}) {
  const { platform, place, reviews, ok, error, errorCode } = result;
  const m = META[platform];
  const notReady =
    errorCode === "MISSING_KEY" || errorCode === "SCRAPER_DISABLED";

  const rated = reviews.filter((r) => r.rating !== null) as (UnifiedReview & {
    rating: number;
  })[];
  const avg = avgOf(reviews);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm shadow-black/[0.03]">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
        <span className="text-sm font-semibold">{m.label}</span>
        {place?.name && (
          <span className="truncate text-sm text-muted">· {place.name}</span>
        )}
        <span className="ml-auto shrink-0">
          {ok ? (
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              리뷰 {reviews.length}
            </span>
          ) : notReady ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              준비중
            </span>
          ) : (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-600 dark:bg-red-950 dark:text-red-300">
              실패
            </span>
          )}
        </span>
      </div>

      {!ok && (
        <div className="px-5 py-4 text-sm text-muted">
          <p className="leading-relaxed">{error}</p>
        </div>
      )}

      {ok && (
        <div className="px-5 py-4">
          {/* summary row */}
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            {avg !== null ? (
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold tabular-nums leading-none">
                  {avg.toFixed(1)}
                </span>
                <div>
                  <StarRow value={avg} />
                  <div className="mt-0.5 text-xs text-muted">
                    {rated.length}개 평점 · 총 {reviews.length}개 리뷰
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted">
                <b className="text-foreground">{reviews.length}</b>개 수집
                <span className="ml-2 text-xs">(별점 없는 소스)</span>
              </div>
            )}

            {place?.url && (
              <a
                href={place.url}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1 text-sm font-medium ${m.soft} hover:underline`}
              >
                원본 보기
                <ExternalIcon />
              </a>
            )}

            {reviews.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  download(
                    `${safeName(query)}_${m.short}.txt`,
                    txtForSource(result),
                  )
                }
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                .txt 다운로드
              </button>
            )}
          </div>

          {rated.length > 1 && (
            <div className="mb-5">
              <RatingBars reviews={rated} />
            </div>
          )}

          {/* review preview — newest 5 */}
          {reviews.length > 0 ? (
            <>
              <ul className="divide-y divide-line">
                {newestFirst(reviews)
                  .slice(0, 5)
                  .map((r) => (
                    <ReviewItem key={r.reviewId} r={r} />
                  ))}
              </ul>
              {reviews.length > 5 && (
                <p className="pt-3 text-center text-xs text-muted">
                  최신 미리보기 5개 · 전체 {reviews.length}개는 .txt 다운로드로
                  확인하세요
                </p>
              )}
            </>
          ) : (
            <p className="py-2 text-sm text-muted">수집된 리뷰가 없습니다.</p>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewItem({ r }: { r: UnifiedReview }) {
  const initial = [...(r.author || "익")][0] ?? "익";
  return (
    <li className="flex gap-3 py-3.5 first:pt-1">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-100 to-neutral-200 text-xs font-semibold text-neutral-500 dark:from-neutral-800 dark:to-neutral-700 dark:text-neutral-300">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium">{r.author}</span>
          {r.rating !== null && (
            <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-amber-500">
              <StarIcon className="h-3.5 w-3.5" /> {r.rating}
            </span>
          )}
          {r.createdAt && (
            <span className="text-xs text-muted">
              {new Date(r.createdAt).toLocaleDateString("ko-KR")}
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
          {r.text}
        </p>
      </div>
    </li>
  );
}

function RatingBars({
  reviews,
}: {
  reviews: (UnifiedReview & { rating: number })[];
}) {
  const buckets = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => Math.round(r.rating) === star).length,
  }));
  const total = reviews.length || 1;
  return (
    <div className="space-y-1.5 rounded-xl bg-neutral-50 p-3.5 dark:bg-neutral-900/50">
      {buckets.map((b) => (
        <div key={b.star} className="flex items-center gap-2.5 text-xs">
          <span className="w-6 shrink-0 text-muted">{b.star}점</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all"
              style={{ width: `${(b.count / total) * 100}%` }}
            />
          </div>
          <span className="w-5 shrink-0 text-right tabular-nums text-muted">
            {b.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function StarRow({ value, size = 15 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span
      className="relative inline-flex leading-none"
      style={{ fontSize: size, letterSpacing: "1px" }}
      aria-label={`${value}점`}
    >
      <span className="text-neutral-300 dark:text-neutral-700">★★★★★</span>
      <span
        className="absolute inset-0 overflow-hidden whitespace-nowrap text-amber-400"
        style={{ width: `${pct}%` }}
      >
        ★★★★★
      </span>
    </span>
  );
}

function SkeletonList({ lines }: { lines: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse overflow-hidden rounded-2xl border border-line bg-card"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-200 dark:bg-neutral-700" />
            <span className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
          <div className="space-y-3 px-5 py-5">
            <div className="h-8 w-28 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-3 w-full rounded bg-neutral-100 dark:bg-neutral-800" />
            <div className="h-3 w-4/5 rounded bg-neutral-100 dark:bg-neutral-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-muted dark:bg-neutral-800">
        <SearchIcon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">장소를 검색해 리뷰를 모아보세요</p>
      <p className="mt-1 text-xs text-muted">
        가게 이름을 입력하면 일치하는 장소 후보를 보여드려요. 정확한 곳을 고르면
        요약과 함께 전체 리뷰를 txt 파일로 내려받을 수 있습니다.
      </p>
    </div>
  );
}

/* ── icons ─────────────────────────────────────────── */

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path
        d="m20 20-3.2-3.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
      <path
        d="m5 12 5 5 9-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M12 2C8.7 2 6 4.7 6 8c0 4.2 6 12 6 12s6-7.8 6-12c0-3.3-2.7-6-6-6z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="8" r="2.2" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="m9 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? "h-4 w-4"}>
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.8 6.1 20.8l1.2-6.6L2.5 9.6l6.6-.9L12 2z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
      <path
        d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

"use client";

import { Fragment, useState } from "react";

import type {
  Platform,
  UnifiedReview,
  CollectResult,
  PlaceSearchResult,
} from "@/lib/reviews/types";

const ALL_PLATFORMS: Platform[] = ["kakao", "naver", "google"];

const META: Record<
  Platform,
  { label: string; short: string; dot: string; solid: string; soft: string }
> = {
  kakao: {
    label: "카카오맵",
    short: "카카오",
    dot: "bg-amber-400",
    solid: "bg-amber-500 text-white border-amber-500",
    soft: "text-amber-600 dark:text-amber-400",
  },
  naver: {
    label: "네이버맵",
    short: "네이버",
    dot: "bg-emerald-500",
    solid: "bg-emerald-600 text-white border-emerald-600",
    soft: "text-emerald-600 dark:text-emerald-400",
  },
  google: {
    label: "구글맵",
    short: "구글",
    dot: "bg-red-500",
    solid: "bg-red-600 text-white border-red-600",
    soft: "text-red-600 dark:text-red-400",
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
  // 네이버맵는 Apify(유료 크레딧) 호출이라 기본 언체크로 두어, 사용자가
  // 원할 때만 켜서 크레딧을 아낀다. (카카오·네이버검색은 무료라 기본 선택.)
  const [selected, setSelected] = useState<Platform[]>(["kakao"]);
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
    // 네이버맵 방문자 리뷰는 서버가 Apify 액터로 자동 수집한다.
    try {
      const res = await fetch("/api/reviews/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: place.name,
          platforms: selected,
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
                placeholder="장소명을 입력하세요 (예: 커피에반하다 광교호수공원점)"
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

      {phase === "idle" && !error && <HowToUse />}

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
        </div>
      )}
    </div>
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

/** 3-step "how to use" flow shown before any search. */
function HowToUse() {
  const steps = [
    {
      n: 1,
      title: "데이터 수집",
      desc: "카카오맵·네이버맵·구글맵을 통해 리뷰 데이터를 수집합니다.",
      icon: <PinIcon />,
      box: "border-sky-200 bg-sky-50/70 dark:border-sky-900/50 dark:bg-sky-950/30",
      chip: "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300",
      step: "text-sky-600 dark:text-sky-300",
    },
    {
      n: 2,
      title: "데이터 다운로드와 전처리",
      desc: "수집한 데이터를 다운로드 받고 분석에 사용할 데이터와 사용하지 않을 데이터를 결정합니다.",
      icon: <DownloadIcon className="h-4 w-4" />,
      box: "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/25",
      chip: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
      step: "text-amber-600 dark:text-amber-300",
    },
    {
      n: 3,
      title: "AI 데이터 분석",
      desc: "다운로드한 데이터를 생성형 AI에 업로드하여 리뷰 분석을 통해 인사이트를 도출하세요.",
      icon: <SparkIcon />,
      box: "border-violet-200 bg-violet-50/70 dark:border-violet-900/50 dark:bg-violet-950/30",
      chip: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300",
      step: "text-violet-600 dark:text-violet-300",
    },
  ];
  return (
    <div>
      <h2 className="text-center text-base font-semibold tracking-tight sm:text-lg">
        이렇게 활용해 보세요
      </h2>
      <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row">
        {steps.map((s, i) => (
          <Fragment key={s.n}>
            <div className={`flex-1 rounded-2xl border p-5 shadow-sm shadow-black/[0.02] ${s.box}`}>
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${s.chip}`}
                >
                  {s.icon}
                </span>
                <div className="min-w-0">
                  <div className={`text-[11px] font-bold tracking-wide ${s.step}`}>
                    STEP {s.n}
                  </div>
                  <div className="text-sm font-semibold leading-tight">
                    {s.title}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                {s.desc}
              </p>
            </div>
            {i < steps.length - 1 && (
              <div
                aria-hidden
                className="flex items-center justify-center text-neutral-300 dark:text-neutral-600"
              >
                <span className="rotate-90 sm:rotate-0">
                  <ChevronIcon />
                </span>
              </div>
            )}
          </Fragment>
        ))}
      </div>
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

function SparkIcon() {
  // Two four-point sparkles — a light "AI" glyph.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M11 2.5c.34 3.2 1.8 4.66 5 5-3.2.34-4.66 1.8-5 5-.34-3.2-1.8-4.66-5-5 3.2-.34 4.66-1.8 5-5Z" />
      <path d="M18.5 13c.2 1.7 1 2.5 2.7 2.7-1.7.2-2.5 1-2.7 2.7-.2-1.7-1-2.5-2.7-2.7 1.7-.2 2.5-1 2.7-2.7Z" />
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

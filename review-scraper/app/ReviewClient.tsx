"use client";

import { useState } from "react";

type Platform = "google" | "kakao" | "naver";

interface UnifiedReview {
  platform: Platform;
  placeId: string;
  reviewId: string;
  author: string;
  rating: number | null;
  text: string;
  createdAt?: string;
  likeCount?: number;
  source: "api" | "scrape";
}

interface PlaceSearchResult {
  platform: Platform;
  placeId: string;
  name: string;
  address?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  url?: string;
}

interface CollectResult {
  platform: Platform;
  place: PlaceSearchResult | null;
  reviews: UnifiedReview[];
  ok: boolean;
  error?: string;
  errorCode?: string;
}

const ALL_PLATFORMS: Platform[] = ["google", "kakao", "naver"];

const META: Record<
  Platform,
  { label: string; dot: string; solid: string; soft: string }
> = {
  google: {
    label: "구글맵",
    dot: "bg-blue-500",
    solid: "bg-blue-600 text-white border-blue-600",
    soft: "text-blue-600 dark:text-blue-400",
  },
  kakao: {
    label: "카카오맵",
    dot: "bg-amber-400",
    solid: "bg-amber-500 text-white border-amber-500",
    soft: "text-amber-600 dark:text-amber-400",
  },
  naver: {
    label: "네이버 플레이스",
    dot: "bg-emerald-500",
    solid: "bg-emerald-600 text-white border-emerald-600",
    soft: "text-emerald-600 dark:text-emerald-400",
  },
};

export default function ReviewClient() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Platform[]>(["kakao"]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CollectResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function togglePlatform(p: Platform) {
    setSelected((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || selected.length === 0) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/reviews/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), platforms: selected }),
      });
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
      const data = (await res.json()) as { results: CollectResult[] };
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = query.trim().length > 0 && selected.length > 0 && !loading;

  return (
    <div className="w-full space-y-8">
      {/* Search card */}
      <form onSubmit={run}>
        <div className="rounded-2xl border border-line bg-card p-2.5 shadow-sm shadow-black/[0.03] ring-1 ring-black/[0.02]">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="장소명을 입력하세요 (예: 스타벅스 강남점)"
                className="w-full rounded-xl bg-transparent py-3 pl-11 pr-3 text-[15px] outline-none placeholder:text-muted"
              />
            </div>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {loading ? (
                <>
                  <Spinner /> 수집 중
                </>
              ) : (
                "리뷰 수집"
              )}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
          <span className="text-xs text-muted">수집 대상</span>
          {ALL_PLATFORMS.map((p) => {
            const active = selected.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? META[p].solid + " shadow-sm"
                    : "border-line bg-card text-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white/90" : META[p].dot}`}
                />
                {META[p].label}
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

      {loading && (
        <div className="space-y-4">
          {selected.map((p) => (
            <SkeletonCard key={p} />
          ))}
        </div>
      )}

      {!loading && !results && !error && <EmptyState />}

      {results && (
        <div className="space-y-4">
          {results.map((r) => (
            <PlatformCard key={r.platform} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformCard({ result }: { result: CollectResult }) {
  const { platform, place, reviews, ok, error, errorCode } = result;
  const m = META[platform];
  const notReady =
    errorCode === "MISSING_KEY" || errorCode === "SCRAPER_DISABLED";

  const rated = reviews.filter((r) => r.rating !== null) as (UnifiedReview & {
    rating: number;
  })[];
  const avg =
    rated.length > 0
      ? Math.round(
          (rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10,
        ) / 10
      : null;

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
          {/* summary */}
          {(avg !== null || place?.address || place?.url) && (
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
              {avg !== null && (
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold tabular-nums leading-none">
                    {avg.toFixed(1)}
                  </span>
                  <div>
                    <StarRow value={avg} />
                    <div className="mt-0.5 text-xs text-muted">
                      {rated.length}개 평점
                    </div>
                  </div>
                </div>
              )}
              {place?.address && (
                <span className="text-sm text-muted">{place.address}</span>
              )}
              {place?.url && (
                <a
                  href={place.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`ml-auto inline-flex items-center gap-1 text-sm font-medium ${m.soft} hover:underline`}
                >
                  원본 보기
                  <ExternalIcon />
                </a>
              )}
            </div>
          )}

          {rated.length > 1 && (
            <div className="mb-5">
              <RatingBars reviews={rated} />
            </div>
          )}

          {/* reviews */}
          {reviews.length > 0 ? (
            <ul className="divide-y divide-line">
              {reviews.slice(0, 20).map((r) => (
                <ReviewItem key={r.reviewId} r={r} />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted">수집된 리뷰가 없습니다.</p>
          )}

          {reviews.length > 20 && (
            <p className="pt-3 text-center text-xs text-muted">
              최근 20개만 표시 (총 {reviews.length}개 수집)
            </p>
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

function SkeletonCard() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-line bg-card">
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
        가게 이름을 입력하고 수집 대상을 골라 “리뷰 수집”을 누르세요.
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

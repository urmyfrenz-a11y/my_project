"use client";

import { useState } from "react";

type Platform = "google" | "kakao" | "naver";

const PLATFORM_LABELS: Record<Platform, string> = {
  google: "구글맵",
  kakao: "카카오맵",
  naver: "네이버 플레이스",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  google: "bg-blue-500",
  kakao: "bg-yellow-400",
  naver: "bg-green-500",
};

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

export default function ReviewClient() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Platform[]>(ALL_PLATFORMS);
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

  return (
    <div className="space-y-8">
      {/* Search form */}
      <form onSubmit={run} className="space-y-4">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="장소명을 입력하세요 (예: 스타벅스 강남점)"
            className="flex-1 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          />
          <button
            type="submit"
            disabled={loading || !query.trim() || selected.length === 0}
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {loading ? "수집 중…" : "수집"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                selected.includes(p)
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
              }`}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="animate-pulse text-sm text-neutral-400">
          여러 플랫폼에서 리뷰를 모으는 중입니다…
        </div>
      )}

      {results && (
        <div className="space-y-6">
          {results.map((r) => (
            <PlatformCard key={r.platform} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformCard({ result }: { result: CollectResult }) {
  const { platform, place, reviews, ok, error } = result;
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
    <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <div className="mb-4 flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${PLATFORM_COLORS[platform]}`}
        />
        <h2 className="font-semibold">{PLATFORM_LABELS[platform]}</h2>
        {place?.name && (
          <span className="text-sm text-neutral-500">· {place.name}</span>
        )}
        <span className="ml-auto text-xs text-neutral-400">
          {ok ? `${reviews.length}개 리뷰` : "실패"}
        </span>
      </div>

      {!ok && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {error}
        </p>
      )}

      {ok && (
        <>
          <div className="mb-4 flex flex-wrap gap-6 text-sm">
            {avg !== null && (
              <div>
                <span className="text-neutral-400">평균 별점 </span>
                <span className="font-semibold">★ {avg}</span>
              </div>
            )}
            {place?.address && (
              <div className="text-neutral-500">{place.address}</div>
            )}
            {place?.url && (
              <a
                href={place.url}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-500 underline underline-offset-2"
              >
                원본 보기 ↗
              </a>
            )}
          </div>

          {rated.length > 0 && <RatingBars reviews={rated} />}

          <ul className="mt-4 divide-y divide-neutral-100 dark:divide-neutral-800">
            {reviews.slice(0, 20).map((r) => (
              <li key={r.reviewId} className="py-3">
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <span>{r.author}</span>
                  {r.rating !== null && <span>★ {r.rating}</span>}
                  {r.createdAt && (
                    <span>{new Date(r.createdAt).toLocaleDateString("ko-KR")}</span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed">{r.text}</p>
              </li>
            ))}
          </ul>
          {reviews.length === 0 && (
            <p className="text-sm text-neutral-400">수집된 리뷰가 없습니다.</p>
          )}
        </>
      )}
    </section>
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
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="space-y-1">
      {buckets.map((b) => (
        <div key={b.star} className="flex items-center gap-2 text-xs">
          <span className="w-6 text-neutral-400">{b.star}★</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
            <div
              className="h-full rounded bg-neutral-900 dark:bg-neutral-200"
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right text-neutral-400">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

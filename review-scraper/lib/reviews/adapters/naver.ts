import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { anonymizeAuthor, fetchWithTimeout, toIsoDate } from "../util";

// Naver Place has no public review API and needs a real browser to scrape,
// which Vercel serverless can't run. So the scraping lives in a dedicated
// Playwright worker (see /naver-worker) and this adapter just calls it.
// Enable by setting NAVER_WORKER_URL (+ optional NAVER_WORKER_TOKEN).

interface WorkerResponse {
  place?: { placeId?: string; name?: string; url?: string } | null;
  reviews?: Array<{
    reviewId?: string;
    author?: string;
    text?: string;
    createdAt?: string;
  }>;
  error?: string;
}

export async function naverCollect(query: string): Promise<CollectResult> {
  const base = config.naver.workerUrl.replace(/\/$/, "");
  if (!base) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error:
        "네이버 워커 미연결 (NAVER_WORKER_URL 설정 필요 — /naver-worker 참고).",
      errorCode: "SCRAPER_DISABLED",
    };
  }

  try {
    const res = await fetchWithTimeout(
      `${base}/collect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.naver.workerToken
            ? { "x-worker-token": config.naver.workerToken }
            : {}),
        },
        body: JSON.stringify({ query }),
      },
      45000,
    );
    if (!res.ok) {
      return {
        platform: "naver",
        place: null,
        reviews: [],
        ok: false,
        error: `네이버 워커 오류 (${res.status})`,
        errorCode: "UPSTREAM_ERROR",
      };
    }
    const data = (await res.json()) as WorkerResponse;
    if (data.error && (!data.reviews || data.reviews.length === 0)) {
      return {
        platform: "naver",
        place: null,
        reviews: [],
        ok: false,
        error: data.error,
        errorCode: "NO_MATCH",
      };
    }

    const placeId = data.place?.placeId ?? "";
    const reviews: UnifiedReview[] = (data.reviews ?? [])
      .map((r, i) => ({
        platform: "naver" as const,
        placeId,
        reviewId: String(r.reviewId ?? `${placeId}:${i}`),
        author: anonymizeAuthor(r.author),
        // Naver visitor reviews are keyword-based, not star-based.
        rating: null,
        text: String(r.text ?? ""),
        createdAt: toIsoDate(r.createdAt),
        source: "scrape" as const,
      }))
      .filter((r) => r.text.trim());

    const place: PlaceSearchResult | null = data.place?.placeId
      ? {
          platform: "naver",
          placeId,
          name: data.place.name ?? query,
          url:
            data.place.url ??
            `https://m.place.naver.com/place/${placeId}/home`,
          reviewCount: reviews.length,
        }
      : null;

    return { platform: "naver", place, reviews, ok: true };
  } catch (e) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      errorCode: "UPSTREAM_ERROR",
    };
  }
}

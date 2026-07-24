import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import {
  anonymizeAuthor,
  fetchWithTimeout,
  normalizeRating,
  toIsoDate,
} from "../util";

// Kakao has TWO surfaces:
//  1. Local REST API (dapi.kakao.com) — official, keyed. Place SEARCH only,
//     no review bodies. We use it to resolve query -> place_id + metadata.
//  2. place.map.kakao.com internal JSON — unofficial. Carries review bodies.
//     This is the "우회" part; it can change without notice, so it's guarded.

const LOCAL_SEARCH = "https://dapi.kakao.com/v2/local/search/keyword.json";

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name?: string;
  address_name?: string;
  road_address_name?: string;
  x?: string; // lng
  y?: string; // lat
  place_url?: string;
}

/** Official Local API keyword search -> place candidates. */
export async function kakaoSearchPlaces(
  query: string,
): Promise<PlaceSearchResult[]> {
  if (!config.kakao.restKey) return [];
  const url = `${LOCAL_SEARCH}?query=${encodeURIComponent(query)}&size=10`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `KakaoAK ${config.kakao.restKey}` },
  });
  if (!res.ok) throw new Error(`Kakao local ${res.status}`);
  const data = (await res.json()) as { documents?: KakaoDoc[] };
  return (data.documents ?? []).map((d) => ({
    platform: "kakao" as const,
    placeId: d.id,
    name: d.place_name,
    address: d.road_address_name || d.address_name,
    category: d.category_name?.split(">").pop()?.trim(),
    lat: d.y ? Number(d.y) : undefined,
    lng: d.x ? Number(d.x) : undefined,
    url: d.place_url,
  }));
}

/**
 * Unofficial: pull review bodies from the map place endpoint.
 * Shape is best-effort and defensively parsed — if Kakao changes it, we
 * degrade to "0 reviews" rather than throwing.
 */
interface KakaoPanelReview {
  review_id?: number | string;
  confirm_id?: number | string;
  star_rating?: number;
  contents?: string;
  title?: string;
  registered_at?: string;
  like_count?: number;
  meta?: { owner?: { nickname?: string } };
}

/**
 * Pull visitor reviews from Kakao's current place API (fallback path).
 * The old place.map.kakao.com/main/v/{id} endpoint is gone (404). Reviews now
 * live in the panel3 payload — star reviews under kakaomap_review.reviews and
 * blog reviews under blog_review.reviews. The endpoint only answers when the
 * `pf: web` header is present (otherwise 406). This surface caps at ~7 items
 * total; for 100+ reviews connect the browser worker (KAKAO_WORKER_URL).
 */
async function kakaoGetReviewsPanel(placeId: string): Promise<UnifiedReview[]> {
  const url = `https://place-api.map.kakao.com/places/panel3/${placeId}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      pf: "web",
      Referer: "https://place.map.kakao.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
  });
  if (!res.ok) return [];
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  const d = data as {
    kakaomap_review?: { reviews?: unknown[] };
    blog_review?: { reviews?: unknown[] };
  };
  const reviews: UnifiedReview[] = [];
  const seen = new Set<string>();

  // Star reviews (have star_rating + contents).
  for (const item of arr(d?.kakaomap_review?.reviews)) {
    const r = item as KakaoPanelReview;
    const text = String(r.contents ?? "").trim();
    if (!text) continue; // skip photo-only
    const id = String(r.review_id ?? `k:${reviews.length}`);
    if (seen.has(id)) continue;
    seen.add(id);
    reviews.push({
      platform: "kakao",
      placeId,
      reviewId: id,
      author: anonymizeAuthor(r.meta?.owner?.nickname),
      rating: normalizeRating(r.star_rating),
      text,
      createdAt: toIsoDate(r.registered_at),
      likeCount: r.like_count,
      source: "scrape",
    });
  }

  // Blog reviews (title + contents, no star rating).
  for (const item of arr(d?.blog_review?.reviews)) {
    const r = item as KakaoPanelReview;
    const body = [r.title, r.contents]
      .map((s) => String(s ?? "").trim())
      .filter(Boolean)
      .join(" — ");
    if (!body) continue;
    const id = `blog:${r.review_id ?? r.confirm_id ?? reviews.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    reviews.push({
      platform: "kakao",
      placeId,
      reviewId: id,
      author: "블로그",
      rating: null,
      text: body,
      createdAt: toIsoDate(r.registered_at),
      source: "scrape",
    });
  }
  return reviews;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

interface KakaoWorkerResponse {
  reviews?: Array<{
    reviewId?: string | number;
    author?: string;
    rating?: number | null;
    text?: string;
    createdAt?: string;
    likeCount?: number;
  }>;
  error?: string;
}

/**
 * Full-volume path: a Playwright worker (see /kakao-worker) opens the real
 * Kakao place page, scrolls the review tab and rides the paginated review
 * endpoint to collect 100+ reviews. Returns null when the worker isn't
 * configured or fails, so the caller can fall back to the panel payload.
 */
async function kakaoGetReviewsWorker(
  placeId: string,
): Promise<UnifiedReview[] | null> {
  const base = config.kakao.workerUrl.replace(/\/$/, "");
  if (!base) return null;
  try {
    const res = await fetchWithTimeout(
      `${base}/collect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.kakao.workerToken
            ? { "x-worker-token": config.kakao.workerToken }
            : {}),
        },
        body: JSON.stringify({ placeId }),
      },
      55000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as KakaoWorkerResponse;
    if (!Array.isArray(data.reviews)) return null;
    const out: UnifiedReview[] = [];
    for (const r of data.reviews) {
      const text = String(r.text ?? "").trim();
      if (!text) continue;
      out.push({
        platform: "kakao",
        placeId,
        reviewId: String(r.reviewId ?? `k:${out.length}`),
        author: r.author === "블로그" ? "블로그" : anonymizeAuthor(r.author),
        rating: normalizeRating(r.rating),
        text,
        createdAt: toIsoDate(r.createdAt),
        likeCount: r.likeCount,
        source: "scrape",
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Worker first (100+), panel fallback (~7). */
async function kakaoGetReviews(placeId: string): Promise<UnifiedReview[]> {
  const viaWorker = await kakaoGetReviewsWorker(placeId);
  if (viaWorker && viaWorker.length > 0) return viaWorker;
  return kakaoGetReviewsPanel(placeId);
}

export async function kakaoCollect(query: string): Promise<CollectResult> {
  if (!config.kakao.restKey) {
    return {
      platform: "kakao",
      place: null,
      reviews: [],
      ok: false,
      error: "KAKAO_REST_API_KEY 가 설정되지 않았습니다.",
      errorCode: "MISSING_KEY",
    };
  }
  try {
    const candidates = await kakaoSearchPlaces(query);
    if (candidates.length === 0) {
      return {
        platform: "kakao",
        place: null,
        reviews: [],
        ok: false,
        error: "검색 결과가 없습니다.",
        errorCode: "NO_MATCH",
      };
    }
    const place = candidates[0];
    const reviews = await kakaoGetReviews(place.placeId);
    return {
      platform: "kakao",
      place: { ...place, reviewCount: reviews.length || place.reviewCount },
      reviews,
      ok: true,
    };
  } catch (e) {
    return {
      platform: "kakao",
      place: null,
      reviews: [],
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      errorCode: "UPSTREAM_ERROR",
    };
  }
}

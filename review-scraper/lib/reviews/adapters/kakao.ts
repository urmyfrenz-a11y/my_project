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

const REVIEW_HEADERS = {
  Accept: "application/json",
  pf: "web",
  Referer: "https://place.map.kakao.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

// Cap per section, matching the ~100-latest cap used for 네이버맵/구글맵.
const KAKAO_MAX = 100;

interface KakaoTabStarReview {
  review_id?: number | string;
  star_rating?: number;
  contents?: string;
  registered_at?: string;
  like_count?: number;
  meta?: { owner?: { nickname?: string } };
}
interface KakaoTabBlogReview {
  review_id?: number | string;
  confirm_id?: number | string;
  title?: string;
  contents?: string;
  author?: string;
  registered_at?: string;
  origin_url?: string;
}

/**
 * Kakao's real review-tab API (captured from the place page's own XHR):
 *   place-api.map.kakao.com/places/tab/reviews/{kakaomap|blog}/{id}
 *     ?order=LATEST&only_photo_review=false[&previous_last_review_id={cursor}]
 * Star reviews live under /kakaomap (star_rating + contents), blog reviews
 * under /blog (title + contents + origin_url). Both page via the cursor
 * `previous_last_review_id` = the last review_id of the previous page, looping
 * while has_next. panel3 only ever shipped ~7; this reaches the full list.
 */
async function kakaoFetchTab<T extends { review_id?: number | string }>(
  kind: "kakaomap" | "blog",
  placeId: string,
): Promise<T[]> {
  const base = `https://place-api.map.kakao.com/places/tab/reviews/${kind}/${placeId}`;
  const out: T[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";
  // 20-page safety bound; also stops on has_next=false / empty / no-progress.
  for (let page = 0; page < 20 && out.length < KAKAO_MAX; page++) {
    const url =
      `${base}?order=LATEST&only_photo_review=false` +
      (cursor ? `&previous_last_review_id=${encodeURIComponent(cursor)}` : "");
    const res = await fetchWithTimeout(url, { headers: REVIEW_HEADERS });
    if (!res.ok) break;
    let data: { reviews?: T[]; has_next?: boolean };
    try {
      data = (await res.json()) as { reviews?: T[]; has_next?: boolean };
    } catch {
      break;
    }
    const batch = arr(data?.reviews) as T[];
    if (batch.length === 0) break;
    out.push(...batch);
    const nextCursor = String(batch[batch.length - 1]?.review_id ?? "");
    if (!nextCursor || seenCursors.has(nextCursor) || data.has_next === false) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return out.slice(0, KAKAO_MAX);
}

/** Full review pull via the tab API (star + blog), paginated. */
async function kakaoGetReviewsTab(placeId: string): Promise<UnifiedReview[]> {
  const reviews: UnifiedReview[] = [];
  const seen = new Set<string>();

  for (const r of await kakaoFetchTab<KakaoTabStarReview>("kakaomap", placeId)) {
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

  for (const r of await kakaoFetchTab<KakaoTabBlogReview>("blog", placeId)) {
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

async function kakaoGetReviews(placeId: string): Promise<UnifiedReview[]> {
  // Prefer the tab API (full list). Fall back to panel3 (~7) only if it yields
  // nothing (e.g. Kakao changes the tab endpoint).
  const tab = await kakaoGetReviewsTab(placeId);
  if (tab.length > 0) return tab;
  return kakaoGetReviewsPanel(placeId);
}

export async function kakaoCollect(
  query: string,
  chosen?: PlaceSearchResult,
): Promise<CollectResult> {
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
    // With the place-picker flow the caller passes the exact place the user
    // chose, so we never silently substitute a fuzzy match. Only fall back to
    // "best match" when no place was chosen (e.g. direct API calls).
    let place = chosen?.placeId ? chosen : null;
    if (!place) {
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
      place = candidates[0];
    }
    // Direct server-side pull from Kakao's review-tab API (star + blog,
    // paginated up to 100 each). No browser worker needed — these endpoints
    // answer plain fetch with the `pf: web` header, same as panel3.
    const reviews = await kakaoGetReviews(place.placeId);
    // 후기(별점 리뷰) 우선, 블로그(별점 없음)는 보완용으로 뒤로 정렬. 별점만
    // 있고 본문 없는 항목은 각 수집 단계에서 이미 제외됨. (안정 정렬 = 각 그룹
    // 내부의 원래 순서는 유지)
    reviews.sort((a, b) => {
      const aBlog = a.author === "블로그" || a.rating === null ? 1 : 0;
      const bBlog = b.author === "블로그" || b.rating === null ? 1 : 0;
      return aBlog - bBlog;
    });
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

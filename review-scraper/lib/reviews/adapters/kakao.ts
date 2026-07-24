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
async function kakaoGetReviews(placeId: string): Promise<UnifiedReview[]> {
  const url = `https://place.map.kakao.com/main/v/${placeId}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      // These headers make the internal endpoint answer with JSON.
      Referer: `https://place.map.kakao.com/${placeId}`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
    },
  });
  if (!res.ok) return [];
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  // Kakao's current shape puts visitor reviews under comment.kamapComntList;
  // older responses used comment.list. Handle both.
  const comment = (data as {
    comment?: { kamapComntList?: unknown[]; list?: unknown[] };
  })?.comment;
  const list = comment?.kamapComntList ?? comment?.list ?? [];
  const reviews: UnifiedReview[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const r = item as {
      commentid?: string | number;
      contents?: string;
      point?: number;
      username?: string;
      date?: string;
      like?: number;
    };
    if (!r.contents) continue; // skip photo-only / empty entries
    reviews.push({
      platform: "kakao",
      placeId,
      reviewId: String(r.commentid ?? `${placeId}:${reviews.length}`),
      author: anonymizeAuthor(r.username),
      rating: normalizeRating(r.point),
      text: r.contents,
      createdAt: toIsoDate(r.date),
      likeCount: r.like,
      source: "scrape",
    });
  }
  return reviews;
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

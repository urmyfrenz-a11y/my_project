import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { anonymizeAuthor, fetchWithTimeout, normalizeRating, toIsoDate } from "../util";

/* ── Apify: Google Maps reviews (primary & only path) ─────
 * Google's official Places API returns at most 5 reviews per place, so it's
 * useless for review analysis. The stable path to real volume is the Apify
 * "Google Maps Reviews" actor (compass/google-maps-reviews-scraper): given a
 * place it returns up to N newest reviews with stars, author and date. We call
 * it synchronously and cap at 100 newest reviews. Pay-per-result, billed to the
 * same APIFY_TOKEN / $5-mo free credit as the Naver actor. */
const APIFY_ACTOR = "compass~google-maps-reviews-scraper";

interface ApifyGoogleReview {
  // place-level fields (repeated on every review row)
  title?: string; // place name
  placeId?: string;
  url?: string; // place url
  // review-level fields
  name?: string; // reviewer display name (when personalData: true)
  text?: string;
  textTranslated?: string;
  stars?: number | null;
  rating?: number | null;
  publishedAtDate?: string; // ISO
  publishAt?: string; // relative ("2주 전")
  reviewId?: string;
  reviewUrl?: string;
}

/* Google Maps search is fuzzy — a search URL can resolve to a nearby but wrong
 * store. We keep only reviews whose resolved place title matches the query
 * (same normalization the Kakao/Naver relevance guard uses). */
function normPlace(s: string): string {
  return (s || "").toLowerCase().replace(/[\s\-_.,·'"()[\]]/g, "");
}
const BRANCH_SUFFIX = /(본점|직영점|지점|점)$/;
function titleMatchesQuery(query: string, title: string): boolean {
  const q = normPlace(query);
  const n = normPlace(title);
  if (!q || !n) return true; // no title to judge → don't over-filter
  if (n.includes(q) || q.includes(n)) return true;
  const tokens = query.split(/\s+/).filter((t) => normPlace(t).length >= 2);
  if (tokens.length === 0) return true;
  return tokens.every((t) => {
    const nt = normPlace(t);
    if (n.includes(nt)) return true;
    const stripped = nt.replace(BRANCH_SUFFIX, "");
    return stripped.length >= 2 && n.includes(stripped);
  });
}

/**
 * Build the actor input. The reviews actor resolves a Google Maps URL to a
 * place and scrapes its reviews. We hand it a Maps search URL built from the
 * query so the user only ever types a place name. maxReviews + maxItems both
 * cap at 100 (newest first). If a first production run shows the actor needs a
 * different input shape (e.g. `placeIds`), this is the one spot to adjust.
 */
function buildInput(query: string) {
  return {
    startUrls: [
      { url: `https://www.google.com/maps/search/${encodeURIComponent(query)}` },
    ],
    maxReviews: 100,
    reviewsSort: "newest",
    language: "ko",
    personalData: true,
  };
}

export async function googleCollect(
  query: string,
  _place?: PlaceSearchResult,
): Promise<CollectResult> {
  const token = config.google.apifyToken;
  if (!token) {
    return {
      platform: "google",
      place: null,
      reviews: [],
      ok: false,
      error: "구글맵 수집이 설정되지 않았습니다 (APIFY_TOKEN 필요).",
      errorCode: "MISSING_KEY",
    };
  }

  const url =
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=55&maxItems=100`;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildInput(query)),
      },
      58000,
    );
  } catch (e) {
    return {
      platform: "google",
      place: null,
      reviews: [],
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      errorCode: "UPSTREAM_ERROR",
    };
  }

  if (!res.ok) {
    return {
      platform: "google",
      place: null,
      reviews: [],
      ok: false,
      error: `구글맵 리뷰 수집 오류 (${res.status})`,
      errorCode: "UPSTREAM_ERROR",
    };
  }

  const items = (await res.json()) as ApifyGoogleReview[];
  const reviews: UnifiedReview[] = [];
  const seen = new Set<string>();
  let placeName = query;
  let placeUrl: string | undefined;

  for (const it of Array.isArray(items) ? items : []) {
    const text = String(it.text ?? it.textTranslated ?? "").trim();
    if (!text) continue;
    // Drop reviews that resolved to a different store than the one searched.
    if (it.title && !titleMatchesQuery(query, it.title)) continue;
    const key = text.slice(0, 40) + "|" + (it.reviewId ?? it.name ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (it.title) placeName = it.title;
    if (it.url) placeUrl = it.url;
    reviews.push({
      platform: "google",
      placeId: it.placeId ?? query,
      reviewId: String(it.reviewId ?? `g:${reviews.length}`),
      author: anonymizeAuthor(it.name),
      rating: normalizeRating(it.stars ?? it.rating ?? null),
      text,
      createdAt: toIsoDate(it.publishedAtDate),
      source: "scrape",
    });
  }

  if (reviews.length === 0) {
    return {
      platform: "google",
      place: null,
      reviews: [],
      ok: false,
      error: "구글맵 리뷰를 찾지 못했습니다.",
      errorCode: "NO_MATCH",
    };
  }

  return {
    platform: "google",
    place: {
      platform: "google",
      placeId: reviews[0].placeId,
      name: placeName,
      url: placeUrl,
      reviewCount: reviews.length,
    },
    reviews,
    ok: true,
  };
}

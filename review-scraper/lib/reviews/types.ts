// Unified review schema shared across every platform adapter.
// The whole point of this project: 3 platforms return 3 totally different
// shapes, and everything downstream (API + UI) speaks ONLY this vocabulary.

export type Platform = "kakao" | "naver" | "google";

export const PLATFORM_LABELS: Record<Platform, string> = {
  kakao: "카카오맵",
  naver: "네이버맵",
  google: "구글맵",
};

/** A place candidate returned from a search query. */
export interface PlaceSearchResult {
  platform: Platform;
  placeId: string;
  name: string;
  address?: string;
  category?: string;
  lat?: number;
  lng?: number;
  rating?: number; // normalized 0–5 average, if the platform exposes one
  reviewCount?: number;
  url?: string;
}

/** One normalized review, regardless of source platform. */
export interface UnifiedReview {
  platform: Platform;
  placeId: string;
  reviewId: string;
  /** Anonymized author label (hashed) — we never store raw nicknames. */
  author: string;
  /** Normalized 0–5 star rating, or null when the platform has no stars
   *  (e.g. Naver visitor reviews are keyword-based, not star-based). */
  rating: number | null;
  text: string;
  /** ISO-8601 date string when known. */
  createdAt?: string;
  likeCount?: number;
  source: "api" | "scrape";
}

/** Result of collecting reviews for one platform. */
export interface CollectResult {
  platform: Platform;
  place: PlaceSearchResult | null;
  reviews: UnifiedReview[];
  ok: boolean;
  /** Present when ok === false. Human-readable reason. */
  error?: string;
  /** Present when ok === false. Machine code for the UI to branch on. */
  errorCode?:
    | "MISSING_KEY"
    | "NO_MATCH"
    | "SCRAPER_DISABLED"
    | "QUOTA_EXCEEDED"
    | "UPSTREAM_ERROR"
    | "UNKNOWN";
}

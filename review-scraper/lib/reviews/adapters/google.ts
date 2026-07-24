import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { anonymizeAuthor, fetchWithTimeout, normalizeRating } from "../util";

// Google Places API (New) — https://places.googleapis.com/v1
// Legit, keyed, ToS-compliant. Only caveat: Place Details returns at MOST 5
// reviews per place. That's a hard Google limit, not something code can lift.
const PLACES_BASE = "https://places.googleapis.com/v1";

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  reviews?: Array<{
    name?: string;
    rating?: number;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string };
    publishTime?: string;
    relativePublishTimeDescription?: string;
  }>;
}

function toPlace(p: GooglePlace): PlaceSearchResult {
  return {
    platform: "google",
    placeId: p.id,
    name: p.displayName?.text ?? "(이름 없음)",
    address: p.formattedAddress,
    category: p.primaryTypeDisplayName?.text,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    rating: p.rating,
    reviewCount: p.userRatingCount,
    url: p.googleMapsUri,
  };
}

/** Text Search — returns place candidates for a free-text query. */
export async function googleSearchPlaces(
  query: string,
): Promise<PlaceSearchResult[]> {
  if (!config.google.apiKey) return [];
  const res = await fetchWithTimeout(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.google.apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.primaryTypeDisplayName",
        "places.googleMapsUri",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query, languageCode: "ko" }),
  });
  if (!res.ok) throw new Error(`Google searchText ${res.status}`);
  const data = (await res.json()) as { places?: GooglePlace[] };
  return (data.places ?? []).map(toPlace);
}

/** Place Details — up to 5 reviews for a given placeId. */
export async function googleGetReviews(placeId: string): Promise<{
  place: PlaceSearchResult;
  reviews: UnifiedReview[];
}> {
  const res = await fetchWithTimeout(
    `${PLACES_BASE}/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": config.google.apiKey,
        "X-Goog-FieldMask": [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "rating",
          "userRatingCount",
          "primaryTypeDisplayName",
          "googleMapsUri",
          "reviews",
        ].join(","),
        "Accept-Language": "ko",
      },
    },
  );
  if (!res.ok) throw new Error(`Google details ${res.status}`);
  const p = (await res.json()) as GooglePlace;
  const place = toPlace(p);
  const reviews: UnifiedReview[] = (p.reviews ?? []).map((r, i) => ({
    platform: "google",
    placeId,
    reviewId: r.name ?? `${placeId}:${i}`,
    author: anonymizeAuthor(r.authorAttribution?.displayName),
    rating: normalizeRating(r.rating),
    text: r.originalText?.text ?? r.text?.text ?? "",
    createdAt: r.publishTime,
    source: "api",
  }));
  return { place, reviews };
}

/** One-shot: search → pick best match → fetch its reviews. */
export async function googleCollect(query: string): Promise<CollectResult> {
  if (!config.google.apiKey) {
    return {
      platform: "google",
      place: null,
      reviews: [],
      ok: false,
      error: "GOOGLE_MAPS_API_KEY 가 설정되지 않았습니다.",
      errorCode: "MISSING_KEY",
    };
  }
  try {
    const candidates = await googleSearchPlaces(query);
    if (candidates.length === 0) {
      return {
        platform: "google",
        place: null,
        reviews: [],
        ok: false,
        error: "검색 결과가 없습니다.",
        errorCode: "NO_MATCH",
      };
    }
    const { place, reviews } = await googleGetReviews(candidates[0].placeId);
    return { platform: "google", place, reviews, ok: true };
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
}

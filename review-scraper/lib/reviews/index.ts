import { webCollect, webSearchPlaces } from "./adapters/web";
import { kakaoCollect, kakaoSearchPlaces } from "./adapters/kakao";
import { naverCollect } from "./adapters/naver";
import { googleCollect } from "./adapters/google";
import type { CollectResult, Platform, PlaceSearchResult } from "./types";

export * from "./types";

const COLLECTORS: Record<
  Platform,
  (q: string, place?: PlaceSearchResult) => Promise<CollectResult>
> = {
  web: webCollect,
  kakao: kakaoCollect,
  naver: naverCollect,
  google: googleCollect,
};

/** Collect reviews across the requested platforms in parallel. */
export async function collectReviews(
  query: string,
  platforms: Platform[],
  place?: PlaceSearchResult,
): Promise<CollectResult[]> {
  const jobs = platforms.map((p) => COLLECTORS[p](query, place));
  const settled = await Promise.allSettled(jobs);
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          platform: platforms[i],
          place: null,
          reviews: [],
          ok: false,
          error: String(s.reason),
          errorCode: "UNKNOWN" as const,
        },
  );
}

/* ── query ↔ candidate relevance ──────────────────────────
 * Kakao's keyword search is fuzzy: "커피에반하다 광교호수공원점" also returns
 * 순천호수공원 · 우지커피 광교호수공원점 · 오공김밥 청라호수공원점 (partial hits on
 * 호수공원/커피/광교). Collecting those would mix other stores' reviews, so we
 * keep only candidates that actually match the query. */

function normPlace(s: string): string {
  return (s || "").toLowerCase().replace(/[\s\-_.,·'"()[\]]/g, "");
}

const BRANCH_SUFFIX = /(본점|직영점|지점|점)$/;

// A query token matches a name if the name contains the token, tolerating a
// trailing branch suffix (…광교호수공원점 ↔ …광교호수공원).
function tokenVariants(token: string): string[] {
  const n = normPlace(token);
  const out = [n];
  const stripped = n.replace(BRANCH_SUFFIX, "");
  if (stripped.length >= 2 && stripped !== n) out.push(stripped);
  return out;
}

function matchesQuery(query: string, name: string): boolean {
  const q = normPlace(query);
  const n = normPlace(name);
  if (!q || !n) return false;
  if (n.includes(q)) return true; // candidate name contains the whole query
  const tokens = query.split(/\s+/).filter((t) => normPlace(t).length >= 2);
  if (tokens.length === 0) return false;
  // every meaningful query token must appear in the candidate name
  return tokens.every((t) => tokenVariants(t).some((v) => n.includes(v)));
}

function rankRelevant(
  query: string,
  places: PlaceSearchResult[],
): PlaceSearchResult[] {
  const q = normPlace(query);
  const seen = new Set<string>();
  return places
    .filter((p) => {
      const key = `${p.platform}:${p.placeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesQuery(query, p.name);
    })
    .sort((a, b) => {
      const an = normPlace(a.name);
      const bn = normPlace(b.name);
      // exact match first, then names containing the full query, then shortest
      // (closest to the bare place name).
      const score = (x: string) => (x === q ? 3 : x.includes(q) ? 2 : 1);
      const d = score(bn) - score(an);
      return d !== 0 ? d : an.length - bn.length;
    });
}

/** Fast place-candidate search (metadata only, no review bodies). */
export async function searchPlaces(
  query: string,
): Promise<PlaceSearchResult[]> {
  const settled = await Promise.allSettled([
    webSearchPlaces(),
    kakaoSearchPlaces(query),
  ]);
  const all = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  return rankRelevant(query, all);
}

import { webCollect, webSearchPlaces } from "./adapters/web";
import { kakaoCollect, kakaoSearchPlaces } from "./adapters/kakao";
import { naverCollect } from "./adapters/naver";
import type { CollectResult, Platform, PlaceSearchResult } from "./types";

export * from "./types";

const COLLECTORS: Record<Platform, (q: string) => Promise<CollectResult>> = {
  web: webCollect,
  kakao: kakaoCollect,
  naver: naverCollect,
};

/** Collect reviews across the requested platforms in parallel. */
export async function collectReviews(
  query: string,
  platforms: Platform[],
): Promise<CollectResult[]> {
  const jobs = platforms.map((p) => COLLECTORS[p](query));
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

/** Fast place-candidate search (metadata only, no review bodies). */
export async function searchPlaces(
  query: string,
): Promise<PlaceSearchResult[]> {
  const settled = await Promise.allSettled([
    webSearchPlaces(),
    kakaoSearchPlaces(query),
  ]);
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}

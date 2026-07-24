import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { fetchWithTimeout } from "../util";

// "구글 검색" source. Google blocks scraping from datacenter IPs, and we don't
// want the paid Google API, so we use Serper.dev (free tier) to fetch real
// Google search results and treat each result snippet as a text item that the
// UI runs sentiment analysis on.
const SERPER = "https://google.serper.dev/search";

function sourceName(link: string): string {
  try {
    const h = new URL(link).hostname.replace(/^www\./, "");
    const map: Record<string, string> = {
      "blog.naver.com": "네이버블로그",
      "cafe.naver.com": "네이버카페",
      "tistory.com": "티스토리",
      "youtube.com": "유튜브",
      "instagram.com": "인스타그램",
      "brunch.co.kr": "브런치",
      "mangoplate.com": "망고플레이트",
    };
    for (const k in map) if (h.endsWith(k)) return map[k];
    return h;
  } catch {
    return "웹";
  }
}

/** Empty stub kept for the (legacy) place-candidate search endpoint. */
export async function googleSearchPlaces(): Promise<PlaceSearchResult[]> {
  return [];
}

export async function googleCollect(query: string): Promise<CollectResult> {
  if (!config.google.serperKey) {
    return {
      platform: "google",
      place: null,
      reviews: [],
      ok: false,
      error:
        "구글 검색 API 키가 없습니다. 무료 Serper.dev 키를 SERPER_API_KEY 로 넣으면 활성화됩니다.",
      errorCode: "MISSING_KEY",
    };
  }
  try {
    const res = await fetchWithTimeout(SERPER, {
      method: "POST",
      headers: {
        "X-API-KEY": config.google.serperKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "kr", hl: "ko", num: 10 }),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const data = (await res.json()) as {
      organic?: { title?: string; link?: string; snippet?: string }[];
    };
    const reviews: UnifiedReview[] = (data.organic ?? [])
      .filter((o) => o.snippet)
      .map((o, i) => ({
        platform: "google" as const,
        placeId: query,
        reviewId: `g:${i}`,
        author: o.link ? sourceName(o.link) : "웹",
        rating: null,
        text: [o.title, o.snippet].filter(Boolean).join(" — "),
        createdAt: undefined,
        source: "scrape" as const,
      }));
    const place: PlaceSearchResult = {
      platform: "google",
      placeId: query,
      name: `"${query}" 구글 검색`,
      reviewCount: reviews.length,
    };
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

import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { anonymizeAuthor, fetchWithTimeout, toIsoDate } from "../util";

// Naver blocks datacenter IPs (Vercel) with a captcha, so we can't fetch Naver
// Place directly. We route through Scrapingdog — a scraping API that fetches
// via a Korean residential IP and can render JS — so the request looks like a
// real Korean visitor. Free tier: 1,000 credits/mo (no card). Set
// SCRAPINGDOG_API_KEY to enable.

const SD = "https://api.scrapingdog.com/scrape";

/** Build a Scrapingdog request URL wrapping the real Naver URL. */
function sd(target: string, dynamic: boolean): string {
  const params = new URLSearchParams({
    api_key: config.naver.scrapingKey,
    url: target,
    country: "kr",
    premium: "true",
  });
  if (dynamic) params.set("dynamic", "true");
  return `${SD}?${params.toString()}`;
}

async function sdGet(
  target: string,
  dynamic: boolean,
  timeoutMs = 50000,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetchWithTimeout(sd(target, dynamic), {}, timeoutMs);
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

interface NaverPlace {
  id: string;
  name: string;
  type: string; // m.place.naver.com path segment (restaurant/place/hairshop…)
}

/**
 * Extract the first Naver place (id + m.place path segment) from a rendered
 * search-results HTML page. Naver embeds links like
 * `m.place.naver.com/restaurant/1234567890/home` for each result.
 */
function extractPlaceFromHtml(html: string, query: string): NaverPlace | null {
  const patterns = [
    /(?:m\.place|pcmap\.place|place)\.naver\.com\/([a-z]+)\/(\d{6,})/i,
    /"(?:type|businessCategory)"\s*:\s*"([a-z]+)"[^}]*?"id"\s*:\s*"?(\d{6,})/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return { id: m[2], name: query, type: m[1].toLowerCase() };
  }
  // Last resort: a bare place id in embedded JSON.
  const bare = /"(?:placeId|entryId|id)"\s*:\s*"?(\d{7,})"?/i.exec(html);
  if (bare) return { id: bare[1], name: query, type: "place" };
  return null;
}

/**
 * Resolve a query to a Naver place. Naver's internal search APIs return 403
 * without a browser context, so we fetch the user-facing mobile search page
 * (rendered via Scrapingdog) and scrape the first place link out of it.
 */
export async function resolveNaverPlace(
  query: string,
): Promise<NaverPlace | null> {
  const searchUrl =
    "https://m.search.naver.com/search.naver?query=" + encodeURIComponent(query);
  const { ok, body } = await sdGet(searchUrl, true, 50000);
  if (!ok) return null;
  return extractPlaceFromHtml(body, query);
}

/** Very defensive parse of visitor-review bodies from rendered review HTML. */
function parseReviews(html: string, placeId: string): UnifiedReview[] {
  const out: UnifiedReview[] = [];
  const seen = new Set<string>();
  // Naver mobile review bodies render inside spans with a data-pui-click-code
  // of "rvbody" (stable-ish), or generic review text spans. Try a few.
  const patterns = [
    /data-pui-click-code="rvbody"[^>]*>([\s\S]*?)<\/[a-z]+>/gi,
    /class="[^"]*pui__vn15t2[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && out.length < 100) {
      const text = m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length < 4 || seen.has(text)) continue;
      seen.add(text);
      out.push({
        platform: "naver",
        placeId,
        reviewId: `n:${out.length}`,
        author: anonymizeAuthor(undefined),
        rating: null,
        text,
        source: "scrape",
      });
    }
    if (out.length > 0) break;
  }
  return out;
}

async function naverViaScrapingApi(query: string): Promise<CollectResult> {
  const place = await resolveNaverPlace(query);
  if (!place) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: "네이버에서 장소를 찾지 못했습니다.",
      errorCode: "NO_MATCH",
    };
  }
  const reviewUrl = `https://m.place.naver.com/${place.type}/${place.id}/review/visitor`;
  const { ok, body } = await sdGet(reviewUrl, true, 55000);
  const reviews = ok ? parseReviews(body, place.id) : [];
  if (reviews.length === 0) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: "네이버 리뷰를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      errorCode: "UPSTREAM_ERROR",
    };
  }
  return {
    platform: "naver",
    place: {
      platform: "naver",
      placeId: place.id,
      name: place.name,
      url: `https://m.place.naver.com/${place.type}/${place.id}/home`,
      reviewCount: reviews.length,
    },
    reviews,
    ok: true,
  };
}

/**
 * Diagnostic helper (used by /api/reviews/naver-debug). Returns the resolved
 * place plus a slice of the raw rendered HTML and the parse count, so we can
 * refine parseReviews against real Naver markup without shipping guesses.
 */
export async function naverDebug(opts: {
  q?: string;
  type?: string;
  id?: string;
}): Promise<Record<string, unknown>> {
  if (!config.naver.scrapingKey) return { hasKey: false };

  // Mode B: fetch a specific place's review page and analyse its markup.
  // One Scrapingdog call only, so it stays under the 60s function limit.
  if (opts.type && opts.id) {
    const reviewUrl = `https://m.place.naver.com/${opts.type}/${opts.id}/review/visitor`;
    const rev = await sdGet(reviewUrl, true, 55000);
    const parsed = parseReviews(rev.body, opts.id);
    // Report several candidate windows so we can see the real review markup.
    const marks = ["data-pui-click-code", "pui__vn15t2", "rvbody", "리뷰", "평점", "방문"];
    const windows: Record<string, string> = {};
    for (const m of marks) {
      const at = rev.body.indexOf(m);
      if (at >= 0) windows[m] = rev.body.slice(at, at + 600);
    }
    return {
      hasKey: true,
      reviewUrl,
      ok: rev.ok,
      status: rev.status,
      bodyLength: rev.body.length,
      parsedCount: parsed.length,
      firstParsed: parsed.slice(0, 5).map((r) => r.text),
      windows,
    };
  }

  // Mode A: resolve a query to a place (single Scrapingdog call). Also report a
  // battery of place-id pattern matches so we can tune extractPlaceFromHtml.
  const query = opts.q || "";
  const searchUrl =
    "https://m.search.naver.com/search.naver?query=" + encodeURIComponent(query);
  const search = await sdGet(searchUrl, true, 50000);
  const body = search.body;
  const patterns: Record<string, string> = {
    mPlace: "(?:m\\.place|pcmap\\.place|place)\\.naver\\.com/([a-z]+)/(\\d{6,})",
    restaurantPath: "/(restaurant|place|hairshop|hospital|accommodation|attraction)/(\\d{6,})",
    jsonId: '"id"\\s*:\\s*"?(\\d{7,})"?',
    placeId: '"(?:placeId|entryId|sid)"\\s*:\\s*"?(\\d{6,})"?',
    encoded: "place\\.naver\\.com%2F",
  };
  const matches: Record<string, { count: number; first: string; sample: string }> = {};
  for (const [name, src] of Object.entries(patterns)) {
    const re = new RegExp(src, "gi");
    const all = [...body.matchAll(re)];
    if (all.length) {
      const at = all[0].index ?? 0;
      matches[name] = {
        count: all.length,
        first: all[0][0],
        sample: body.slice(Math.max(0, at - 150), at + 250),
      };
    }
  }
  return {
    hasKey: true,
    query,
    search: { ok: search.ok, status: search.status, bodyLength: body.length },
    place: search.ok ? extractPlaceFromHtml(body, query) : null,
    matches,
  };
}

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

async function naverViaWorker(query: string): Promise<CollectResult> {
  const base = config.naver.workerUrl.replace(/\/$/, "");
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
      55000,
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
    const placeId = data.place?.placeId ?? "";
    const reviews: UnifiedReview[] = (data.reviews ?? [])
      .map((r, i) => ({
        platform: "naver" as const,
        placeId,
        reviewId: String(r.reviewId ?? `${placeId}:${i}`),
        author: anonymizeAuthor(r.author),
        rating: null,
        text: String(r.text ?? ""),
        createdAt: toIsoDate(r.createdAt),
        source: "scrape" as const,
      }))
      .filter((r) => r.text.trim());
    if (data.error && reviews.length === 0) {
      return {
        platform: "naver",
        place: null,
        reviews: [],
        ok: false,
        error: data.error,
        errorCode: "NO_MATCH",
      };
    }
    return {
      platform: "naver",
      place: data.place?.placeId
        ? {
            platform: "naver",
            placeId,
            name: data.place.name ?? query,
            url: data.place.url ?? `https://m.place.naver.com/place/${placeId}/home`,
            reviewCount: reviews.length,
          }
        : null,
      reviews,
      ok: true,
    };
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

/* ── Apify: Naver Place visitor reviews (primary) ─────────
 * Naver has no official review API and blocks datacenter IPs. The stable path
 * is the Apify "Naver Place Reviews" actor: given a keyword it resolves the
 * place and returns visitor reviews. We call it synchronously (≈11s) and map
 * the dataset items to our review shape. $1 / 1,000 results. */
const APIFY_ACTOR = "huggable_quote~naver-place-reviews-scraper";

interface ApifyReviewItem {
  placeName?: string;
  reviewText?: string;
  reviewRating?: number | null;
  reviewerName?: string;
  reviewDate?: string;
  visitCount?: string;
  placeCategory?: string;
}

// Naver review dates arrive as "2026-07-07" or "25.12.16.화" / "25.8.1.금".
function normalizeNaverDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (m) return `20${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return toIsoDate(t) ?? t;
}

async function naverViaApify(query: string): Promise<CollectResult> {
  const token = config.naver.apifyToken;
  if (!token) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: "APIFY_TOKEN 이 설정되지 않았습니다.",
      errorCode: "MISSING_KEY",
    };
  }
  // maxPlacesPerKeyword: 1 → only the top-matching place (no other stores).
  // includeBlogReviews: false → we only want the place's visitor reviews, not
  // external blog posts.
  // maxItems=100 caps the collection at 100 newest reviews (≈$0.10,
  // pay-per-result) so the free $5/mo lasts ~50 collections. reviewSort NEWEST
  // → most recent first. The run timeout returns partial results if a big place
  // would take longer than the function budget.
  const input = {
    searchKeywords: [query],
    maxPlacesPerKeyword: 1,
    maxReviewPages: 10,
    reviewSort: "NEWEST",
    includeBlogReviews: false,
    includeReviewPhotos: false,
    includeReviewStats: false,
  };
  const url =
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=55&maxItems=100`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
    58000,
  );
  if (!res.ok) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: `네이버 리뷰 수집 오류 (${res.status})`,
      errorCode: "UPSTREAM_ERROR",
    };
  }
  const items = (await res.json()) as ApifyReviewItem[];
  const reviews: UnifiedReview[] = [];
  const seen = new Set<string>();
  let placeName = query;
  for (const it of Array.isArray(items) ? items : []) {
    const text = String(it.reviewText ?? "").trim();
    if (!text) continue;
    if (it.placeName) placeName = it.placeName;
    const key = text.slice(0, 40) + "|" + (it.reviewerName ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    reviews.push({
      platform: "naver",
      placeId: query,
      reviewId: `n:${reviews.length}`,
      author: anonymizeAuthor(it.reviewerName),
      rating: typeof it.reviewRating === "number" ? it.reviewRating : null,
      text,
      createdAt: normalizeNaverDate(it.reviewDate),
      source: "scrape",
    });
  }
  if (reviews.length === 0) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: "네이버 리뷰를 찾지 못했습니다.",
      errorCode: "NO_MATCH",
    };
  }
  return {
    platform: "naver",
    place: {
      platform: "naver",
      placeId: query,
      name: placeName,
      reviewCount: reviews.length,
    },
    reviews,
    ok: true,
  };
}

export async function naverCollect(
  query: string,
  _place?: PlaceSearchResult,
): Promise<CollectResult> {
  if (config.naver.apifyToken) return naverViaApify(query);
  if (config.naver.scrapingKey) return naverViaScrapingApi(query);
  if (config.naver.workerUrl) return naverViaWorker(query);
  return {
    platform: "naver",
    place: null,
    reviews: [],
    ok: false,
    error: "네이버맵 수집이 설정되지 않았습니다 (APIFY_TOKEN 필요).",
    errorCode: "SCRAPER_DISABLED",
  };
}

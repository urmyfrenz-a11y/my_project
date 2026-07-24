import { config } from "../config";
import type { CollectResult, PlaceSearchResult, UnifiedReview } from "../types";
import { anonymizeAuthor, toIsoDate } from "../util";

// Naver Place has NO public review API. The reliable path (per our design):
//   1. Launch a real browser (Playwright).
//   2. Resolve the query -> place id via Naver's internal search.
//   3. Open the visitor-review page and INTERCEPT the pcmap-api GraphQL
//      responses instead of scraping obfuscated DOM classes (which rename
//      themselves and break constantly).
//
// Playwright is imported dynamically so the Next.js app still builds & deploys
// (e.g. on Vercel serverless) even when Playwright isn't installed there.
// Run the collector on a dedicated worker with NAVER_SCRAPER_ENABLED=true.

const GRAPHQL_HOST = "pcmap-api.place.naver.com";

/** Duck-typing helper: does this object look like a Naver visitor review? */
function looksLikeReview(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  return (
    ("body" in r || "reviewBody" in r || "contents" in r) &&
    ("author" in r || "authorId" in r || "nickname" in r || "created" in r)
  );
}

/** Recursively walk any GraphQL payload and pull out review-shaped nodes. */
function harvestReviews(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const item of node) harvestReviews(item, out);
    return;
  }
  if (node && typeof node === "object") {
    if (looksLikeReview(node)) out.push(node as Record<string, unknown>);
    for (const v of Object.values(node as Record<string, unknown>)) {
      harvestReviews(v, out);
    }
  }
}

function mapReview(
  raw: Record<string, unknown>,
  placeId: string,
  idx: number,
): UnifiedReview {
  const author =
    (raw.nickname as string) ??
    ((raw.author as { nickname?: string })?.nickname ?? undefined);
  const text =
    (raw.body as string) ??
    (raw.reviewBody as string) ??
    (raw.contents as string) ??
    "";
  const created =
    (raw.created as string) ??
    (raw.visited as string) ??
    (raw.date as string) ??
    undefined;
  return {
    platform: "naver",
    placeId,
    reviewId: String(raw.id ?? raw.reviewId ?? `${placeId}:${idx}`),
    author: anonymizeAuthor(author),
    // Naver visitor reviews are keyword-based, not star-based -> null rating.
    rating: null,
    text: String(text),
    createdAt: toIsoDate(created),
    source: "scrape",
  };
}

export async function naverCollect(query: string): Promise<CollectResult> {
  if (!config.naver.enabled) {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error:
        "네이버 스크래퍼가 비활성화됨 (NAVER_SCRAPER_ENABLED=true 필요, Playwright 워커에서 실행).",
      errorCode: "SCRAPER_DISABLED",
    };
  }

  // Playwright is installed ONLY on the scraper worker, never on Vercel.
  // A non-literal specifier keeps it out of the build graph so the bundler
  // doesn't try to resolve/ship it; at runtime it's found on the worker.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;
  try {
    const spec = "playwright";
    ({ chromium } = await import(spec));
  } catch {
    return {
      platform: "naver",
      place: null,
      reviews: [],
      ok: false,
      error: "playwright 미설치. `npm i playwright` 후 워커에서 실행하세요.",
      errorCode: "SCRAPER_DISABLED",
    };
  }

  const browser = await chromium.launch({
    headless: true,
    ...(config.naver.chromiumPath
      ? { executablePath: config.naver.chromiumPath }
      : {}),
  });

  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile Safari/604.1",
      locale: "ko-KR",
      viewport: { width: 414, height: 896 },
    });
    const page = await ctx.newPage();

    // --- Step 1: resolve place id via internal search -------------------
    const searchResp = await page.goto(
      `https://m.place.naver.com/place/list?query=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded", timeout: 20000 },
    );
    // The list page redirects straight to a place when there's a single hit.
    let placeId = "";
    let placeName = query;
    const finalUrl = page.url();
    const m = finalUrl.match(/place\/(\d+)/) ?? finalUrl.match(/(\d{6,})/);
    if (m) placeId = m[1];

    if (!placeId) {
      // Fall back to reading the first result link on the list page.
      const href = await page
        .locator('a[href*="/place/"]')
        .first()
        .getAttribute("href")
        .catch(() => null);
      const mm = href?.match(/place\/(\d+)/);
      if (mm) placeId = mm[1];
    }
    void searchResp;

    if (!placeId) {
      return {
        platform: "naver",
        place: null,
        reviews: [],
        ok: false,
        error: "네이버에서 장소를 찾지 못했습니다.",
        errorCode: "NO_MATCH",
      };
    }

    // --- Step 2: intercept GraphQL on the visitor-review page -----------
    const harvested: Record<string, unknown>[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on("response", async (resp: any) => {
      try {
        const url = resp.url();
        if (!url.includes(GRAPHQL_HOST) || !url.includes("graphql")) return;
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("application/json")) return;
        const json = await resp.json();
        harvestReviews(json, harvested);
      } catch {
        /* ignore non-JSON / aborted responses */
      }
    });

    await page.goto(
      `https://m.place.naver.com/place/${placeId}/review/visitor`,
      { waitUntil: "networkidle", timeout: 25000 },
    );
    // Grab the visible place name if present.
    placeName =
      (await page.locator("h2, .place_name, #_title").first().textContent().catch(() => null))?.trim() ||
      placeName;

    // --- Step 3: scroll to lazy-load more reviews -----------------------
    const target = config.naver.maxReviews;
    let stableRounds = 0;
    for (let i = 0; i < 25 && harvested.length < target && stableRounds < 3; i++) {
      const before = harvested.length;
      await page.mouse.wheel(0, 4000);
      // Also try a "더보기" button if present.
      await page
        .getByRole("button", { name: /더보기|더 보기/ })
        .click({ timeout: 1200 })
        .catch(() => {});
      await page.waitForTimeout(900);
      stableRounds = harvested.length === before ? stableRounds + 1 : 0;
    }

    // --- Step 4: normalize + de-dupe ------------------------------------
    const seen = new Set<string>();
    const reviews: UnifiedReview[] = [];
    harvested.forEach((raw, idx) => {
      const r = mapReview(raw, placeId, idx);
      if (!r.text.trim()) return;
      const key = r.reviewId + "|" + r.text.slice(0, 24);
      if (seen.has(key)) return;
      seen.add(key);
      reviews.push(r);
    });

    const place: PlaceSearchResult = {
      platform: "naver",
      placeId,
      name: placeName,
      url: `https://m.place.naver.com/place/${placeId}/home`,
      reviewCount: reviews.length,
    };

    return {
      platform: "naver",
      place,
      reviews: reviews.slice(0, target),
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
  } finally {
    await browser.close().catch(() => {});
  }
}

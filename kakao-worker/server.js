// Kakao Map review worker.
// Kakao's panel API (place-api.map.kakao.com/places/panel3/{id}) only returns
// ~7 reviews. To collect 100+ we open the real place page in a headless
// browser (Playwright), scroll the review tab, and harvest every review object
// that flies by on the place-api.map.kakao.com responses.
//
// Unlike Naver, Kakao does NOT block datacenter IPs, so this runs fine on
// Render/Railway free tiers.
//
//   POST /collect   { "placeId": "12345" }   ->   { placeId, reviews }
//   POST /collect   { "query":   "가게명" }    ->   (needs KAKAO_REST_API_KEY)
//   GET  /health    -> { ok: true }
//
// Set WORKER_TOKEN to require an x-worker-token header (recommended).

import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.WORKER_TOKEN || "";
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY || "";
const MAX_REVIEWS = Number(process.env.KAKAO_MAX_REVIEWS || "120");
const API_HOST = "place-api.map.kakao.com";

/** A Kakao review object has body text plus at least one review-ish field. */
function looksLikeReview(o) {
  if (!o || typeof o !== "object") return false;
  const hasBody =
    (typeof o.contents === "string" && o.contents.trim()) ||
    (typeof o.title === "string" && o.title.trim());
  if (!hasBody) return false;
  return (
    "star_rating" in o ||
    "review_id" in o ||
    "confirm_id" in o ||
    "registered_at" in o
  );
}

function harvest(node, out) {
  if (Array.isArray(node)) {
    for (const it of node) harvest(it, out);
    return;
  }
  if (node && typeof node === "object") {
    if (looksLikeReview(node)) out.push(node);
    for (const v of Object.values(node)) harvest(v, out);
  }
}

function pick(raw, placeId, idx) {
  const isBlog = !("star_rating" in raw) && typeof raw.title === "string";
  const text = [raw.title, raw.contents]
    .filter((s) => typeof s === "string" && s.trim())
    .join(" — ");
  const author = isBlog
    ? "블로그"
    : raw?.meta?.owner?.nickname ?? raw?.nickname ?? undefined;
  return {
    reviewId: String(
      (isBlog ? "blog:" : "") + (raw.review_id ?? raw.confirm_id ?? `${placeId}:${idx}`),
    ),
    author,
    rating: typeof raw.star_rating === "number" ? raw.star_rating : null,
    text,
    createdAt: raw.registered_at ?? undefined,
    likeCount: typeof raw.like_count === "number" ? raw.like_count : undefined,
  };
}

/** Resolve a query -> placeId via the official Local REST API (optional). */
async function resolvePlaceId(query) {
  if (!KAKAO_REST_API_KEY) return null;
  const url =
    "https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.documents?.[0]?.id ?? null;
}

async function scrapeKakao(placeId) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
    ],
  });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      locale: "ko-KR",
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { pf: "web" },
    });
    const page = await ctx.newPage();

    const harvested = [];
    page.on("response", async (resp) => {
      try {
        if (!resp.url().includes(API_HOST)) return;
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        harvest(await resp.json(), harvested);
      } catch {
        /* ignore non-JSON / aborted */
      }
    });

    // The place page is an SPA; its review section fires the place-api calls
    // we intercept above.
    await page.goto(`https://place.map.kakao.com/${placeId}`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await page.waitForTimeout(2500);

    // Try to focus the review tab so the review list mounts.
    for (const name of [/후기/, /리뷰/]) {
      await page
        .getByRole("tab", { name })
        .first()
        .click({ timeout: 1500 })
        .catch(() => {});
      await page
        .getByRole("link", { name })
        .first()
        .click({ timeout: 1500 })
        .catch(() => {});
    }
    await page.waitForTimeout(1500);

    // Scroll + "더보기" until the harvest stops growing or we hit the cap.
    let stable = 0;
    for (let i = 0; i < 40 && harvested.length < MAX_REVIEWS && stable < 4; i++) {
      const before = harvested.length;
      await page.mouse.wheel(0, 6000).catch(() => {});
      for (const name of [/후기 더보기/, /더보기/, /더 보기/]) {
        await page
          .getByRole("button", { name })
          .first()
          .click({ timeout: 500 })
          .catch(() => {});
      }
      await page.waitForTimeout(900);
      stable = harvested.length === before ? stable + 1 : 0;
    }

    // Normalize + de-dupe.
    const seen = new Set();
    const reviews = [];
    harvested.forEach((raw, idx) => {
      const r = pick(raw, placeId, idx);
      if (!r.text.trim()) return;
      const key = r.reviewId + "|" + r.text.slice(0, 24);
      if (seen.has(key)) return;
      seen.add(key);
      reviews.push(r);
    });

    return { placeId: String(placeId), reviews: reviews.slice(0, MAX_REVIEWS) };
  } finally {
    await browser.close().catch(() => {});
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/collect", async (req, res) => {
  if (TOKEN && req.get("x-worker-token") !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  let placeId = String(req.body?.placeId || "").trim();
  const query = String(req.body?.query || "").trim();
  try {
    if (!placeId && query) placeId = String((await resolvePlaceId(query)) || "");
    if (!placeId) {
      return res
        .status(400)
        .json({ error: "placeId required (or query + KAKAO_REST_API_KEY)" });
    }
    const out = await scrapeKakao(placeId);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`kakao worker listening on :${PORT}`));

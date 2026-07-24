// Naver Place review worker.
// Runs a real headless browser (Playwright) — which Vercel serverless can't —
// and exposes a tiny HTTP API the Vercel app calls. Deploy on Render/Railway.
//
//   POST /collect   { "query": "가게 이름" }   ->   { place, reviews }
//   GET  /health    -> { ok: true }
//
// Set WORKER_TOKEN to require an x-worker-token header (recommended).

import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.WORKER_TOKEN || "";
const MAX_REVIEWS = Number(process.env.NAVER_MAX_REVIEWS || "40");
const GRAPHQL_HOST = "pcmap-api.place.naver.com";

function looksLikeReview(o) {
  if (!o || typeof o !== "object") return false;
  return (
    ("body" in o || "reviewBody" in o || "contents" in o) &&
    ("author" in o || "authorId" in o || "nickname" in o || "created" in o)
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
  const author = raw.nickname ?? raw.author?.nickname ?? undefined;
  const text = raw.body ?? raw.reviewBody ?? raw.contents ?? "";
  const created = raw.created ?? raw.visited ?? raw.date ?? undefined;
  return {
    reviewId: String(raw.id ?? raw.reviewId ?? `${placeId}:${idx}`),
    author,
    text: String(text),
    createdAt: created,
  };
}

async function scrapeNaver(query) {
  // Container/low-memory friendly flags so this survives free tiers (512MB).
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
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile Safari/604.1",
      locale: "ko-KR",
      viewport: { width: 414, height: 896 },
    });
    const page = await ctx.newPage();

    // 1) resolve place id — try Naver's search API first (the SPA list page
    //    stalls at "로딩중" from datacenter IPs), then fall back to DOM.
    let placeId = "";
    let placeName = query;
    let diag = "";

    // Warm up cookies/context first.
    await page
      .goto("https://m.place.naver.com/", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      .catch(() => {});
    try {
      const apiUrl = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(
        query,
      )}&type=all&searchCoord=&boundary=`;
      const api = await page.request.get(apiUrl, {
        headers: { Referer: "https://map.naver.com/", Accept: "application/json" },
      });
      diag = `allSearch=${api.status()}`;
      if (api.ok()) {
        const j = await api.json();
        const list = j?.result?.place?.list;
        const first = Array.isArray(list) ? list[0] : null;
        if (first?.id) {
          placeId = String(first.id);
          placeName = first.name || query;
        } else {
          diag += ` keys=[${Object.keys(j || {}).join(",")}] rkeys=[${Object.keys(
            j?.result || {},
          ).join(",")}] snip=${JSON.stringify(j).slice(0, 500)}`;
        }
      }
    } catch (e) {
      diag = `allSearch-err=${String(e).slice(0, 100)}`;
    }

    // Fallback: SPA list page.
    if (!placeId) {
      await page
        .goto(
          `https://m.place.naver.com/place/list?query=${encodeURIComponent(query)}`,
          { waitUntil: "domcontentloaded", timeout: 20000 },
        )
        .catch(() => {});
      const m = page.url().match(/place\/(\d+)/);
      if (m) placeId = m[1];
      if (!placeId) {
        await page
          .waitForSelector('a[href*="/place/"]', { timeout: 9000 })
          .catch(() => {});
        const href = await page
          .locator('a[href*="/place/"]')
          .first()
          .getAttribute("href")
          .catch(() => null);
        const mm = href?.match(/place\/(\d+)/);
        if (mm) placeId = mm[1];
      }
    }

    if (!placeId) {
      const bodyText = (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .slice(0, 300);
      return {
        place: null,
        reviews: [],
        error: `장소를 찾지 못했습니다. | ${diag} | url=${page.url()} | body=${bodyText}`,
      };
    }

    // 2) intercept GraphQL review responses
    const harvested = [];
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (!url.includes(GRAPHQL_HOST) || !url.includes("graphql")) return;
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("application/json")) return;
        harvest(await resp.json(), harvested);
      } catch {
        /* ignore */
      }
    });

    // domcontentloaded + a short settle is much faster than networkidle,
    // which rarely settles on Naver (continuous background requests).
    await page.goto(
      `https://m.place.naver.com/place/${placeId}/review/visitor`,
      { waitUntil: "domcontentloaded", timeout: 20000 },
    );
    await page.waitForTimeout(2500);
    placeName =
      (
        await page
          .locator("h2, .place_name, #_title")
          .first()
          .textContent()
          .catch(() => null)
      )?.trim() || placeName;

    // 3) scroll to lazy-load more (kept short so we stay well under the
    //    caller's timeout; free-tier CPU is slow).
    let stable = 0;
    for (let i = 0; i < 8 && harvested.length < MAX_REVIEWS && stable < 2; i++) {
      const before = harvested.length;
      await page.mouse.wheel(0, 5000);
      await page
        .getByRole("button", { name: /더보기|더 보기/ })
        .click({ timeout: 500 })
        .catch(() => {});
      await page.waitForTimeout(700);
      stable = harvested.length === before ? stable + 1 : 0;
    }

    // 4) normalize + de-dupe
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

    return {
      place: {
        placeId,
        name: placeName,
        url: `https://m.place.naver.com/place/${placeId}/home`,
      },
      reviews: reviews.slice(0, MAX_REVIEWS),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/collect", async (req, res) => {
  if (TOKEN && req.get("x-worker-token") !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const query = (req.body?.query || "").trim();
  if (!query) return res.status(400).json({ error: "query required" });
  try {
    const out = await scrapeNaver(query);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`naver worker listening on :${PORT}`));

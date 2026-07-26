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

// Give the scrape a hard budget so we return partial results before the
// caller (Vercel, 55s) gives up — free Render CPU is slow.
const TIME_BUDGET_MS = Number(process.env.KAKAO_TIME_BUDGET_MS || "42000");

async function scrapeKakao(placeId) {
  const start = Date.now();
  const elapsed = () => Date.now() - start;
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
  const apiLog = [];
  let pageUrl = "";
  let pageTitle = "";
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
    const hosts = new Set();
    // Watch ALL JSON responses (any host) + any review/api-looking URL, so we
    // can discover where the review data actually comes from.
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        const ct = resp.headers()["content-type"] ?? "";
        const isJson = ct.includes("json");
        const interesting =
          isJson || /review|comment|panel|api|graphql|place/i.test(url);
        if (!interesting) return;
        try {
          hosts.add(new URL(url).host);
        } catch {}
        let n = 0;
        if (isJson) {
          const json = await resp.json();
          const before = harvested.length;
          harvest(json, harvested);
          n = harvested.length - before;
        }
        apiLog.push({
          status: resp.status(),
          n,
          ct: ct.slice(0, 30),
          url: url.slice(0, 200),
        });
        if (n > 0)
          console.log(`[api] +${n} (total ${harvested.length}) ${url.slice(0, 160)}`);
      } catch {
        /* ignore non-JSON / aborted */
      }
    });

    // Load the standalone place detail page — this renders the place info +
    // review tabs (the bare map viewer at map.kakao.com/?itemId= never mounts
    // the review panel, which is why the old target harvested nothing).
    const target =
      process.env.KAKAO_URL_TEMPLATE?.replace("{id}", placeId) ||
      `https://place.map.kakao.com/${placeId}`;
    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(6000);
    pageUrl = page.url();
    pageTitle = (await page.title().catch(() => "")) || "";
    const bodyLen = await page
      .evaluate(() => document.body?.innerText?.length ?? 0)
      .catch(() => 0);
    console.log(`[nav] placeId=${placeId} url=${pageUrl} title="${pageTitle}" bodyLen=${bodyLen} harvested=${harvested.length}`);

    // Try to focus the review tab so the review list mounts.
    for (const name of [/후기/, /리뷰/, /블로그/]) {
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

    // Scroll + "더보기" until the harvest stops growing, we hit the cap, or we
    // run out of time budget.
    let stable = 0;
    for (
      let i = 0;
      i < 60 &&
      harvested.length < MAX_REVIEWS &&
      stable < 5 &&
      elapsed() < TIME_BUDGET_MS;
      i++
    ) {
      const before = harvested.length;
      await page.mouse.wheel(0, 6000).catch(() => {});
      for (const name of [/후기 더보기/, /더보기/, /더 보기/, /리뷰 더보기/]) {
        await page
          .getByRole("button", { name })
          .first()
          .click({ timeout: 500 })
          .catch(() => {});
      }
      await page.waitForTimeout(900);
      stable = harvested.length === before ? stable + 1 : 0;
    }

    // Direct API probe from *inside* the browser (same-origin cookies + pf:web
    // header). The place page shows only a ~7 summary; the full review list
    // lives behind a paginated API. Probe candidate endpoints, harvest any that
    // return review-like objects, and report a summary in /debug so we can see
    // which endpoint (if any) serves more than 7.
    let apiProbe = [];
    try {
      apiProbe = await page.evaluate(async (id) => {
        const urls = [
          `https://place-api.map.kakao.com/places/panel3/${id}`,
          `https://place-api.map.kakao.com/places/panel3/${id}?page=2`,
          `https://place-api.map.kakao.com/places/panel3/${id}?page=1&size=100`,
          `https://place-api.map.kakao.com/places/main/v/${id}`,
          `https://place-api.map.kakao.com/places/${id}/comments`,
          `https://place-api.map.kakao.com/places/${id}/reviews`,
          `https://place-api.map.kakao.com/places/${id}/kakaomap_reviews`,
          `https://place.map.kakao.com/commentlist/v/${id}`,
          `https://place.map.kakao.com/commentlist/v/${id}/0`,
        ];
        const out = [];
        for (const u of urls) {
          try {
            const r = await fetch(u, {
              headers: { pf: "web", Accept: "application/json" },
            });
            const t = await r.text();
            out.push({ u, status: r.status, len: t.length, body: t.slice(0, 120000) });
          } catch (e) {
            out.push({ u, err: String((e && e.message) || e) });
          }
        }
        return out;
      }, placeId);
    } catch {
      /* probe failed entirely */
    }
    const probeSummary = [];
    for (const p of apiProbe) {
      let reviewObjs = 0;
      if (p.body) {
        try {
          const before = harvested.length;
          harvest(JSON.parse(p.body), harvested);
          reviewObjs = harvested.length - before;
        } catch {
          /* not json */
        }
      }
      probeSummary.push({
        url: p.u,
        status: p.status,
        len: p.len,
        reviewObjs,
        err: p.err,
      });
    }

    // Some Kakao pages ship data server-side (in the HTML) instead of via XHR.
    // Harvest from embedded JSON blobs too.
    let embedded = { nextData: 0, inlineBlobs: 0, keys: [] };
    try {
      const blobs = await page.evaluate(() => {
        const res = { nextData: null, blobs: [], keys: [] };
        const nd = document.getElementById("__NEXT_DATA__");
        if (nd && nd.textContent) res.nextData = nd.textContent;
        // Any inline <script> containing a big JSON-ish object with review words
        for (const s of Array.from(document.scripts)) {
          const t = s.textContent || "";
          if (t.length > 500 && /review|contents|star_rating|blog/i.test(t)) {
            res.blobs.push(t.slice(0, 200000));
          }
        }
        try {
          if (window.__PLACE__ || window.__APP__ || window.__INITIAL_STATE__)
            res.keys = Object.keys(window);
        } catch {}
        return res;
      });
      if (blobs.nextData) {
        try {
          const before = harvested.length;
          harvest(JSON.parse(blobs.nextData), harvested);
          embedded.nextData = harvested.length - before;
        } catch {}
      }
      for (const b of blobs.blobs || []) {
        embedded.inlineBlobs += 1;
        const m = b.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            harvest(JSON.parse(m[0]), harvested);
          } catch {}
        }
      }
    } catch {}

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

    console.log(
      `[done] placeId=${placeId} harvested=${harvested.length} unique=${reviews.length} apiCalls=${apiLog.length} elapsed=${elapsed()}ms`,
    );

    return {
      placeId: String(placeId),
      reviews: reviews.slice(0, MAX_REVIEWS),
      debug: {
        elapsedMs: elapsed(),
        pageUrl,
        pageTitle,
        harvested: harvested.length,
        uniqueReviews: reviews.length,
        apiCalls: apiLog.length,
        bodyLen,
        jsonHosts: Array.from(hosts),
        embedded,
        apiProbe: probeSummary,
        apiLog: apiLog.slice(0, 60),
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// Diagnostic: open in a browser (no token) to see exactly what the worker
// harvests for a placeId — which APIs fire, counts, timing, sample reviews.
//   /debug?placeId=23985599
app.get("/debug", async (req, res) => {
  const placeId = String(req.query.placeId || "").trim();
  if (!placeId) return res.status(400).json({ error: "placeId query required" });
  try {
    const out = await scrapeKakao(placeId);
    res.json({
      placeId: out.placeId,
      reviewsCount: out.reviews.length,
      sample: out.reviews.slice(0, 3),
      debug: out.debug,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

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

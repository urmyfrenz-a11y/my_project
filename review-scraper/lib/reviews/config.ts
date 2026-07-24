/** Centralized env access so adapters never read process.env directly. */
export const config = {
  // "인터넷 검색" source. Bing/DuckDuckGo scraping is blocked from Vercel's
  // datacenter IPs, so we use Naver's official Search Open API (free 25,000
  // calls/day, no overage billing, no bot-detection). Register a free app at
  // https://developers.naver.com/apps and set these two vars. Without them the
  // source shows "준비중".
  naverSearch: {
    clientId: process.env.NAVER_SEARCH_CLIENT_ID ?? "",
    clientSecret: process.env.NAVER_SEARCH_CLIENT_SECRET ?? "",
  },
  kakao: {
    restKey: process.env.KAKAO_REST_API_KEY ?? "",
    // Optional Playwright worker (see /kakao-worker). Kakao's panel API only
    // returns ~7 reviews; a real browser scrolls the review tab and rides the
    // paginated endpoint to collect 100+. Kakao does NOT block datacenter IPs,
    // so this runs reliably on Render's free tier. Without it we fall back to
    // the ~7-review panel payload.
    workerUrl: process.env.KAKAO_WORKER_URL ?? "",
    workerToken: process.env.KAKAO_WORKER_TOKEN ?? "",
  },
  naver: {
    // Naver needs a real browser, which can't run on Vercel serverless.
    // A dedicated Playwright worker (see /naver-worker) does the scraping and
    // this app calls it over HTTP. Set NAVER_WORKER_URL to enable Naver.
    workerUrl: process.env.NAVER_WORKER_URL ?? "",
    workerToken: process.env.NAVER_WORKER_TOKEN ?? "",
  },
} as const;

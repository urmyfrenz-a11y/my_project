/** Centralized env access so adapters never read process.env directly. */
export const config = {
  google: {
    // "구글 검색" source. Google blocks datacenter-IP scraping, so we use a
    // free third-party SERP API (Serper.dev). Optional — without it the
    // Google Search source shows "준비중".
    serperKey: process.env.SERPER_API_KEY ?? "",
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

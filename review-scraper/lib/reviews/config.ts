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
  },
  naver: {
    // Naver needs a real browser, which can't run on Vercel serverless.
    // A dedicated Playwright worker (see /naver-worker) does the scraping and
    // this app calls it over HTTP. Set NAVER_WORKER_URL to enable Naver.
    workerUrl: process.env.NAVER_WORKER_URL ?? "",
    workerToken: process.env.NAVER_WORKER_TOKEN ?? "",
  },
} as const;

// Scrapingdog 경유로 네이버 플레이스 페이지를 "한국 residential IP + JS 렌더링"
// 으로 받아온다. (Vercel 서버는 데이터센터 IP라 네이버가 캡차로 차단하기 때문)

const SD = "https://api.scrapingdog.com/scrape";

export function hasKey(): boolean {
  return !!process.env.SCRAPINGDOG_API_KEY;
}

function sdUrl(target: string, dynamic: boolean): string {
  const params = new URLSearchParams({
    api_key: process.env.SCRAPINGDOG_API_KEY ?? "",
    url: target,
    country: "kr",
    premium: "true",
  });
  if (dynamic) params.set("dynamic", "true");
  return `${SD}?${params.toString()}`;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Scrapingdog 로 대상 URL을 렌더링해 HTML 반환 */
export async function renderNaver(
  target: string,
  dynamic = true,
  timeoutMs = 55000,
): Promise<{ ok: boolean; status: number; body: string }> {
  return fetchWithTimeout(sdUrl(target, dynamic), timeoutMs);
}

/**
 * naver.me 단축링크를 실제 플레이스 URL로 해석.
 * Scrapingdog 로 열어 최종 렌더된 HTML에서 place 링크/og:url 을 뽑는다.
 */
export async function resolveShortLink(shortUrl: string): Promise<string | null> {
  const { ok, body } = await renderNaver(shortUrl, true, 45000);
  if (!ok) return null;
  const patterns = [
    /(?:m\.place|pcmap\.place|place)\.naver\.com\/[a-z]+\/\d{6,}/i,
    /map\.naver\.com\/[^"'\s]*place\/\d{6,}/i,
    /"(?:placeId|entryId)"\s*:\s*"?(\d{7,})/i,
  ];
  for (const re of patterns) {
    const m = re.exec(body);
    if (m) return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
  }
  // og:url 폴백
  const og = /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i.exec(body);
  if (og && /naver\.com/.test(og[1])) return og[1];
  return null;
}

/** HTML 안에 네이버 봇 차단(캡차) 흔적이 있는지 */
export function looksBlocked(html: string): boolean {
  return (
    /ncaptcha|captcha|비정상적인 접근|자동입력 방지|robot/i.test(html) &&
    !/__APOLLO_STATE__/.test(html)
  );
}

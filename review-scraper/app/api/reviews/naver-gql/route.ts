import { NextResponse } from "next/server";
import { ProxyAgent, fetch as uFetch } from "undici";
import { config } from "@/lib/reviews/config";

// Temporary R&D endpoint: drive a request to any target THROUGH Scrapingdog's
// proxy mode (which — unlike the GET-only scrape API — forwards POST too), so we
// can reverse-engineer Naver's protected review GraphQL from a Korean
// residential IP. Everything is URL-param driven so we can iterate the proxy
// syntax and the GraphQL request WITHOUT redeploying.
//
// Examples:
//   /api/reviews/naver-gql?target=https://ipinfo.io/json            (check exit IP)
//   /api/reviews/naver-gql?puser=scrapingdog&ppass={key}&target=...
//   /api/reviews/naver-gql?gql=1&id=11684139&type=restaurant&page=1&size=20
export const runtime = "nodejs";
export const maxDuration = 60;

function buildProxy(sp: URLSearchParams, key: string): { uri: string; token: string; user: string } {
  const host = sp.get("phost") || "proxy.scrapingdog.com";
  const port = sp.get("pport") || "8081";
  // Templates let us try different Scrapingdog option encodings via URL params;
  // "{key}" is replaced server-side (never echoed back).
  const userT = sp.get("puser") || "scrapingdog";
  const passT = sp.get("ppass") || "{key}";
  const user = userT.replace(/\{key\}/g, key);
  const pass = passT.replace(/\{key\}/g, key);
  // undici ProxyAgent does NOT read auth from the URI userinfo — it needs an
  // explicit Proxy-Authorization token. Build Basic auth ourselves.
  const token = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  return { uri: `http://${host}:${port}`, token, user };
}

// The full getVisitorReviews document is version-specific; keep a candidate here
// and refine it against real responses. Field set kept small on purpose.
const GQL_QUERY = `query getVisitorReviews($input: VisitorReviewsInput) {
  visitorReviews(input: $input) {
    items {
      id
      rating
      author { nickname }
      body
      created
      visited
    }
    total
  }
}`;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const key = config.naver.scrapingKey;
  if (!key) return NextResponse.json({ error: "no scraping key" }, { status: 500 });

  const to = Number(sp.get("to") || "15000");
  const proxy = buildProxy(sp, key);
  const dispatcher = new ProxyAgent({
    uri: proxy.uri,
    token: proxy.token,
    connectTimeout: to,
    headersTimeout: to,
    bodyTimeout: to,
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), to);

  let target: string;
  let method = (sp.get("method") || "GET").toUpperCase();
  let body: string | undefined;
  const headers: Record<string, string> = {
    "user-agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile Safari/604.1",
    "accept-language": "ko-KR,ko;q=0.9",
  };

  if (sp.get("gql") === "1") {
    // Build the Naver visitor-review GraphQL POST.
    const id = sp.get("id") || "";
    const type = sp.get("type") || "restaurant";
    const page = Number(sp.get("page") || "1");
    const size = Number(sp.get("size") || "20");
    target =
      sp.get("target") || "https://pcmap-api.place.naver.com/graphql";
    method = "POST";
    headers["content-type"] = "application/json";
    headers["referer"] = `https://pcmap.place.naver.com/${type}/${id}/review/visitor`;
    headers["origin"] = "https://pcmap.place.naver.com";
    body = JSON.stringify([
      {
        operationName: "getVisitorReviews",
        variables: {
          input: {
            businessId: id,
            businessType: type,
            item: "0",
            bookingBusinessId: null,
            page,
            size,
            isPhotoUsed: false,
            includeContent: true,
            getUserStats: true,
            includeReceiptPhotos: true,
            cidList: [],
            getReactions: true,
            getTrailer: true,
            sort: "recent",
          },
        },
        query: GQL_QUERY,
      },
    ]);
  } else {
    target = sp.get("target") || "https://ipinfo.io/json";
  }

  const t0 = Date.now();
  try {
    const res = await uFetch(target, {
      method,
      headers,
      body,
      dispatcher,
      signal: ac.signal,
    });
    const text = await res.text();
    clearTimeout(timer);
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      target,
      method,
      proxyHost: proxy.uri,
      proxyUser: proxy.user,
      len: text.length,
      sample: text.slice(0, 3000),
    });
  } catch (e) {
    clearTimeout(timer);
    return NextResponse.json({
      error: String(e instanceof Error ? `${e.name}: ${e.message}` : e),
      cause: (e as { cause?: unknown })?.cause
        ? String((e as { cause?: { message?: string } }).cause?.message ?? (e as { cause?: unknown }).cause)
        : undefined,
      target,
      method,
      ms: Date.now() - t0,
    });
  }
}

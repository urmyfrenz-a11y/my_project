import { NextResponse } from "next/server";
import { ProxyAgent, fetch as uFetch } from "undici";
import net from "node:net";
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

  // Probe mode: raw TCP connect to a host:port to test reachability from Vercel.
  if (sp.get("probe") === "1") {
    const host = sp.get("phost") || "proxy.scrapingdog.com";
    const port = Number(sp.get("pport") || "8081");
    const t0 = Date.now();
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const s = net.connect({ host, port });
      const done = (r: Record<string, unknown>) => {
        s.destroy();
        resolve({ host, port, ms: Date.now() - t0, ...r });
      };
      s.setTimeout(to);
      s.on("connect", () => done({ connected: true }));
      s.on("timeout", () => done({ connected: false, err: "timeout" }));
      s.on("error", (e) => done({ connected: false, err: String(e.message) }));
    });
    return NextResponse.json(result);
  }

  // Direct mode: fetch the target WITHOUT the proxy, to confirm egress works.
  if (sp.get("direct") === "1") {
    const target = sp.get("target") || "https://ipinfo.io/json";
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), to);
    const t0 = Date.now();
    try {
      const res = await uFetch(target, { signal: ac.signal });
      const text = await res.text();
      clearTimeout(timer);
      return NextResponse.json({ direct: true, status: res.status, ms: Date.now() - t0, sample: text.slice(0, 500) });
    } catch (e) {
      clearTimeout(timer);
      return NextResponse.json({ direct: true, error: String(e instanceof Error ? e.message : e), ms: Date.now() - t0 });
    }
  }

  const proxy = buildProxy(sp, key);
  const dispatcher = new ProxyAgent({
    uri: proxy.uri,
    token: proxy.token,
    connectTimeout: to,
    headersTimeout: to,
    bodyTimeout: to,
    // Scrapingdog's proxy MITMs TLS, so the target cert won't verify — the
    // docs require `curl -k`. Skip verification of the origin TLS.
    requestTls: { rejectUnauthorized: false },
    proxyTls: { rejectUnauthorized: false },
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
    // Allow injecting the real query (base64) and a full raw body override via
    // URL params, so we can finalize the request without redeploying.
    const q64 = sp.get("q64");
    const query = q64 ? Buffer.from(q64, "base64").toString("utf8") : GQL_QUERY;
    const rawBody = sp.get("body64");
    body = rawBody
      ? Buffer.from(rawBody, "base64").toString("utf8")
      : JSON.stringify([
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
            query,
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
    // grep mode: return windows around each match of a substring (e.g. to find
    // the real getVisitorReviews query text inside a JS bundle).
    const grep = sp.get("grep");
    let hits: string[] | undefined;
    if (grep) {
      hits = [];
      let from = 0;
      while (hits.length < 5) {
        const at = text.indexOf(grep, from);
        if (at < 0) break;
        hits.push(text.slice(Math.max(0, at - 200), at + 500));
        from = at + grep.length;
      }
    }
    // scripts mode: list all <script src> URLs (to locate the review bundle).
    const scripts =
      sp.get("scripts") === "1"
        ? [...text.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => m[1]).slice(0, 60)
        : undefined;
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      target,
      method,
      proxyHost: proxy.uri,
      proxyUser: proxy.user,
      len: text.length,
      hits,
      scripts,
      sample: grep || scripts ? undefined : text.slice(0, 3000),
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

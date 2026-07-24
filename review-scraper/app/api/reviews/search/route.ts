import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/reviews";
import { kakaoSearchPlaces } from "@/lib/reviews/adapters/kakao";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  // TEMP diagnostic: probe candidate Kakao review endpoints to find the
  // current one (the old place.map.kakao.com/main/v/{id} now 404s).
  if (url.searchParams.get("debug") === "kakao") {
    const cands = await kakaoSearchPlaces(q);
    const place = cands[0] ?? null;
    const probes: unknown[] = [];
    if (place) {
      const id = place.placeId;
      const ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
      const trials: { url: string; headers: Record<string, string> }[] = [
        // exact Accept: application/json (strict content negotiation)
        { url: `https://place-api.map.kakao.com/places/panel3/${id}`, headers: { Accept: "application/json" } },
        { url: `https://place-api.map.kakao.com/places/panel3/${id}`, headers: { Accept: "application/json", Referer: "https://place.map.kakao.com/", "User-Agent": ua } },
        { url: `https://place-api.map.kakao.com/places/panel3/${id}`, headers: { Accept: "application/json", pf: "web", Referer: "https://place.map.kakao.com/" } },
        { url: `https://place-api.map.kakao.com/reviews?placeId=${id}&order=RECOMMEND&onlyPhotoReview=false&page=1&size=20`, headers: { Accept: "application/json", Referer: "https://place.map.kakao.com/" } },
        { url: `https://place-api.map.kakao.com/reviews?placeId=${id}&order=RECOMMEND&size=20`, headers: { Accept: "application/json", pf: "web", Referer: "https://place.map.kakao.com/" } },
      ];
      for (const t of trials) {
        const u = t.url;
        try {
          const r = await fetch(u, { headers: t.headers });
          const ct = r.headers.get("content-type") ?? "";
          const body = await r.text();
          let topKeys: string[] = [];
          if (ct.includes("json")) {
            try {
              topKeys = Object.keys(JSON.parse(body));
            } catch {
              /* ignore */
            }
          }
          probes.push({
            url: u,
            headers: t.headers,
            status: r.status,
            contentType: ct,
            topKeys,
            snippet: body.slice(0, 600),
          });
        } catch (e) {
          probes.push({ url: u, headers: t.headers, error: String(e) });
        }
      }
    }
    return NextResponse.json({ debug: true, place, probes });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}

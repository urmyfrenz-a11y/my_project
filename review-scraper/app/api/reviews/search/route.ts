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
      const candidateUrls = [
        `https://place-api.map.kakao.com/places/panel3/${id}`,
        `https://place-api.map.kakao.com/places/main/${id}`,
        `https://place-api.map.kakao.com/reviews?placeId=${id}&order=RECOMMEND&onlyPhotoReview=false&page=1&size=20`,
        `https://place.map.kakao.com/main/v/${id}`,
        `https://place.map.kakao.com/m/main/v/${id}`,
        `https://comment.map.kakao.com/api/comment/list/${id}`,
      ];
      for (const u of candidateUrls) {
        try {
          const r = await fetch(u, {
            headers: {
              Referer: "https://map.kakao.com/",
              Origin: "https://map.kakao.com",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              Accept: "application/json, text/plain, */*",
            },
          });
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
            status: r.status,
            contentType: ct,
            topKeys,
            snippet: body.slice(0, 600),
          });
        } catch (e) {
          probes.push({ url: u, error: String(e) });
        }
      }
    }
    return NextResponse.json({ debug: true, place, probes });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}

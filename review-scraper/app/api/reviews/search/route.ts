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
      try {
        const r = await fetch(
          `https://place-api.map.kakao.com/places/panel3/${id}`,
          {
            headers: {
              Accept: "application/json",
              pf: "web",
              Referer: "https://place.map.kakao.com/",
            },
          },
        );
        const panel = (await r.json()) as Record<string, unknown>;
        const km = panel.kakaomap_review as Record<string, unknown> | undefined;
        probes.push({
          status: r.status,
          panelKeys: Object.keys(panel),
          kakaomap_review_keys: km ? Object.keys(km) : [],
          kakaomap_review_raw: JSON.stringify(km).slice(0, 1800),
        });
      } catch (e) {
        probes.push({ error: String(e) });
      }
    }
    return NextResponse.json({ debug: true, place, probes });
  }

  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}

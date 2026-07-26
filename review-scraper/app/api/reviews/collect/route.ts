import { NextResponse } from "next/server";
import {
  collectReviews,
  type Platform,
  type PlaceSearchResult,
} from "@/lib/reviews";

// Playwright (naver) needs the Node.js runtime, not edge.
export const runtime = "nodejs";
export const maxDuration = 60;

const ALL: Platform[] = ["web", "kakao", "naver", "google"];

export async function POST(req: Request) {
  let body: {
    query?: string;
    platforms?: string[];
    place?: PlaceSearchResult;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const platforms = (
    Array.isArray(body.platforms) && body.platforms.length
      ? body.platforms
      : ALL
  ).filter((p): p is Platform => ALL.includes(p as Platform));

  // The client's place-picker sends the exact place the user chose so we
  // collect for that place instead of a fuzzy "best match".
  const place =
    body.place && body.place.placeId ? body.place : undefined;

  const results = await collectReviews(query, platforms, place);
  return NextResponse.json({ query, results });
}

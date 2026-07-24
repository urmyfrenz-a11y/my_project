import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/reviews";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  const places = await searchPlaces(q);
  return NextResponse.json({ query: q, places });
}

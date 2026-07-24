import { NextResponse } from "next/server";
import { config } from "@/lib/reviews/config";

// TEMPORARY diagnostic route — proxies the Kakao worker's /debug so we can read
// what it harvests through Vercel (the sandbox can't reach onrender.com直接).
// Remove after diagnosing.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const placeId = new URL(req.url).searchParams.get("placeId")?.trim() ?? "";
  if (!placeId) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }
  const base = config.kakao.workerUrl.replace(/\/$/, "");
  if (!base) {
    return NextResponse.json({ error: "KAKAO_WORKER_URL not set" });
  }
  try {
    const res = await fetch(`${base}/debug?placeId=${encodeURIComponent(placeId)}`, {
      signal: AbortSignal.timeout(58000),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { nonJson: text.slice(0, 500) };
    }
    return NextResponse.json({ workerStatus: res.status, ...((json as object) ?? {}) });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

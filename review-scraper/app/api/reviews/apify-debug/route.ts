import { NextResponse } from "next/server";

// Temporary R&D endpoint to wire up an Apify actor for Naver Place reviews.
// URL-param driven so we can learn the actor's input schema and iterate the run
// input WITHOUT redeploying.
//
//   ?info=1&actor=huggable_quote~naver-place-reviews      → actor metadata
//   ?schema=1&actor=...                                   → default build input schema
//   ?actor=...&input=<base64 json>&max=3                  → run + return items
export const runtime = "nodejs";
export const maxDuration = 60;

const TOKEN = process.env.APIFY_TOKEN || "";
const API = "https://api.apify.com/v2";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  if (!TOKEN) return NextResponse.json({ error: "APIFY_TOKEN not set" }, { status: 500 });

  const actor = (sp.get("actor") || "huggable_quote~naver-place-reviews-scraper").replace("/", "~");
  const to = Number(sp.get("to") || "55000");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), to);
  const t0 = () => Date.now();
  const started = t0();

  try {
    // Actor metadata (name, defaultRunOptions, exampleRunInput if present).
    if (sp.get("info") === "1") {
      const res = await fetch(`${API}/acts/${actor}?token=${encodeURIComponent(TOKEN)}`, {
        signal: ac.signal,
      });
      const j = (await res.json()) as { data?: Record<string, unknown> };
      clearTimeout(timer);
      const d = j?.data ?? {};
      return NextResponse.json({
        status: res.status,
        actor,
        name: d.name,
        title: (d as { title?: string }).title,
        defaultRunOptions: (d as { defaultRunOptions?: unknown }).defaultRunOptions,
        exampleRunInput: (d as { exampleRunInput?: unknown }).exampleRunInput,
        keys: Object.keys(d),
      });
    }

    // Default build → carries the inputSchema JSON string (field names!).
    if (sp.get("schema") === "1") {
      const res = await fetch(
        `${API}/acts/${actor}/builds/default?token=${encodeURIComponent(TOKEN)}`,
        { signal: ac.signal },
      );
      const j = (await res.json()) as {
        data?: { inputSchema?: string; readme?: string };
      };
      clearTimeout(timer);
      const raw = j?.data?.inputSchema;
      let parsed: unknown = raw;
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        /* keep raw */
      }
      return NextResponse.json({ status: res.status, actor, inputSchema: parsed });
    }

    // Run the actor synchronously and return the dataset items.
    const input64 = sp.get("input");
    let input: unknown = {};
    if (input64) {
      try {
        input = JSON.parse(Buffer.from(input64, "base64").toString("utf8"));
      } catch (e) {
        clearTimeout(timer);
        return NextResponse.json({ error: "bad input base64/json: " + String(e) });
      }
    }
    const max = sp.get("max") || "3";
    const runTimeout = sp.get("runto") || "45"; // seconds the actor run may take
    const url =
      `${API}/acts/${actor}/run-sync-get-dataset-items` +
      `?token=${encodeURIComponent(TOKEN)}&timeout=${runTimeout}&maxItems=${max}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: ac.signal,
    });
    const text = await res.text();
    clearTimeout(timer);
    let items: unknown = text;
    try {
      items = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return NextResponse.json({
      status: res.status,
      ms: t0() - started,
      actor,
      input,
      count: Array.isArray(items) ? items.length : undefined,
      items: Array.isArray(items) ? items.slice(0, 3) : undefined,
      raw: Array.isArray(items) ? undefined : String(text).slice(0, 2000),
    });
  } catch (e) {
    clearTimeout(timer);
    return NextResponse.json({
      error: String(e instanceof Error ? `${e.name}: ${e.message}` : e),
      ms: t0() - started,
      actor,
    });
  }
}

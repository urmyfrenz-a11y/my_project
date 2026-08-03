import { createHash } from "crypto";

/**
 * Anonymize an author's display name before it ever hits our storage/UI.
 * Reviews are user-generated content; storing raw nicknames is a privacy
 * liability under 개인정보보호법. We keep a stable-but-opaque label so the
 * same reviewer is recognizable across their reviews without being identifiable.
 */
export function anonymizeAuthor(name: string | undefined | null): string {
  const clean = (name ?? "").trim();
  if (!clean) return "익명";
  const hash = createHash("sha256").update(clean).digest("hex").slice(0, 6);
  // Keep the first char as a weak hint, mask the rest.
  const head = [...clean][0] ?? "?";
  return `${head}***#${hash}`;
}

/** Clamp any incoming rating into a normalized 0–5 float (1 decimal). */
export function normalizeRating(
  value: number | string | undefined | null,
  maxScale = 5,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(n)) return null;
  const scaled = maxScale === 5 ? n : (n / maxScale) * 5;
  return Math.round(Math.max(0, Math.min(5, scaled)) * 10) / 10;
}

/** Best-effort conversion of assorted date strings to ISO-8601. */
export function toIsoDate(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === "number") {
    // treat as unix seconds or ms
    const ms = input < 1e12 ? input * 1000 : input;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof input === "string") {
    // Handle "2024.03.15", "2024-03-15", "24.3.15.수" etc.
    const cleaned = input.replace(/[^0-9.\-/]/g, " ").trim().split(/\s+/)[0];
    const norm = cleaned.replace(/\./g, "-").replace(/-+$/g, "");
    const d = new Date(norm);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

/** Small helper: fetch with a timeout so a hung upstream can't wedge a request. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/* ── Apify free-plan usage limit ──────────────────────────
 * Naver맵 · 구글맵 share one Apify account whose free plan grants $5 of
 * platform usage per monthly billing cycle. When it's spent, Apify returns 403
 * { type: "platform-feature-disabled", message: "Monthly usage hard limit
 * exceeded" } and blocks all Actor runs until the cycle rolls over. The cycle
 * renews monthly on this day-of-month (current anniversary = the 5th). */
const APIFY_RESET_DAY = 5;

/** True when an Apify error body is the monthly-usage-limit block. */
export function isApifyUsageLimit(status: number, body: string): boolean {
  return (
    status === 403 &&
    /platform-feature-disabled|usage hard limit|usage limit/i.test(body)
  );
}

/** "8월 5일" — the next date the Apify free credit resets. */
export function nextApifyResetLabel(now: Date = new Date()): string {
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-based
  // If we're already on/after this cycle's reset day, the next reset is next month.
  if (now.getUTCDate() >= APIFY_RESET_DAY) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return `${month + 1}월 ${APIFY_RESET_DAY}일`;
}

/** User-facing message shown when the Apify free quota is exhausted. */
export function apifyQuotaMessage(): string {
  return `무료 API 호출 한도를 초과하여 현재 리뷰를 수집할 수 없습니다. ${nextApifyResetLabel()}에 한도가 리셋되면 다시 이용할 수 있습니다.`;
}

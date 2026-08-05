// 네이버 플레이스 URL 파싱 + 페이지 HTML에서 내장 상태를 뽑아
// "세팅 진단"에 필요한 필드만 정규화한다.
//
// 네이버는 공개 API가 없고 내부 GraphQL 필드명이 수시로 바뀌므로, 정확한 키
// 하나에 의존하지 않고 "별칭 목록을 깊이 탐색"하는 방어적 방식을 쓴다.

import type { BizType, NormalizedPlace } from "./types";

export interface ParsedUrl {
  type: string;
  id: string;
}

/**
 * 네이버 플레이스 URL에서 { type, id } 추출.
 * 지원: map.naver.com/p/entry/place/{id}, m.place.naver.com/{type}/{id}/...,
 *       pcmap.place.naver.com/{type}/{id}, ?placeId= 쿼리 등.
 * naver.me 단축링크는 여기서 풀 수 없어 null → 상위에서 리다이렉트 해석.
 */
export function parseNaverUrl(raw: string): ParsedUrl | null {
  if (!raw) return null;
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "naver.me" && !host.endsWith("naver.com")) return null;
  if (host === "naver.me") return null; // 단축링크 → 상위에서 처리

  const path = u.pathname;
  const typed = path.match(
    /\/(restaurant|place|hairshop|hospital|accommodation|attraction|beauty|cafe|share)\/(\d{6,})/i,
  );
  if (typed) {
    const t = typed[1].toLowerCase();
    return { type: t === "share" ? "place" : t, id: typed[2] };
  }
  const entry = path.match(/entry\/place\/(\d{6,})/i) || path.match(/place\/(\d{6,})/i);
  if (entry) return { type: "place", id: entry[1] };
  const bare = path.match(/\/(\d{7,})(?:\/|$)/);
  if (bare) return { type: "place", id: bare[1] };
  const q = u.searchParams.get("placeId") || u.searchParams.get("id");
  if (q && /^\d{6,}$/.test(q)) return { type: "place", id: q };
  return null;
}

/** m.place 홈 URL 조립 */
export function placeHomeUrl(type: string, id: string): string {
  return `https://m.place.naver.com/${type || "place"}/${id}/home`;
}

/**
 * HTML 문자열에서 `window.__APOLLO_STATE__ = {...}` 류의 내장 JSON을 뽑는다.
 * 여러 변수명을 시도하고, 중괄호 균형을 맞춰 안전하게 잘라낸다.
 */
export function extractEmbeddedState(html: string): Record<string, unknown> | null {
  const vars = [
    "window.__APOLLO_STATE__",
    "__APOLLO_STATE__",
    "window.__PLACE_STATE__",
    "window.__NEXT_DATA__",
  ];
  for (const v of vars) {
    const idx = html.indexOf(v);
    if (idx < 0) continue;
    const eq = html.indexOf("=", idx + v.length);
    if (eq < 0) continue;
    const braceStart = html.indexOf("{", eq);
    if (braceStart < 0) continue;
    const json = sliceBalanced(html, braceStart);
    if (!json) continue;
    try {
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      // JSON.parse 실패 시 다음 후보로
    }
  }
  return null;
}

/** start 위치의 '{' 부터 균형 맞는 '}' 까지 문자열 슬라이스 (문자열 리터럴 인지) */
function sliceBalanced(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// ── 정규화 헬퍼: 별칭 깊이 탐색 ──────────────────────────

type AnyObj = Record<string, unknown>;

/** "장소 본체" 엔티티를 식별하기 위한 대표 키들 (많이 가질수록 본체) */
const PLACE_KEYS = new Set(
  [
    "name",
    "category",
    "categoryName",
    "roadAddress",
    "roadAddr",
    "address",
    "fullAddress",
    "virtualPhone",
    "phone",
    "visitorReviewsTotal",
    "blogCafeReviewCount",
    "bookingBusinessId",
    "talktalkUrl",
    "description",
    "businessHours",
    "imageCount",
    "conveniences",
  ].map((k) => k.toLowerCase()),
);

/**
 * 상태 전체에서 "장소 본체" 객체를 찾는다. (메뉴 항목처럼 name 만 가진 객체가
 * 아니라, 대표 키를 가장 많이 가진 객체 = 본체) 스칼라 필드는 여기서 먼저 읽어야
 * 메뉴 항목의 name/price 가 상호/전화로 잘못 잡히지 않는다.
 */
export function findBaseEntity(state: unknown): AnyObj | null {
  let best: AnyObj | null = null;
  let bestScore = 1; // 최소 2개 이상 대표키를 가진 것만 본체로 인정
  const seen = new Set<unknown>();
  const stack: unknown[] = [state];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      if (Array.isArray(node)) for (const it of node) stack.push(it);
      continue;
    }
    if (seen.has(node)) continue;
    seen.add(node);
    const obj = node as AnyObj;
    let score = 0;
    for (const k of Object.keys(obj)) {
      if (PLACE_KEYS.has(k.toLowerCase())) score++;
    }
    if (score > bestScore && typeof obj.name === "string") {
      bestScore = score;
      best = obj;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return best;
}

/** 단일 객체에서 별칭 스칼라 읽기 (얕게) */
function localScalar(
  obj: AnyObj | null,
  aliases: string[],
): string | number | boolean | null {
  if (!obj) return null;
  const wanted = new Set(aliases.map((a) => a.toLowerCase()));
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.has(k.toLowerCase()) && v != null) {
      if (typeof v === "string" && v.trim() !== "") return v.trim();
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v;
    }
  }
  return null;
}

function findScalar(
  state: unknown,
  aliases: string[],
): string | number | boolean | null {
  const wanted = new Set(aliases.map((a) => a.toLowerCase()));
  const seen = new Set<unknown>();
  const stack: unknown[] = [state];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [k, v] of Object.entries(node as AnyObj)) {
      if (wanted.has(k.toLowerCase()) && v != null) {
        if (typeof v === "string" && v.trim() !== "") return v.trim();
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v;
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

function findCount(
  state: unknown,
  arrayAliases: string[],
  countAliases: string[],
): number {
  const c = findScalar(state, countAliases);
  if (typeof c === "number") return c;
  if (typeof c === "string" && c !== "" && !isNaN(Number(c))) return Number(c);

  const wanted = new Set(arrayAliases.map((a) => a.toLowerCase()));
  const seen = new Set<unknown>();
  const stack: unknown[] = [state];
  let best = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [k, v] of Object.entries(node as AnyObj)) {
      if (wanted.has(k.toLowerCase()) && Array.isArray(v)) {
        best = Math.max(best, v.length);
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return best;
}

function findTruthy(state: unknown, aliases: string[]): boolean {
  const val = findScalar(state, aliases);
  if (val == null) return false;
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val > 0;
  if (typeof val === "string") return val.trim() !== "" && val !== "false" && val !== "0";
  return false;
}

function collectStrings(state: unknown, aliases: string[]): string[] {
  const wanted = new Set(aliases.map((a) => a.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [state];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [k, v] of Object.entries(node as AnyObj)) {
      if (wanted.has(k.toLowerCase()) && Array.isArray(v)) {
        for (const it of v) {
          if (typeof it === "string" && it.trim()) out.push(it.trim());
          else if (it && typeof it === "object") {
            const o = it as AnyObj;
            const s = o.name || o.label || o.title || o.text || o.url;
            if (typeof s === "string" && s.trim()) out.push(s.trim());
          }
        }
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return [...new Set(out)];
}

/** homepage/SNS 링크 수집: 배열(sns/homepages/urls…) + 스칼라 URL 필드(instagram/blog…) */
function collectLinks(state: unknown): string[] {
  const out = new Set<string>();
  // 배열형: homepageEtc(=[{url,type}…]), sns 등 → collectStrings 가 각 항목의 url 추출
  for (const s of collectStrings(state, [
    "homepages",
    "homePages",
    "homepageEtc",
    "sns",
    "snsList",
    "snsUrls",
    "urls",
    "websites",
    "links",
    "channels",
    "socialLinks",
    "social",
  ])) {
    if (/^https?:\/\//i.test(s)) out.add(s);
  }
  // 스칼라 URL 필드: homepage(인스타 등)·siteLanding·인스타/블로그 개별 필드
  const scalarKeys = new Set([
    "homepage",
    "sitelanding",
    "instagram",
    "blog",
    "naverblog",
    "facebook",
    "youtube",
    "website",
    "homepageurl",
    "kakaotalk",
    "band",
    "twitter",
    "tiktok",
    "snsurl",
  ]);
  const seen = new Set<unknown>();
  const stack: unknown[] = [state];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const [k, v] of Object.entries(node as AnyObj)) {
      if (
        scalarKeys.has(k.toLowerCase()) &&
        typeof v === "string" &&
        /^https?:\/\//i.test(v.trim())
      ) {
        out.add(v.trim());
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return [...out];
}

/** 카테고리 문자열로 업종 대분류 판별 (상품 항목 라벨/적용 분기용) */
export function detectBizType(category: string | null): BizType {
  const c = (category || "").toLowerCase();
  if (/호텔|모텔|펜션|리조트|글램핑|게스트|숙박|캠핑|풀빌라/.test(c)) return "lodging";
  if (/병원|의원|치과|한의원|클리닉|의료|성형|피부과|안과|정형외과|한방/.test(c))
    return "medical";
  if (/학원|헬스|피트니스|필라테스|요가|미용|헤어|네일|피부관리|에스테틱|주차|골프연습|스터디카페|교습/.test(c))
    return "priced";
  if (/클래스|공방|원데이|체험|투어|레슨|플라워|공예|쿠킹/.test(c)) return "class";
  if (/음식|식당|맛집|카페|커피|주점|바|레스토랑|분식|치킨|피자|고기|횟집|일식|중식|양식|한식|베이커리|디저트|펍|포차|술집/.test(c))
    return "food";
  return "generic";
}

/** 원본 내장 상태 → 진단용 정규화 place */
export function normalize(state: unknown, parsed: ParsedUrl): NormalizedPlace {
  const base = findBaseEntity(state);
  // 스칼라는 본체(base)에서 먼저, 없으면 전역 탐색으로 폴백.
  const scalar = (aliases: string[]) =>
    localScalar(base, aliases) ?? findScalar(state, aliases);

  const name = asString(scalar(["name", "placeName", "displayName", "title"]));
  const category = asString(scalar(["category", "categoryName", "businessCategory"]));
  const address = asString(
    scalar([
      "roadAddress",
      "roadAddr",
      "fullRoadAddress",
      "address",
      "fullAddress",
      "commonAddress",
    ]),
  );
  const phone = asString(scalar(["phone", "virtualPhone", "tel", "phoneNumber"]));
  const description = asString(
    scalar([
      "description",
      "introduction",
      "microReview",
      "placeDescription",
      "bookingDescription",
    ]),
  );

  const hasHours =
    findCount(
      state,
      ["businessHours", "newBusinessHours", "bizHours", "openHours", "operationTime"],
      [],
    ) > 0;
  const hoursStr = asString(
    scalar([
      "businessHours",
      "bizHour",
      "businessStatusDescription",
      "openHours",
      "operationTime",
      "runningTime",
    ]),
  );
  const businessHours = hasHours || hoursStr ? hoursStr || "등록됨" : null;

  const photoCount = findCount(
    state,
    ["images", "imageList", "photos", "photoList", "media"],
    ["imageCount", "totalImageCount", "photoCount", "totalPhotoCount", "totalImages", "totalPhotos"],
  );
  const productCount = findCount(
    state,
    ["menus", "menuList", "menuItems", "menu", "rooms", "roomList", "courses", "prices", "priceList"],
    ["menuCount", "totalMenuCount", "totalMenus", "roomCount"],
  );
  const newsCountRaw = findCount(
    state,
    [
      "news",
      "newsList",
      "feed",
      "feedList",
      "announcements",
      "notices",
      "posts",
      "postList",
      "recentNews",
      "newsFeed",
    ],
    ["newsCount", "feedCount", "announcementCount", "postCount", "totalNews"],
  );
  // 소식이 배열이 아니라 최신글 객체/날짜로만 올 수도 있어 보조 신호도 본다.
  const hasNewsFlag = findTruthy(state, [
    "hasNews",
    "latestNews",
    "lastNews",
    "newsDate",
    "lastNewsDate",
    "recentNewsDate",
    "lastFeedDate",
  ]);
  const newsCount = newsCountRaw > 0 ? newsCountRaw : hasNewsFlag ? 1 : 0;

  const conveniences = collectStrings(state, [
    "conveniences",
    "amenities",
    "facilities",
    "options",
    "conveniencesItems",
  ]);
  const homepages = collectLinks(state);

  const hasBooking =
    findTruthy(state, [
      "bookingBusinessId",
      "bookingUrl",
      "hasBooking",
      "naverBookingUrl",
      "bookingId",
      "isBooking",
      "booking",
      "reservation",
      "hasReservation",
      "reservationUrl",
      "naverReservation",
      "naverBooking",
      "reserveUrl",
    ]) ||
    findCount(state, ["bookings", "reservations", "bookingItems", "reservationItems"], []) > 0 ||
    // 액터가 예약 전용 필드를 주지 않을 때: 편의시설의 '예약/주문'을 신호로 사용
    conveniences.some((c) => /예약|주문/.test(c));
  const hasTalktalk = findTruthy(state, [
    "talktalkUrl",
    "talktalk",
    "hasTalktalk",
    "talktalkId",
    "talk",
    "hasTalk",
    "talkUrl",
  ]);

  const visitorReviewCount = findCount(
    state,
    ["visitorReviews", "visitorReviewList"],
    [
      "visitorReviewsTotal",
      "visitorReviewCount",
      "visitorReviewsTotalCount",
      "totalVisitorReviews",
      "visitorReviewTotal",
    ],
  );
  const blogReviewCount = findCount(
    state,
    ["blogReviews", "fsasReviews", "blogReviewList"],
    [
      "blogCafeReviewCount",
      "fsasReviewsTotal",
      "blogReviewCount",
      "totalBlogReviews",
      "blogReviewTotal",
    ],
  );

  return {
    id: parsed.id,
    type: parsed.type,
    bizType: detectBizType(category),
    name,
    category,
    address,
    phone,
    description,
    businessHours,
    photoCount,
    productCount,
    newsCount,
    conveniences,
    homepages,
    hasBooking,
    hasTalktalk,
    visitorReviewCount,
    blogReviewCount,
  };
}

function asString(v: string | number | boolean | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

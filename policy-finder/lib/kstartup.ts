// K-Startup(창업진흥원) 사업공고 오픈API 어댑터 (공공데이터포털 15125364)
//
// 엔드포인트: https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01
//   serviceKey, page, perPage, returnType=json, cond[rcrt_prgs_yn::EQ]=Y(모집중)
// 응답: { currentCount, data: { data: [ {biz_pbanc_nm, pbanc_ctnt, supt_biz_clsfc,
//   supt_regin, pbanc_rcpt_bgng_dt, pbanc_rcpt_end_dt, pbanc_ntrp_nm,
//   rcrt_prgs_yn, detl_pg_url, pbanc_sn ...} ] } }

import { classifyCategory } from "./categories";
import {
  NormalizedProgram,
  RegionLite,
  resolveRegion,
  stripHtml,
  toISODate,
} from "./bizinfo";

const KSTARTUP_ENDPOINT =
  "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";

type RawItem = Record<string, unknown>;

function pick(item: RawItem, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

function kstartupUrl(u: string | null): string | null {
  if (!u) return null;
  if (u.startsWith("http")) return u;
  return `https://www.k-startup.go.kr${u.startsWith("/") ? "" : "/"}${u}`;
}

function extractItems(json: unknown): RawItem[] {
  if (Array.isArray(json)) return json as RawItem[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    // data.data[] (표준), 또는 data[] 폴백
    const d = obj.data as unknown;
    if (Array.isArray(d)) return d as RawItem[];
    if (d && typeof d === "object") {
      const dd = (d as Record<string, unknown>).data;
      if (Array.isArray(dd)) return dd as RawItem[];
    }
  }
  return [];
}

/** K-Startup 사업공고 호출 후 정규화. */
export async function fetchKstartupPrograms(opts: {
  apiKey: string;
  regions: RegionLite[];
  perPage?: number;
  activeOnly?: boolean;
}): Promise<NormalizedProgram[]> {
  const params = new URLSearchParams({
    page: "1",
    perPage: String(opts.perPage ?? 200),
    returnType: "json",
  });
  if (opts.activeOnly !== false) params.set("cond[rcrt_prgs_yn::EQ]", "Y");
  // serviceKey 는 이미 URL 인코딩된 값일 수 있어 직접 붙인다(이중 인코딩 방지).
  const url = `${KSTARTUP_ENDPOINT}?serviceKey=${opts.apiKey}&${params.toString()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`K-Startup API 오류: HTTP ${res.status} ${res.statusText}`);
  }
  const json: unknown = await res.json();
  const items = extractItems(json);
  return items
    .map((it) => normalizeItem(it, opts.regions))
    .filter((x): x is NormalizedProgram => x !== null);
}

function normalizeItem(
  item: RawItem,
  regions: RegionLite[],
): NormalizedProgram | null {
  const title = pick(item, "biz_pbanc_nm", "intg_pbanc_biz_nm");
  if (!title) return null;

  const sn = pick(item, "pbanc_sn", "id");
  const detail = kstartupUrl(pick(item, "detl_pg_url", "biz_aply_url"));
  const externalId = `kstartup:${sn ?? detail ?? title}`;

  const summary = stripHtml(pick(item, "pbanc_ctnt", "aply_trgt_ctnt"));
  const institution = pick(item, "pbanc_ntrp_nm", "sprv_inst", "biz_prch_dprt_nm");
  const field = pick(item, "supt_biz_clsfc");
  const regionText = pick(item, "supt_regin") ?? "";
  const start = toISODate(pick(item, "pbanc_rcpt_bgng_dt"));
  const end = toISODate(pick(item, "pbanc_rcpt_end_dt"));

  const category = classifyCategory(title, summary, field);

  // supt_regin(지원지역)이 지역 판정의 핵심 신호. '전국'이면 national.
  const region = resolveRegion(`${regionText} ${title}`, regions);
  if (!region) return null; // 타지역 전용 제외

  return {
    external_id: externalId,
    title,
    institution_name: institution,
    category_name: category,
    region_scope: region.scope,
    province: region.province,
    region_district: region.district,
    summary,
    support_amount: null,
    apply_start: start,
    apply_end: end,
    is_ongoing: !end, // 종료일 없으면 상시로 간주
    source_url: detail,
  };
}

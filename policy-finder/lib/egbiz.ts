// 경기기업비서(egbiz.or.kr) 지역별 지원사업 어댑터
//
// 프런트가 호출하는 내부 AJAX 엔드포인트를 사용한다.
//   POST https://www.egbiz.or.kr/sp/selectSupportPrjListAjax.do  (form-urlencoded)
//   body: pageIndex, bizNm(검색어), areaCode(지역코드; 용인시=111), categoryId,
//         sortCd=bizCyclId, prjStatus=all, gginsttYn=Y(경기기관), part=area
//   헤더: X-Requested-With, Sec-Fetch-*, Content-Type form-urlencoded
//   쿠키: JSESSIONID(세션) — 먼저 목록 페이지 GET으로 획득해 사용한다.
//
// 응답 형식(JSON/HTML)·필드명은 배포 환경에서 원본을 읽어 확정한다(fetchEgbizRaw).

const EGBIZ_LIST = "https://www.egbiz.or.kr/sp/selectSupportPrjListAjax.do";
const EGBIZ_PAGE = "https://www.egbiz.or.kr/sp/supportPrjAreaList.do";

function egbizHeaders(cookie?: string, form = true): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    Origin: "https://www.egbiz.or.kr",
    Referer: EGBIZ_PAGE,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest",
    "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
  if (form) h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  if (cookie) h["Cookie"] = cookie;
  return h;
}

// 목록 페이지 GET → Set-Cookie 에서 JSESSIONID 획득(세션 필요 대비).
async function fetchSession(): Promise<string | null> {
  try {
    const res = await fetch(EGBIZ_PAGE, {
      headers: egbizHeaders(undefined, false),
      cache: "no-store",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = setCookie.match(/JSESSIONID=[^;]+/);
      if (m) return m[0];
    }
  } catch {
    /* 세션 없이도 시도 */
  }
  return null;
}

export interface EgbizForm {
  pageIndex?: number;
  bizNm?: string;
  areaCode?: string;
  categoryId?: string;
  prjStatus?: string;
  gginsttYn?: string;
  part?: string;
}

function buildForm(p: EgbizForm): string {
  const params = new URLSearchParams();
  params.set("pageIndex", String(p.pageIndex ?? 0));
  params.set("bizNm", p.bizNm ?? "");
  params.set("areaCode", p.areaCode ?? "");
  params.set("categoryId", p.categoryId ?? "");
  params.set("sortCd", "bizCyclId");
  params.set("prjStatus", p.prjStatus ?? "all");
  params.set("gginsttYn", p.gginsttYn ?? "Y");
  params.set("part", p.part ?? "area");
  return params.toString();
}

interface RawRes {
  status: number;
  ok: boolean;
  contentType: string | null;
  text: string;
}

async function callEgbiz(form: string, cookie?: string): Promise<RawRes> {
  const res = await fetch(EGBIZ_LIST, {
    method: "POST",
    headers: egbizHeaders(cookie, true),
    body: form,
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  return {
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
    text,
  };
}

/** 진단: 응답이 JSON인지 HTML인지, 세션 필요한지, 빈 areaCode로 전체를 받는지 확인. */
export const EGBIZ_BUILD_TAG = "egbiz-v1-raw";

export async function fetchEgbizRaw(): Promise<{
  buildTag: string;
  session: string;
  variants: unknown[];
}> {
  const cookie = await fetchSession();
  const probes: { name: string; form: string; cookie?: string }[] = [
    { name: "yongin-111-session", form: buildForm({ areaCode: "111" }), cookie: cookie ?? undefined },
    { name: "yongin-111-nocookie", form: buildForm({ areaCode: "111" }) },
    { name: "all-area-empty-session", form: buildForm({ areaCode: "" }), cookie: cookie ?? undefined },
  ];
  const variants: unknown[] = [];
  for (const p of probes) {
    try {
      const r = await callEgbiz(p.form, p.cookie);
      variants.push({
        variant: p.name,
        status: r.status,
        contentType: r.contentType,
        length: r.text.length,
        sample: r.text.slice(0, 2500),
      });
    } catch (e) {
      variants.push({
        variant: p.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    buildTag: EGBIZ_BUILD_TAG,
    session: cookie ? "got-session" : "no-session",
    variants,
  };
}

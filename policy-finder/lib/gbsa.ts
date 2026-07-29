// GBSA(경기도경제과학진흥원) G-PMS 사업공고 어댑터
//
// 사업공고 목록 내부 AJAX 엔드포인트를 사용한다.
//   POST https://pms.gbsa.or.kr/info/pblanc/pblancListAjax.do  (form-urlencoded)
//   body: pageindex, pageunit, param=<URL인코딩 JSON>
//     param JSON: { pageIndex, pageunit, prevTp:"", chkStat:"", pageType:"list",
//                   anncNo:"", schDetailAnnc:"", searchCondition:"all",
//                   searchKeyword(검색어; 비우면 전체), ozcsrf:"" }
//   헤더: X-Requested-With, Sec-Fetch-*, Content-Type form-urlencoded
//
// 응답 형식/필드명은 배포 환경에서 원본을 읽어 확정한다(fetchGbsaRaw).
// 참고: GBSA 사업 상당수는 egbiz(경기기업비서)에도 집약됨 → external_id 로 중복 제거.

const GBSA_LIST = "https://pms.gbsa.or.kr/info/pblanc/pblancListAjax.do";
const GBSA_PAGE = "https://pms.gbsa.or.kr/info/pblanc/pblancList.do";

function gbsaHeaders(cookie?: string, form = true): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    Origin: "https://pms.gbsa.or.kr",
    Referer: GBSA_PAGE,
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

async function fetchSession(): Promise<string | null> {
  try {
    const res = await fetch(GBSA_PAGE, {
      headers: gbsaHeaders(undefined, false),
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

export interface GbsaForm {
  pageIndex?: number;
  pageunit?: number;
  searchKeyword?: string;
}

function buildForm(p: GbsaForm): string {
  const inner = {
    pageIndex: String(p.pageIndex ?? 1),
    pageunit: String(p.pageunit ?? 100),
    prevTp: "",
    chkStat: "",
    pageType: "list",
    anncNo: "",
    schDetailAnnc: "",
    searchCondition: "all",
    searchKeyword: p.searchKeyword ?? "",
    ozcsrf: "",
  };
  const params = new URLSearchParams();
  params.set("pageindex", String(p.pageIndex ?? 1));
  params.set("pageunit", String(p.pageunit ?? 100));
  params.set("param", JSON.stringify(inner));
  return params.toString();
}

interface RawRes {
  status: number;
  ok: boolean;
  contentType: string | null;
  text: string;
}

async function callGbsa(form: string, cookie?: string): Promise<RawRes> {
  const res = await fetch(GBSA_LIST, {
    method: "POST",
    headers: gbsaHeaders(cookie, true),
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

/** 진단: 응답 형식(JSON/HTML)·세션 필요 여부·전체조회 확인. DB 미적재. */
export const GBSA_BUILD_TAG = "gbsa-v1-raw";

export async function fetchGbsaRaw(): Promise<{
  buildTag: string;
  session: string;
  variants: unknown[];
}> {
  const cookie = await fetchSession();
  const probes: { name: string; form: string; cookie?: string }[] = [
    { name: "all-session", form: buildForm({ pageunit: 10 }), cookie: cookie ?? undefined },
    { name: "all-nocookie", form: buildForm({ pageunit: 10 }) },
  ];
  const variants: unknown[] = [];
  for (const p of probes) {
    try {
      const r = await callGbsa(p.form, p.cookie);
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
    buildTag: GBSA_BUILD_TAG,
    session: cookie ? "got-session" : "no-session",
    variants,
  };
}

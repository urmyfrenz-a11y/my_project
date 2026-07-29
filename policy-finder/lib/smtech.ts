// SMTECH(중소기업 기술개발사업 종합관리시스템) R&D 사업공고 어댑터 (HTML 크롤)
//
//   GET https://www.smtech.go.kr/front/ifg/no/notice02_list.do?...
//   → 목록 HTML(서버렌더링, JSON 없음). 시스템구분·사업명·공고명·상세링크 포함.
//   중기부 R&D 과제 공고 → 우리 R&D/기술개발 커버 보강.
//
// 응답 HTML 구조를 확인(fetchSmtechRaw)한 뒤 파서를 작성한다.

const SMTECH_BASE = "https://www.smtech.go.kr/front/ifg/no/notice02_list.do";

function smtechHeaders(): Record<string, string> {
  return {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    Referer: "https://www.smtech.go.kr/front/ifg/no/notice02_intro.do",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
}

interface RawRes {
  status: number;
  ok: boolean;
  text: string;
}

async function callSmtech(query: string): Promise<RawRes> {
  const res = await fetch(`${SMTECH_BASE}${query}`, {
    headers: smtechHeaders(),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, text };
}

function anchoredSlice(html: string): string {
  const markers = ["<tbody", "notice02_view", "goView", "ancmId", "사업명"];
  for (const m of markers) {
    const i = html.indexOf(m);
    if (i > 500) return html.slice(Math.max(0, i - 300), i + 2300);
  }
  return html.slice(0, 2600);
}

/** 진단: 목록 HTML 구조 확인. 전체목록/특정공고 파라미터 차이도 함께 본다. */
export const SMTECH_BUILD_TAG = "smtech-v1-raw";

export async function fetchSmtechRaw(): Promise<{
  buildTag: string;
  variants: unknown[];
}> {
  const probes = [
    { name: "clean-page1", query: "?pageIndex=1" },
    { name: "captured", query: "?buclYy=2026&ancmId=017196&buclCd=S002050&dtlAncmSn=1" },
  ];
  const variants: unknown[] = [];
  for (const p of probes) {
    try {
      const r = await callSmtech(p.query);
      variants.push({
        variant: p.name,
        status: r.status,
        length: r.text.length,
        viewLinks: (r.text.match(/notice02_view|goView|ancmId/g) ?? []).length,
        rowSample: anchoredSlice(r.text),
      });
    } catch (e) {
      variants.push({
        variant: p.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { buildTag: SMTECH_BUILD_TAG, variants };
}

// 서울경제진흥원(SBA) 접수중인 사업 어댑터 (HTML 크롤 — 서버렌더링, JSON 없음)
//
//   GET https://www.sba.seoul.kr/Pages/BusinessApply/OngoingList.aspx
//   → 목록 HTML. 각 행에 사업명·접수일정·상세링크(PostingDetail.aspx?mid=<GUID>) 포함.
//
// JSON이 아니라 HTML이므로, 응답 HTML 구조를 확인(fetchSbaRaw)한 뒤 파서를 작성한다.

const SBA_LIST = "https://www.sba.seoul.kr/Pages/BusinessApply/OngoingList.aspx";

function sbaHeaders(cookie?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ko,en-US;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

interface RawRes {
  status: number;
  ok: boolean;
  text: string;
}

async function callSba(cookie?: string): Promise<RawRes> {
  const res = await fetch(SBA_LIST, { headers: sbaHeaders(cookie), cache: "no-store" });
  const text = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, text };
}

/** 진단: 목록 HTML 구조 확인. 공고 행(PostingDetail 링크) 주변을 잘라서 보여준다. */
export const SBA_BUILD_TAG = "sba-v1-raw";

export async function fetchSbaRaw(): Promise<{
  buildTag: string;
  status: number;
  length: number;
  postingLinkCount: number;
  rowSample: string;
}> {
  const r = await callSba();
  // 목록 행 구조를 바로 보기 위해 첫 상세링크 주변을 잘라 반환
  const idx = r.text.indexOf("PostingDetail");
  const rowSample =
    idx >= 0 ? r.text.slice(Math.max(0, idx - 400), idx + 2200) : r.text.slice(0, 2600);
  const postingLinkCount = (r.text.match(/PostingDetail/g) ?? []).length;
  return {
    buildTag: SBA_BUILD_TAG,
    status: r.status,
    length: r.text.length,
    postingLinkCount,
    rowSample,
  };
}

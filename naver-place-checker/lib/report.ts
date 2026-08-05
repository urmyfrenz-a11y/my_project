// 진단 결과를 "문서(보고서) 형태"의 자체 완결형 HTML로 만든다.
// 새 창에서 이 HTML을 열고 브라우저 인쇄 → "PDF로 저장"하면 docx 보고서 같은
// PDF가 나온다. (별도 라이브러리 없이 인쇄 기반)

import type { DiagnosisRow, PlaceMeta } from "./types";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mark(row: DiagnosisRow): { t: string; cls: string } {
  if (row.kind === "number") return { t: "수", cls: "m-num" };
  if (row.ok === true) return { t: "O", cls: "m-ok" };
  if (row.kind === "optional") return { t: "선택", cls: "m-opt" };
  return { t: "X", cls: "m-no" };
}

export function buildReportHtml(
  place: PlaceMeta,
  rows: DiagnosisRow[],
  score: { done: number; total: number },
  dateStr: string,
): string {
  const pct = score.total ? Math.round((score.done / score.total) * 100) : 0;
  const grade = pct >= 90 ? "우수" : pct >= 70 ? "양호" : pct >= 50 ? "보통" : "개선 필요";

  const bodyRows = rows
    .map((r) => {
      const m = mark(r);
      return `<tr>
        <td class="c-mark"><span class="mk ${m.cls}">${m.t}</span></td>
        <td class="c-item">${esc(r.label)}</td>
        <td class="c-status">${esc(r.status)}</td>
        <td class="c-rec">${r.recommend ? esc(r.recommend) : "—"}</td>
      </tr>`;
    })
    .join("");

  const tips = `
    <h2>추가 팁 — 상위노출을 위한 핵심 가이드</h2>

    <h3>1. 노출 알고리즘 4대 축 (2025~2026)</h3>
    <p>순위는 대체로 <b>적합도 · 인기도 · 거리 · 신뢰도</b> 조합으로 결정되며, 무게중심이
    "실제 이용자 행동 데이터 + 활동성 + 신뢰도"로 이동했습니다.</p>
    <ul>
      <li><b>적합도(관련성)</b> — 업체명·업종 카테고리·키워드·상세설명이 검색어와 얼마나 맞는가</li>
      <li><b>인기도</b> — 클릭수, 플레이스 저장(즐겨찾기) 수, 리뷰수, 전화·길찾기·예약 전환</li>
      <li><b>거리</b> — 검색 위치와 매장의 물리적 거리</li>
      <li><b>신뢰도</b> — 진짜 방문(영수증) 리뷰 비율, 부자연스러운 리뷰 패턴 여부</li>
    </ul>

    <h3>2. 놓치기 쉬운 세팅·활동 항목</h3>
    <ul>
      <li><b>업체명(상호)</b> — 정식 상호 사용. 과도한 키워드 삽입은 어뷰징 위험</li>
      <li><b>검색 키워드 10~15개</b> — 업종·지역·서비스 조합으로 관리자 검색어 등록(대표키워드 5개와 별개)</li>
      <li><b>소식(새소식)</b> — 월 2회 이상 이벤트·신메뉴·공지 발행("살아있는 매장" 신호)</li>
      <li><b>네이버 톡톡</b> — 문의 응대 채널 연결(응대율·속도가 신뢰도에 반영)</li>
      <li><b>동영상 / 네이버 클립(숏폼)</b> — 최근 노출 가중</li>
      <li><b>대표사진(썸네일) 지정 &amp; 1200px 이상</b> — 첫 이미지가 클릭률을 좌우</li>
      <li><b>지도 핀(마커) 위치 정밀 조정</b> — 지하·고층·복합건물 좌표 정확도</li>
      <li><b>NAP 일관성</b> — 상호·주소·전화가 웹 전반에서 동일해야(로컬 SEO 핵심)</li>
      <li><b>편의시설/시설정보</b> — 주차·화장실·반려동물·포장·배달·예약 가능 여부 등 상세히</li>
      <li><b>리뷰 최신성 &amp; 답글률</b> — 리뷰 '수'보다 최근 유입 속도와 답글이 핵심 지표</li>
      <li><b>정보 정확성</b> — 영업시간이 실제와 일치, 전화 연결 정상, 폐업·휴업 여부</li>
    </ul>

    <h3>3. 네이버 플레이스 메뉴 구성 참고</h3>
    <ul>
      <li><b>기본 6</b> — 홈 · 소식 · 메뉴 · 리뷰 · 사진 · 정보 (모든 업종)</li>
      <li><b>예약/주문</b> — 스마트플레이스 비즈니스 도구 연동 시 생성</li>
      <li><b>업종 특화</b> — 객실(숙박) · 코스/패키지(클래스·투어) · 가격(학원·헬스·미용·주차) · 의사(병원)</li>
      <li><b>부가</b> — 블로그(연동 SNS 최신글) · 주변(자동 추천)</li>
    </ul>`;

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>네이버 플레이스 세팅 진단 리포트 - ${esc(place.name)}</title>
<style>
  @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css");
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Pretendard Variable", Pretendard, -apple-system, "Malgun Gothic", sans-serif;
    color: #1a1a1a; font-size: 10.5pt; line-height: 1.6; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .doc { max-width: 900px; margin: 0 auto; padding: 24px; }
  .rpt-head { border-bottom: 2.5px solid #03c75a; padding-bottom: 14px; margin-bottom: 18px; }
  .rpt-head .kicker { color: #048a45; font-weight: 700; font-size: 10pt; letter-spacing: .02em; }
  .rpt-head h1 { font-size: 20pt; margin: 4px 0 10px; letter-spacing: -.02em; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 22px; font-size: 10pt; color: #333; }
  .meta b { color: #000; }
  .score { float: right; text-align: center; border: 1.5px solid #03c75a; border-radius: 10px;
           padding: 8px 16px; margin-left: 16px; }
  .score .n { font-size: 22pt; font-weight: 800; color: #048a45; line-height: 1; }
  .score .g { font-size: 10pt; color: #333; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 22px; font-size: 9.5pt; }
  thead th { background: #f0f5f2; border: 1px solid #cdd8d1; padding: 8px 9px; text-align: center;
             font-weight: 700; color: #333; }
  tbody td { border: 1px solid #dde3df; padding: 7px 9px; vertical-align: top; }
  .c-mark { width: 10%; text-align: center; }
  .c-item { width: 22%; font-weight: 700; }
  .c-status { width: 28%; }
  .c-rec { width: 40%; }
  .mk { display: inline-block; min-width: 22px; padding: 1px 6px; border-radius: 20px;
        font-size: 8.5pt; font-weight: 800; }
  .m-ok { background: #e6f7ee; color: #12a150; }
  .m-no { background: #fdeaea; color: #e5484d; }
  .m-opt { background: #eef1f5; color: #7a8794; }
  .m-num { background: #eef8f2; color: #048a45; }
  .tips { border-top: 1px solid #ddd; padding-top: 12px; }
  .tips h2 { font-size: 13pt; color: #048a45; margin: 6px 0 10px; }
  .tips h3 { font-size: 11pt; margin: 16px 0 6px; }
  .tips ul { margin: 4px 0 4px; padding-left: 18px; }
  .tips li { margin: 3px 0; }
  .rpt-foot { margin-top: 22px; border-top: 1px solid #ddd; padding-top: 10px;
              color: #888; font-size: 8.5pt; text-align: center; }
  @media print { .doc { padding: 0; } }
</style></head>
<body><div class="doc">
  <div class="rpt-head">
    <div class="score"><div class="n">${pct}</div><div class="g">${grade}</div></div>
    <div class="kicker">네이버 플레이스 세팅 진단 리포트</div>
    <h1>${esc(place.name)}</h1>
    <div class="meta">
      ${place.category ? `<span>업종 <b>${esc(place.category)}</b></span>` : ""}
      <span>업종군 <b>${esc(place.bizTypeLabel)}</b></span>
      <span>필수 <b>${score.done}/${score.total}</b> 완료</span>
      <span>진단일 <b>${esc(dateStr)}</b></span>
    </div>
  </div>

  <table>
    <thead><tr>
      <th class="c-mark">판정</th><th class="c-item">필수 항목</th>
      <th class="c-status">현재 상태</th><th class="c-rec">권고</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>

  <div class="tips">${tips}</div>

  <div class="rpt-foot">
    플레이스 닥터 · 공개 플레이스 페이지 기준 진단 · 대표키워드·스마트콜·통계 등 관리자 전용 항목 제외
  </div>
</div></body></html>`;
}

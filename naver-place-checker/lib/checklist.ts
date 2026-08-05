// 정규화된 place → 진단 표(행 배열) 생성.
//
// 화면 규칙(사용자 스펙):
//  • 필수(check): 있으면 O + 값, 권고 비움 / 없으면 X + "미등록" + 권고
//  • 선택연동(optional): 있으면 O + "연동됨" / 없으면 "선택"(X 아님) + 소프트 권고
//    → 업종·상황에 따라 없을 수 있는 항목을 문제로 깎지 않기 위함
//  • 리뷰(number): O/X 없이 숫자만
//
// 업종별 메뉴 차이 반영:
//  네이버 플레이스의 "메뉴 탭"은 업종마다 다르게 노출된다.
//   - 음식/카페 → 메뉴 / 숙박 → 객실 / 병원 → 진료·의료진
//   - 클래스·투어 → 코스·패키지 / 학원·헬스·미용·주차 → 가격(이용권)
//  따라서 '상품·품목' 항목의 라벨을 업종에 맞춰 바꾼다.

import type { BizType, DiagnosisRow, NormalizedPlace } from "./types";

/** 업종별 '상품·품목' 항목 라벨 */
export function productLabel(bizType: BizType): string {
  switch (bizType) {
    case "food":
      return "메뉴";
    case "lodging":
      return "객실";
    case "medical":
      return "진료·의료진";
    case "class":
      return "코스·패키지";
    case "priced":
      return "가격(이용권)";
    default:
      return "메뉴·상품";
  }
}

/** 업종 대분류 → 사람이 읽는 라벨 (헤더 표시용) */
export function bizTypeLabel(bizType: BizType): string {
  switch (bizType) {
    case "food":
      return "음식·카페";
    case "lodging":
      return "숙박";
    case "medical":
      return "의료";
    case "class":
      return "클래스·체험";
    case "priced":
      return "이용권·서비스";
    default:
      return "일반";
  }
}

function empty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function preview(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

export function buildRows(p: NormalizedPlace): DiagnosisRow[] {
  const rows: DiagnosisRow[] = [];

  const check = (
    label: string,
    present: boolean,
    value: string | null,
    recommend: string,
    note: string,
    key: string,
  ): DiagnosisRow => ({
    key,
    label,
    kind: "check",
    ok: present,
    status: present ? value ?? "등록됨" : "미등록",
    recommend: present ? "" : recommend,
    note,
  });

  const optional = (
    label: string,
    present: boolean,
    recommend: string,
    note: string,
    key: string,
  ): DiagnosisRow => ({
    key,
    label,
    kind: "optional",
    ok: present ? true : null,
    status: present ? "연동됨" : "미연동(선택)",
    recommend: present ? "" : recommend,
    note,
  });

  // ── 공통 필수 ──
  rows.push(
    check(
      "업체명(상호)",
      !empty(p.name),
      p.name,
      "정확한 정식 상호로 업체명을 등록하세요.",
      "정식 상호와 일치하는지, 불필요한 키워드 나열(어뷰징 위험)이 없는지 확인",
      "name",
    ),
  );
  rows.push(
    check(
      "업종(카테고리)",
      !empty(p.category),
      p.category,
      "실제 영업에 맞는 대표 업종을 설정하세요.",
      "대표 업종이 실제 업태와 일치하는지, 세부 카테고리가 적절한지 확인",
      "category",
    ),
  );
  rows.push(
    check(
      "대표사진(사진 수)",
      p.photoCount > 0,
      p.photoCount ? `${p.photoCount}장` : null,
      "고해상도 매장 사진을 여러 장(최소 10장 이상) 등록하세요.",
      "대표사진(썸네일) 지정, 1200px 이상 고해상도, 사진 정기 업데이트 확인",
      "photo",
    ),
  );
  rows.push(
    check(
      "상세설명(소개글)",
      !empty(p.description),
      p.description ? preview(p.description, 60) : null,
      "매장 소개글을 작성하세요.",
      "핵심 키워드·차별점이 포함됐는지, 성의 있게 작성됐는지 확인",
      "description",
    ),
  );
  // 업종별 상품/품목 (라벨 동적)
  rows.push(
    check(
      productLabel(p.bizType),
      p.productCount > 0,
      p.productCount ? `${p.productCount}개` : null,
      `${productLabel(p.bizType)} 항목과 가격을 등록하세요.`,
      "대표/추천 항목 지정, 가격 최신화, 항목 사진 등록 여부 확인 (업종에 따라 메뉴·객실·가격·코스·진료로 표기됨)",
      "product",
    ),
  );
  rows.push(
    check(
      "주소",
      !empty(p.address),
      p.address,
      "정확한 매장 주소를 등록하세요.",
      "지도 핀(마커) 위치가 실제 입구와 일치하는지(지하/고층/복합건물) 확인",
      "address",
    ),
  );
  rows.push(
    check(
      "전화번호",
      !empty(p.phone),
      p.phone,
      "대표 전화번호를 등록하세요.",
      "전화 연결 정상 여부, 스마트콜(안심번호) 사용 여부 확인",
      "phone",
    ),
  );
  rows.push(
    check(
      "영업시간",
      !empty(p.businessHours),
      p.businessHours,
      "영업시간을 등록하세요.",
      "실제와 일치하는지, 브레이크타임·라스트오더·공휴일 영업이 반영됐는지 확인",
      "hours",
    ),
  );
  rows.push(
    check(
      "편의시설",
      !empty(p.conveniences),
      p.conveniences.length ? p.conveniences.slice(0, 6).join(", ") : null,
      "주차·와이파이·포장 등 편의정보를 설정하세요.",
      "실제 제공하는 편의시설이 빠짐없이 반영됐는지 확인",
      "conveniences",
    ),
  );
  rows.push(
    check(
      "소식(새소식)",
      p.newsCount > 0,
      p.newsCount ? `${p.newsCount}건` : null,
      "소식(새소식)을 주기적으로(월 2회 이상) 발행하세요.",
      "이벤트·신메뉴·공지로 최신 소식 유지 → '운영 중인 살아있는 매장' 신호",
      "news",
    ),
  );

  // ── 선택 연동 (없어도 감점 아님) ──
  rows.push(
    optional(
      "예약/주문 연동",
      p.hasBooking,
      "네이버 예약/주문을 연동하면 노출 지면이 넓어지고 전환을 유도할 수 있습니다.",
      "업종에 따라 예약(병원·미용·숙박)·주문(음식점)으로 노출. 연동 시 전환율 확인",
      "booking",
    ),
  );
  rows.push(
    optional(
      "네이버 톡톡",
      p.hasTalktalk,
      "네이버 톡톡을 연결해 문의 응대 채널을 만드세요.",
      "톡톡 응대율·응대 속도가 신뢰도 지표에 반영됨",
      "talktalk",
    ),
  );
  rows.push(
    optional(
      "홈페이지/SNS(블로그)",
      !empty(p.homepages),
      "홈페이지·블로그·인스타 등 외부 채널 링크를 연결하세요.",
      "블로그/SNS 연동으로 유입 경로 확대 여부 확인",
      "homepage",
    ),
  );

  // ── 리뷰: 숫자만 ──
  rows.push({
    key: "visitorReview",
    label: "방문자 리뷰 수",
    kind: "number",
    ok: null,
    status: `${p.visitorReviewCount ?? 0}`,
    recommend: "",
    note: "리뷰 '수'보다 최신성·답글률이 중요. 영수증 방문 리뷰를 꾸준히 유도",
  });
  rows.push({
    key: "blogReview",
    label: "블로그 리뷰 수",
    kind: "number",
    ok: null,
    status: `${p.blogReviewCount ?? 0}`,
    recommend: "",
    note: "블로그 리뷰는 후기 확산 채널. 과도한 협찬성 리뷰는 신뢰도 저하 주의",
  });

  return rows;
}

/** 필수(check) 항목 기준 완료 점수 */
export function scoreOf(rows: DiagnosisRow[]): { done: number; total: number } {
  const checks = rows.filter((r) => r.kind === "check");
  return { done: checks.filter((r) => r.ok).length, total: checks.length };
}

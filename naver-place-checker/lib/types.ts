// 진단 도메인 타입.

/** 업종 대분류 — 네이버 플레이스의 "메뉴 탭" 구성이 업종별로 다르므로,
 *  상품/품목 항목의 라벨과 적용 여부를 이 타입으로 분기한다. */
export type BizType =
  | "food" // 음식점·카페·주점 → "메뉴"
  | "lodging" // 숙박 → "객실"
  | "medical" // 병원·의원 → "진료·의료진"
  | "class" // 클래스·공방·투어 → "코스·패키지"
  | "priced" // 학원·헬스·미용·주차 → "가격(이용권)"
  | "generic"; // 그 외 → "메뉴·상품"

/** 페이지 내장 상태에서 뽑아 정규화한 플레이스 정보 */
export interface NormalizedPlace {
  id: string;
  type: string; // m.place 경로 세그먼트 (restaurant/place/hairshop…)
  bizType: BizType;
  name: string | null;
  category: string | null;
  address: string | null;
  phone: string | null;
  description: string | null;
  businessHours: string | null;
  photoCount: number;
  productCount: number; // 메뉴/객실/가격/코스/진료 등 품목 수
  newsCount: number;
  conveniences: string[];
  homepages: string[];
  hasBooking: boolean;
  hasTalktalk: boolean;
  visitorReviewCount: number;
  blogReviewCount: number;
}

/** 표 한 행 */
export interface DiagnosisRow {
  key: string;
  label: string;
  /** check: 필수(O/X) · optional: 선택연동(O/선택) · number: 리뷰 숫자만 */
  kind: "check" | "optional" | "number";
  /** true → O, false → X, null → 표시 안 함(number/선택) */
  ok: boolean | null;
  status: string; // 현재 상태
  recommend: string; // 권고 (있으면 비움)
  note: string; // 비고
}

export interface PlaceMeta {
  id: string;
  name: string;
  category: string | null;
  bizTypeLabel: string;
  url: string;
}

export interface DiagnoseResult {
  ok: boolean;
  errorCode?: "INVALID_URL" | "NOT_FOUND" | "BLOCKED" | "NO_KEY" | "UPSTREAM";
  error?: string;
  place?: PlaceMeta;
  rows?: DiagnosisRow[];
  score?: { done: number; total: number };
  /** 디버그: 정규화 전 원본 일부 (파서 튜닝용) */
  debug?: unknown;
}

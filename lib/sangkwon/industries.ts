import type { Industry } from "./types";

/**
 * 대표 업종. kakao = 카카오 키워드(반경 점포수), seoul = 서울 상권분석 업종명 부분일치 키워드.
 * 서울 SVC_INDUTY_CD_NM 에 seoul 문자열이 포함되면 해당 업종으로 집계.
 */
export const INDUSTRIES: Industry[] = [
  { id: "korean", label: "한식음식점", keyword: "한식", seoul: ["한식음식점"] },
  { id: "cafe", label: "카페·커피", keyword: "카페", seoul: ["커피", "카페"] },
  { id: "chicken", label: "치킨전문점", keyword: "치킨", seoul: ["치킨"] },
  { id: "pub", label: "호프·주점", keyword: "호프", seoul: ["호프", "주점"] },
  { id: "snack", label: "분식", keyword: "분식", seoul: ["분식"] },
  { id: "bakery", label: "제과·베이커리", keyword: "베이커리", seoul: ["제과"] },
  { id: "jpn", label: "일식", keyword: "일식", seoul: ["일식"] },
  { id: "western", label: "양식", keyword: "양식", seoul: ["양식"] },
  { id: "chinese", label: "중식", keyword: "중식", seoul: ["중식"] },
  { id: "cvs", label: "편의점", keyword: "편의점", seoul: ["편의점"] },
  { id: "beauty", label: "미용실", keyword: "미용실", seoul: ["미용실"] },
  { id: "clothes", label: "의류·패션", keyword: "의류", seoul: ["의류", "패션"] },
  { id: "academy", label: "학원·교습", keyword: "학원", seoul: ["학원"] },
  { id: "clinic", label: "의원·병원", keyword: "병원", seoul: ["의원", "병원"] },
  { id: "pharmacy", label: "약국", keyword: "약국", seoul: ["약국"] },
];

export function findIndustry(id: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.id === id);
}

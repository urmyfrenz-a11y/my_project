import type { Industry } from "./types";

/** 상권분석에서 자주 쓰는 대표 업종 (카카오 키워드 검색 기반) */
export const INDUSTRIES: Industry[] = [
  { id: "food", label: "음식점(일반)", keyword: "음식점" },
  { id: "cafe", label: "카페·디저트", keyword: "카페" },
  { id: "chicken", label: "치킨·호프", keyword: "치킨" },
  { id: "pub", label: "주점·술집", keyword: "술집" },
  { id: "cvs", label: "편의점", keyword: "편의점" },
  { id: "bakery", label: "베이커리", keyword: "베이커리" },
  { id: "beauty", label: "미용실", keyword: "미용실" },
  { id: "nail", label: "네일·뷰티", keyword: "네일" },
  { id: "fashion", label: "의류·패션", keyword: "의류" },
  { id: "academy", label: "학원·교습", keyword: "학원" },
  { id: "clinic", label: "병원·의원", keyword: "병원" },
  { id: "pharmacy", label: "약국", keyword: "약국" },
  { id: "gym", label: "헬스·피트니스", keyword: "헬스장" },
  { id: "convstore", label: "무인점포", keyword: "무인" },
];

export function findIndustry(id: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.id === id);
}

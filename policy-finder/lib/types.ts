// 공용 도메인 타입

export type Province = "서울" | "경기";

export type RegionScope = "national" | "province_wide" | "district";

export type ProgramStatus = "open" | "closing_soon" | "closed" | "needs_check";

export interface Region {
  id: string;
  province: Province;
  district: string;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
}

// search_programs RPC 가 돌려주는 한 행 (조인 결과 평탄화)
export interface ProgramRow {
  id: string;
  title: string;
  summary: string | null;
  support_amount: string | null;
  apply_start: string | null;
  apply_end: string | null;
  is_ongoing: boolean;
  source_url: string | null;
  status: ProgramStatus;
  last_verified_at: string;
  region_scope: RegionScope;
  province: Province | null;
  region_district: string | null;
  institution_name: string | null;
  institution_url: string | null;
  category_id: string | null;
  category_name: string | null;
  category_sort: number | null;
  industry: string;
}

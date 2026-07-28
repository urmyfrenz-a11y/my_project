import { createClient, SupabaseClient } from "@supabase/supabase-js";

// 공개 기본값(policy-finder Supabase). publishable 키는 RLS 로 보호되어 브라우저
// 노출이 안전하다(Supabase 공식). 환경변수가 있으면 그걸 우선 사용한다.
const DEFAULT_URL = "https://wgqopzhkdbvejdzhvtej.supabase.co";
const DEFAULT_ANON_KEY = "sb_publishable_RZpDNO6h3mi4qzMopcrz9g_x68rHony";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

// 브라우저/서버 공용 읽기 전용 클라이언트 (RLS: public read)
export function getSupabase(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}

// 서버 전용 쓰기 클라이언트 (service_role, RLS 우회). ingest 라우트에서만 사용.
export function getServiceSupabase(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

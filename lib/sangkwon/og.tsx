import { ImageResponse } from "next/og";

// 링크 미리보기(og:image) 카드 렌더러 — opengraph-image / twitter-image 에서 공용 사용
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "서울 상권분석 — 지도로 찾는 상권 점수";
export const OG_CONTENT_TYPE = "image/png";

const CHIPS = ["유동인구", "매출", "배후수요", "소비력", "임대료", "입지·접근성"];

/** 렌더에 쓰이는 글자만 서브셋으로 받아오는 Google Fonts 로더 (용량 최소화) */
async function loadFont(text: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(
      text
    )}`;
    const css = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const src = css.match(/src:\s*url\((.+?)\)\s*format/);
    if (!src) return null;
    const res = await fetch(src[1]);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function renderOg() {
  const subset =
    "서울 상권분석 SANGKWON SCORE 공공데이터 9종 기반 지도로 찾는 우리 동네 상권 점수 " +
    CHIPS.join(" ") +
    " · S A B C D 등급 점 0123456789";
  const [bold, extrabold] = await Promise.all([loadFont(subset, 700), loadFont(subset, 800)]);
  const fonts = [
    bold ? { name: "NotoKR", data: bold, weight: 700 as const, style: "normal" as const } : null,
    extrabold ? { name: "NotoKR", data: extrabold, weight: 800 as const, style: "normal" as const } : null,
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 700 | 800; style: "normal" }[];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 76px",
          background: "linear-gradient(135deg, #eef2ff 0%, #ffffff 55%, #f8fafc 100%)",
          fontFamily: "NotoKR",
          color: "#0f172a",
        }}
      >
        {/* 상단: 로고 + 브랜드 / 배지 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div
              style={{
                display: "flex",
                width: 92,
                height: 92,
                borderRadius: 24,
                background: "linear-gradient(135deg, #4f46e5, #3b82f6)",
                alignItems: "flex-end",
                justifyContent: "center",
                gap: 7,
                padding: "0 0 26px 0",
                boxShadow: "0 12px 30px rgba(79,70,229,0.35)",
              }}
            >
              {[28, 48, 22, 38].map((h, i) => (
                <div key={i} style={{ width: 9, height: h, borderRadius: 5, background: "#fff" }} />
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>서울 상권분석</div>
              <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: 6, color: "#6366f1" }}>
                SANGKWON SCORE
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 22px",
              borderRadius: 999,
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              fontSize: 22,
              fontWeight: 700,
              color: "#475569",
            }}
          >
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: "#10b981" }} />
            공공데이터 9종 기반
          </div>
        </div>

        {/* 중앙: 메인 카피 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 78, fontWeight: 800, letterSpacing: -2, color: "#0f172a" }}>
            지도로 찾는
          </div>
          <div style={{ display: "flex", fontSize: 78, fontWeight: 800, letterSpacing: -2, color: "#4f46e5" }}>
            우리 동네 상권 점수
          </div>
        </div>

        {/* 하단: 팩터 칩 + 등급 배지 */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, maxWidth: 820 }}>
            {CHIPS.map((c) => (
              <div
                key={c}
                style={{
                  display: "flex",
                  padding: "10px 20px",
                  borderRadius: 999,
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  fontSize: 24,
                  fontWeight: 700,
                  color: "#475569",
                }}
              >
                {c}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 132,
              height: 132,
              borderRadius: 999,
              background: "linear-gradient(135deg, #4f46e5, #3b82f6)",
              color: "#fff",
              boxShadow: "0 16px 34px rgba(59,130,246,0.4)",
            }}
          >
            <div style={{ display: "flex", fontSize: 64, fontWeight: 800, lineHeight: 1 }}>S</div>
            <div style={{ display: "flex", fontSize: 20, fontWeight: 700, opacity: 0.9 }}>등급</div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}

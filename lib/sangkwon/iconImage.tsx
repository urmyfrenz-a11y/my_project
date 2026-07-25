import { ImageResponse } from "next/og";

// 앱 아이콘(막대그래프 마크) PNG 렌더러 — 파비콘·애플터치·매니페스트 공용
// 글자 없이 도형만 사용하므로 폰트 불필요.
export function renderIconPng(size: number) {
  const bars = [0.3, 0.52, 0.24, 0.41];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: size * 0.06,
          paddingBottom: size * 0.28,
          background: "linear-gradient(135deg, #4f46e5, #3b82f6)",
          borderRadius: size * 0.22,
        }}
      >
        {bars.map((h, i) => (
          <div
            key={i}
            style={{
              width: size * 0.09,
              height: size * h,
              borderRadius: size * 0.05,
              background: "#ffffff",
            }}
          />
        ))}
      </div>
    ),
    { width: size, height: size }
  );
}

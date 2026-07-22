"use client";

import type { AnalysisResult, FactorScore } from "@/lib/sangkwon/types";

const GRADE_COLOR: Record<string, string> = {
  S: "#7c3aed",
  A: "#2563eb",
  B: "#059669",
  C: "#d97706",
  D: "#dc2626",
};

function RadarChart({ factors }: { factors: FactorScore[] }) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const R = 100;
  const n = factors.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const point = (i: number, r: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const dataPoints = factors.map((f, i) => point(i, (f.score / 100) * R));
  const dataPath =
    dataPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px] mx-auto">
      {/* 배경 그리드 */}
      {rings.map((rr, ri) => (
        <polygon
          key={ri}
          points={factors
            .map((_, i) => {
              const p = point(i, R * rr);
              return `${p[0]},${p[1]}`;
            })
            .join(" ")}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={1}
        />
      ))}
      {/* 축선 */}
      {factors.map((_, i) => {
        const p = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#e5e7eb" strokeWidth={1} />;
      })}
      {/* 데이터 영역 */}
      <path d={dataPath} fill="rgba(37,99,235,0.18)" stroke="#2563eb" strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="#2563eb" />
      ))}
      {/* 축 레이블 */}
      {factors.map((f, i) => {
        const p = point(i, R + 18);
        return (
          <text
            key={i}
            x={p[0]}
            y={p[1]}
            fontSize={9}
            fill="#6b7280"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {f.label}
          </text>
        );
      })}
    </svg>
  );
}

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const color = GRADE_COLOR[grade] ?? "#2563eb";
  const r = 54;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  return (
    <div className="relative flex items-center justify-center">
      <svg viewBox="0 0 140 140" className="w-40 h-40 -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef0f3" strokeWidth={12} />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-xs text-gray-400">/ 100</span>
      </div>
    </div>
  );
}

export default function ResultInfographic({ result }: { result: AnalysisResult }) {
  const color = GRADE_COLOR[result.grade] ?? "#2563eb";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* 헤더 */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-400">상권 분석 결과</p>
            <h2 className="text-lg font-bold text-gray-900 truncate">{result.areaName}</h2>
            <p className="text-xs text-gray-400 truncate">{result.address}</p>
          </div>
          <span
            className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl text-2xl font-black text-white"
            style={{ backgroundColor: color }}
          >
            {result.grade}
          </span>
        </div>
      </div>

      {/* 점수 + 레이더 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-6 py-6 items-center">
        <div className="flex flex-col items-center gap-2">
          <ScoreGauge score={result.totalScore} grade={result.grade} />
          <p className="text-sm text-gray-500">종합 상권 점수</p>
        </div>
        <RadarChart factors={result.factors} />
      </div>

      {/* 팩터별 상세 */}
      <div className="px-6 pb-6 space-y-3">
        {result.factors.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">
                {f.label}
                {f.source === "live" && (
                  <span className="ml-1.5 align-middle text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                    실데이터
                  </span>
                )}
              </span>
              <span className="tabular-nums font-semibold text-gray-800">{f.score}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${f.score}%`, backgroundColor: color }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">{f.detail}</p>
          </div>
        ))}
      </div>

      {/* 푸터 */}
      <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <span className="text-[11px] text-gray-400">
          {result.demo
            ? "※ 데모 데이터 기반 — API 키 연결 시 실데이터로 전환"
            : "일부 팩터 실데이터 반영됨"}
        </span>
        <span className="text-[11px] text-gray-300">
          {result.generatedAt ? new Date(result.generatedAt).toLocaleString("ko-KR") : ""}
        </span>
      </div>
    </div>
  );
}

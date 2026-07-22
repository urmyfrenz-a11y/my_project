"use client";

import type { AnalysisResult, FactorScore } from "@/lib/sangkwon/types";
import { buildInsights } from "@/lib/sangkwon/insights";

export function InsightList({
  insights,
  title = "핵심 인사이트",
}: {
  insights: { icon: string; text: string }[];
  title?: string;
}) {
  if (!insights.length) return null;
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
      <p className="mb-2 text-xs font-bold text-indigo-700">💡 {title}</p>
      <ul className="space-y-1.5">
        {insights.map((it, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-700">
            <span className="shrink-0">{it.icon}</span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[280px]">
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
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      ))}
      {factors.map((_, i) => {
        const p = point(i, R);
        return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#e2e8f0" strokeWidth={1} />;
      })}
      <path d={dataPath} fill="rgba(79,70,229,0.16)" stroke="#4f46e5" strokeWidth={2} />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="#4f46e5" />
      ))}
      {factors.map((f, i) => {
        const p = point(i, R + 18);
        return (
          <text
            key={i}
            x={p[0]}
            y={p[1]}
            fontSize={9}
            fill="#64748b"
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
      <svg viewBox="0 0 140 140" className="h-40 w-40 -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f7" strokeWidth={12} />
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
        <span className="text-4xl font-extrabold" style={{ color }}>
          {score}
        </span>
        <span className="text-xs text-slate-400">/ 100</span>
      </div>
    </div>
  );
}

export default function ResultInfographic({ result }: { result: AnalysisResult }) {
  const color = GRADE_COLOR[result.grade] ?? "#2563eb";
  const liveCount = result.factors.filter((f) => f.source === "live").length;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* 헤더 */}
      <div className="relative border-b border-slate-100 px-6 py-5">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1"
          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }}
        />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">상권 분석 결과</p>
            <h2 className="truncate text-xl font-extrabold text-slate-900">{result.areaName}</h2>
            <p className="truncate text-xs text-slate-400">{result.address}</p>
          </div>
          <div className="flex shrink-0 flex-col items-center">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl font-black text-white shadow-sm"
              style={{ backgroundColor: color }}
            >
              {result.grade}
            </span>
            <span className="mt-1 text-[10px] font-semibold text-slate-400">등급</span>
          </div>
        </div>
      </div>

      {/* 점수 + 레이더 */}
      <div className="grid grid-cols-1 items-center gap-4 px-6 py-6 sm:grid-cols-2">
        <div className="flex flex-col items-center gap-2">
          <ScoreGauge score={result.totalScore} grade={result.grade} />
          <p className="text-sm font-medium text-slate-500">종합 상권 점수</p>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600">
            실데이터 {liveCount}/9 반영
          </span>
        </div>
        <RadarChart factors={result.factors} />
      </div>

      {/* 핵심 인사이트 3가지 */}
      <div className="px-6 pb-2">
        <InsightList insights={buildInsights(result)} />
      </div>

      {/* 팩터별 상세 */}
      <div className="space-y-3.5 px-6 py-6">
        {result.factors.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-700">
                {f.label}
                {f.source === "live" ? (
                  <span className="ml-1.5 align-middle text-[10px] font-semibold text-emerald-600">● 실데이터</span>
                ) : (
                  <span className="ml-1.5 align-middle text-[10px] text-slate-300">○ 데모</span>
                )}
              </span>
              <span className="font-bold tabular-nums text-slate-800">{f.score}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${f.score}%`, backgroundColor: color }}
              />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.detail}</p>
          </div>
        ))}
      </div>

      {/* 푸터 */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-3">
        <span className="text-[11px] text-slate-400">
          {result.demo ? "※ 데모 데이터 기반 — API 키 연결 시 실데이터로 전환" : "공공데이터 실시간 반영"}
        </span>
        <span className="text-[11px] text-slate-300">
          {result.generatedAt ? new Date(result.generatedAt).toLocaleString("ko-KR") : ""}
        </span>
      </div>
    </div>
  );
}

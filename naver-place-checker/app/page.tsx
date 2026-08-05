"use client";

import { useState } from "react";
import type { DiagnoseResult, DiagnosisRow } from "@/lib/types";

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<DiagnoseResult | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const q = url.trim();
    if (!q || loading) return;
    setLoading(true);
    setRes(null);
    try {
      const r = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: q }),
      });
      setRes((await r.json()) as DiagnoseResult);
    } catch {
      setRes({
        ok: false,
        errorCode: "UPSTREAM",
        error: "요청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <section className="hero">
        <span className="badge">
          <span className="dot" />
          네이버 플레이스 세팅 진단
        </span>
        <h1>
          내 가게 플레이스,
          <br />
          <span className="accent">제대로 세팅</span>됐을까요?
        </h1>
        <p>
          네이버 플레이스 주소만 붙여넣으면 필수 항목을 점검하고, 부족한 부분에
          대한 권고안을 항목별로 알려드립니다.
        </p>

        <form className="search" onSubmit={run}>
          <input
            type="text"
            inputMode="url"
            placeholder="네이버 플레이스 주소 붙여넣기"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="네이버 플레이스 주소"
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "진단 중…" : "진단하기"}
          </button>
        </form>
        <p className="hint">
          네이버 플레이스 주소를 붙여 넣어 주세요.{" "}
          <span className="sub">(네이버맵 → 매장 → 공유 → URL 복사)</span>
        </p>
      </section>

      {loading && (
        <div className="state">
          <div className="spinner" />
          <p style={{ color: "var(--muted)", margin: 0 }}>
            네이버 플레이스를 불러오는 중입니다…
          </p>
        </div>
      )}

      {res && !res.ok && (
        <div className="state error" role="alert">
          <div className="x">!</div>
          <div>
            <b>진단할 수 없습니다</b>
            <p>{res.error}</p>
          </div>
        </div>
      )}

      {res && res.ok && res.place && res.rows && res.score && (
        <Result res={res} />
      )}

      <footer className="foot">
        공개 플레이스 페이지에서 확인 가능한 항목만 진단합니다. 대표키워드·스마트콜·통계
        등 관리자(스마트플레이스 로그인) 전용 항목은 포함하지 않습니다.
        <br />
        데이터는 실시간 조회이며 저장하지 않습니다.
      </footer>
    </main>
  );
}

function Result({ res }: { res: DiagnoseResult }) {
  const { place, rows, score } = res;
  if (!place || !rows || !score) return null;
  const pct = score.total ? Math.round((score.done / score.total) * 100) : 0;
  const grade =
    pct >= 90 ? "우수" : pct >= 70 ? "양호" : pct >= 50 ? "보통" : "개선 필요";

  // ring gauge
  const R = 40;
  const C = 2 * Math.PI * R;
  const off = C * (1 - pct / 100);

  return (
    <section className="result">
      <div className="summary">
        <div className="gauge">
          <svg width="92" height="92" viewBox="0 0 92 92">
            <circle
              cx="46"
              cy="46"
              r={R}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="8"
            />
            <circle
              cx="46"
              cy="46"
              r={R}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={off}
              transform="rotate(-90 46 46)"
              style={{ transition: "stroke-dashoffset .7s ease" }}
            />
          </svg>
          <div className="num">
            {pct}
            <small>점</small>
          </div>
        </div>

        <div className="meta">
          <h2>{place.name}</h2>
          <div className="chips">
            {place.category && <span className="chip">{place.category}</span>}
            <span className="chip">업종군 · {place.bizTypeLabel}</span>
            <span className="chip brand">
              <a href={place.url} target="_blank" rel="noreferrer">
                플레이스 열기 ↗
              </a>
            </span>
          </div>
        </div>

        <div className="grade">
          <div className="g">{grade}</div>
          <div className="s">
            필수 {score.done}/{score.total} 완료
          </div>
        </div>
      </div>

      <div className="tablecard">
        <table>
          <thead>
            <tr>
              <th className="col-item">필수 항목</th>
              <th className="col-status">현재 상태</th>
              <th className="col-rec">권고</th>
              <th className="col-note">비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="legend">
        <span>
          <i className="mark ok">✓</i> 등록됨
        </span>
        <span>
          <i className="mark no">✕</i> 미등록 · 권고
        </span>
        <span>
          <i className="mark opt">–</i> 선택 연동
        </span>
        <span>
          <i className="mark num">#</i> 리뷰(숫자)
        </span>
      </div>
    </section>
  );
}

function Row({ row }: { row: DiagnosisRow }) {
  const mark =
    row.kind === "number" ? (
      <i className="mark num">#</i>
    ) : row.ok === true ? (
      <i className="mark ok">✓</i>
    ) : row.kind === "optional" ? (
      <i className="mark opt">–</i>
    ) : (
      <i className="mark no">✕</i>
    );

  const statusEl =
    row.kind === "number" ? (
      <span className="big">{row.status}</span>
    ) : row.ok ? (
      <span className="val">{row.status}</span>
    ) : row.kind === "optional" ? (
      <span className="val opt">{row.status}</span>
    ) : (
      <span className="val miss">{row.status}</span>
    );

  return (
    <tr>
      <td className="col-item" data-label="필수 항목">
        <div className="item">
          {mark}
          {row.label}
        </div>
      </td>
      <td className="col-status status" data-label="현재 상태">
        {statusEl}
      </td>
      <td className="col-rec" data-label="권고">
        {row.recommend ? (
          <div className="rec has">{row.recommend}</div>
        ) : (
          <span className="rec empty">—</span>
        )}
      </td>
      <td className="col-note note" data-label="비고">
        {row.note}
      </td>
    </tr>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, IndustryResult, LatLng } from "@/lib/sangkwon/types";
import { INDUSTRIES } from "@/lib/sangkwon/industries";
import ResultInfographic, { InsightList } from "./ResultInfographic";

declare global {
  interface Window {
    kakao: any;
  }
}

const SEOUL_CENTER: LatLng = { lat: 37.5665, lng: 126.978 };
const KAKAO_JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

export default function SangkwonClient() {
  const mapRef = useRef<HTMLDivElement>(null);
  const kakaoMapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<{ center: LatLng; label: string } | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"overall" | "industry">("overall");

  useEffect(() => {
    setTab("overall");
  }, [result]);

  const placeMarker = useCallback((center: LatLng, label: string) => {
    const kakao = window.kakao;
    if (!kakao || !kakaoMapRef.current) return;
    const pos = new kakao.maps.LatLng(center.lat, center.lng);
    if (!markerRef.current) {
      markerRef.current = new kakao.maps.Marker({ position: pos });
      markerRef.current.setMap(kakaoMapRef.current);
    } else {
      markerRef.current.setPosition(pos);
    }
    kakaoMapRef.current.panTo(pos);
    setSelected({ center, label });
    // 새 위치를 고르면 이전 분석 결과·안내를 지워 혼동 방지
    setResult(null);
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    if (!KAKAO_JS_KEY) return;
    const scriptId = "kakao-map-sdk";
    const init = () => {
      window.kakao.maps.load(() => {
        if (!mapRef.current) return;
        const kakao = window.kakao;
        const map = new kakao.maps.Map(mapRef.current, {
          center: new kakao.maps.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng),
          level: 6,
        });
        kakaoMapRef.current = map;
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        map.addControl(new kakao.maps.MapTypeControl(), kakao.maps.ControlPosition.TOPRIGHT);
        map.setZoomable(true);
        kakao.maps.event.addListener(map, "click", (e: any) => {
          const latlng = e.latLng;
          placeMarker({ lat: latlng.getLat(), lng: latlng.getLng() }, "지도에서 선택한 위치");
        });
        setMapReady(true);
      });
    };
    if (document.getElementById(scriptId)) {
      if (window.kakao?.maps) init();
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&autoload=false&libraries=services`;
    script.onload = init;
    script.onerror = () => setError("카카오 지도 SDK 로드 실패 — JavaScript 키/도메인 설정을 확인하세요.");
    document.head.appendChild(script);
  }, [placeMarker]);

  const zoom = (delta: number) => {
    const map = kakaoMapRef.current;
    if (!map) return;
    map.setLevel(map.getLevel() + delta);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/sangkwon/geocode?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "검색에 실패했습니다.");
        return;
      }
      const label = data.placeName || data.roadAddress || data.address || query;
      placeMarker(data.center, label);
      // 검색 결과 주소로 서울 외 지역이면 즉시 안내 (분석 전 사전 고지)
      const addr: string = data.roadAddress || data.address || "";
      if (addr && !/^서울/.test(addr)) {
        setNotice(`선택하신 위치는 서울 외 지역(${addr.split(" ")[0]})으로 보입니다. 이 서비스는 서울 지역만 분석합니다.`);
      }
    } catch {
      setError("검색 중 오류가 발생했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    setResult(null);
    try {
      const res = await fetch("/api/sangkwon/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selected.center, address: selected.label }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "분석에 실패했습니다.");
        return;
      }
      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch {
      setError("분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  const useDemoLocation = () => placeMarker(SEOUL_CENTER, "서울시청 (데모 기준점)");

  return (
    <div className="space-y-4">
      {/* ── 검색 + 분석 컨트롤 바 (sticky) ── */}
      <div className="sticky top-[4.5rem] z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg shadow-slate-900/5 backdrop-blur sm:p-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="주소·장소명 검색 (예: 강남역, 중구 명동)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="shrink-0 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:opacity-50"
          >
            {searching ? "검색중…" : "검색"}
          </button>
        </form>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                selected ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </span>
            <span className="min-w-0 truncate">
              {selected ? (
                <span className="font-semibold text-slate-800">{selected.label}</span>
              ) : (
                <span className="text-slate-400">지도를 클릭하거나 검색해 위치를 선택하세요</span>
              )}
            </span>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={!selected || analyzing}
            className="shrink-0 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-500/30 transition hover:from-indigo-700 hover:to-blue-600 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
          >
            {analyzing ? (
              <span className="flex items-center gap-2">
                <Spinner /> 분석중…
              </span>
            ) : (
              "상권 분석하기"
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}
      {notice && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="mt-0.5 shrink-0">🚫</span>
          <span>{notice}</span>
        </p>
      )}

      {/* ── 지도 ── */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
        {KAKAO_JS_KEY ? (
          <div ref={mapRef} className="h-[300px] w-full sm:h-[350px]" />
        ) : (
          <div className="flex h-[300px] w-full flex-col items-center justify-center gap-3 px-6 text-center sm:h-[350px]">
            <p className="max-w-sm text-sm text-slate-500">
              카카오 지도 키가 설정되면 여기에 서울 지도가 표시됩니다.
            </p>
            <button
              onClick={useDemoLocation}
              className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
            >
              데모 위치(서울시청)로 선택
            </button>
          </div>
        )}
        {mapReady && (
          <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md">
            <button onClick={() => zoom(-1)} aria-label="확대" className="h-9 w-9 text-lg font-bold text-slate-600 hover:bg-slate-50">
              +
            </button>
            <button onClick={() => zoom(1)} aria-label="축소" className="h-9 w-9 border-t border-slate-200 text-lg font-bold text-slate-600 hover:bg-slate-50">
              −
            </button>
          </div>
        )}
        {mapReady && (
          <p className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm">
            휠·버튼으로 확대/축소 후 지도를 클릭해 위치 선택
          </p>
        )}
      </div>

      {/* ── 결과 ── */}
      <div ref={resultRef} className="scroll-mt-24">
        {result ? (
          result.notSeoul ? (
            <NotSeoulCard result={result} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
                <button
                  onClick={() => setTab("overall")}
                  className={`rounded-xl py-2.5 text-sm font-semibold transition ${
                    tab === "overall" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  종합 분석
                </button>
                <button
                  onClick={() => setTab("industry")}
                  className={`rounded-xl py-2.5 text-sm font-semibold transition ${
                    tab === "industry" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  업종별 심층 🔍
                </button>
              </div>

              {tab === "overall" ? (
                <ResultInfographic result={result} />
              ) : (
                <IndustryPanel center={result.center} areaName={result.areaName} />
              )}
            </div>
          )
        ) : (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-blue-50 text-3xl">
              📊
            </div>
            <p className="text-sm font-semibold text-slate-600">위치를 선택하고 “상권 분석하기”를 누르세요</p>
            <p className="max-w-xs text-xs text-slate-400">
              종합 상권 점수와 9개 팩터 인포그래픽, 업종별 심층 분석을 확인할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}

function NotSeoulCard({ result }: { result: AnalysisResult }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
      <div className="text-5xl">🚫</div>
      <p className="text-lg font-bold text-amber-900">서울 지역만 분석할 수 있어요</p>
      <p className="text-sm leading-relaxed text-amber-800">
        선택하신 위치는 <b>{result.sido ?? "서울 외"}</b>
        {result.areaName ? ` (${result.areaName})` : ""} 입니다.
        <br />이 서비스는 <b>서울시 상권 데이터</b> 기반이라 서울 안에서만 분석됩니다.
      </p>
    </div>
  );
}

function IndustryPanel({ center, areaName }: { center: LatLng; areaName: string }) {
  const [industry, setIndustry] = useState(INDUSTRIES[0].id);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<IndustryResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/sangkwon/industry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...center, industry }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error ?? "업종 분석에 실패했습니다.");
        return;
      }
      setRes(d);
    } catch {
      setErr("업종 분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div>
        <h3 className="text-base font-bold text-slate-900">업종별 심층 분석</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          {areaName} 기준 · 특정 업종의 매출·고객·개폐업·경쟁을 봅니다.
        </p>
      </div>
      <div className="flex gap-2">
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
        >
          {INDUSTRIES.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={loading}
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "분석중…" : "이 업종 분석"}
        </button>
      </div>
      {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
      {!res && !loading && !err && (
        <p className="py-6 text-center text-xs text-slate-400">
          업종을 고르고 <b>이 업종 분석</b>을 누르면 서울 실데이터 기반 상세가 나옵니다.
        </p>
      )}
      {res && <IndustryCard res={res} />}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-center">
      <div className="text-lg font-bold" style={{ color: color ?? "#0f172a" }}>
        {value}
      </div>
      <div className="text-[11px] text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function IndustryCard({ res }: { res: IndustryResult }) {
  const s = res.seoul;
  const eok = s ? Math.round(s.salesAmt / 1e8).toLocaleString() : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold text-slate-900">{res.industryLabel}</span>
        {res.source === "live" && (
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
            실데이터
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="경쟁강도" value={`${res.competition}`} color="#dc2626" sub="높을수록 치열" />
        <Stat label="기회지수" value={`${res.opportunity}`} color="#059669" sub="높을수록 유리" />
        <Stat
          label="반경 500m 동종점포"
          value={res.nearbyStores != null ? `${res.nearbyStores.toLocaleString()}` : "—"}
          sub="카카오"
        />
        <Stat
          label="분기 추정매출"
          value={eok ? `${eok}억` : "—"}
          color="#2563eb"
          sub={s ? `${res.areaName} · ${s.quarter}` : "서울"}
        />
      </div>

      {s && (
        <div className="space-y-2 rounded-xl border border-slate-100 p-4">
          <p className="text-xs font-bold text-slate-700">서울 업종 실데이터 상세</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
            <div>주 고객 <b className="text-slate-800">{[s.mainAge, s.mainGender].filter(Boolean).join(" ") || "—"}</b></div>
            <div>피크 시간대 <b className="text-slate-800">{s.peakTime ?? "—"}</b></div>
            <div>동 내 점포수 <b className="text-slate-800">{s.storeCount.toLocaleString()}개</b></div>
            <div>프랜차이즈 <b className="text-slate-800">{s.franchiseRate.toFixed(0)}%</b></div>
            <div>개업률 <b className="text-emerald-600">{s.openRate.toFixed(1)}%</b></div>
            <div>폐업률 <b className="text-red-600">{s.closeRate.toFixed(1)}%</b></div>
          </div>
        </div>
      )}

      <InsightList insights={res.insights} title="업종 핵심 인사이트" />

      <p className="text-[11px] leading-relaxed text-slate-400">{res.note}</p>
    </div>
  );
}

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

  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<{ center: LatLng; label: string } | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      placeMarker(data.center, data.placeName || data.roadAddress || data.address || query);
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
    } catch {
      setError("분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzing(false);
    }
  };

  const useDemoLocation = () => placeMarker(SEOUL_CENTER, "서울시청 (데모 기준점)");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
      {/* 좌: 지도 + 검색 */}
      <div className="space-y-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="주소 또는 장소명 검색 (예: 강남역, 서울시 중구 명동)"
            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {searching ? "검색중…" : "검색"}
          </button>
        </form>

        <div className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50">
          {KAKAO_JS_KEY ? (
            <div ref={mapRef} className="w-full h-[460px]" />
          ) : (
            <div className="w-full h-[460px] flex flex-col items-center justify-center text-center px-6 gap-3">
              <p className="text-sm text-gray-500 max-w-sm">
                카카오 지도 키가 설정되면 여기에 서울 지도가 표시됩니다.
              </p>
              <button
                onClick={useDemoLocation}
                className="rounded-xl bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900"
              >
                데모 위치(서울시청)로 선택
              </button>
            </div>
          )}
          {mapReady && (
            <div className="absolute bottom-3 right-3 flex flex-col rounded-lg overflow-hidden shadow-md border border-gray-200">
              <button onClick={() => zoom(-1)} aria-label="확대" className="w-9 h-9 bg-white text-lg font-bold text-gray-700 hover:bg-gray-50">
                +
              </button>
              <button onClick={() => zoom(1)} aria-label="축소" className="w-9 h-9 bg-white text-lg font-bold text-gray-700 hover:bg-gray-50 border-t border-gray-200">
                −
              </button>
            </div>
          )}
          {mapReady && (
            <p className="absolute bottom-3 left-3 text-[11px] bg-white/85 rounded px-2 py-1 text-gray-500">
              휠·버튼으로 확대/축소 후 지도를 클릭해 위치를 선택하세요
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
          <div className="min-w-0 text-sm">
            {selected ? (
              <>
                <span className="text-gray-400">선택됨: </span>
                <span className="font-medium text-gray-800">{selected.label}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {selected.center.lat.toFixed(5)}, {selected.center.lng.toFixed(5)}
                </span>
              </>
            ) : (
              <span className="text-gray-400">분석할 위치를 지도에서 선택하거나 검색하세요.</span>
            )}
          </div>
          <button
            onClick={handleAnalyze}
            disabled={!selected || analyzing}
            className="shrink-0 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {analyzing ? "분석중…" : "상권 분석하기"}
          </button>
        </div>

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* 우: 결과 */}
      <div>
        {result ? (
          result.notSeoul ? (
            <NotSeoulCard result={result} />
          ) : (
            <div className="space-y-3">
              {/* 상단 탭 */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
                <button
                  onClick={() => setTab("overall")}
                  className={`rounded-lg py-2 text-sm font-semibold transition ${
                    tab === "overall" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                  }`}
                >
                  종합 분석
                </button>
                <button
                  onClick={() => setTab("industry")}
                  className={`rounded-lg py-2 text-sm font-semibold transition ${
                    tab === "industry" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500"
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
          <div className="rounded-2xl border border-dashed border-gray-300 h-full min-h-[460px] flex flex-col items-center justify-center text-center px-6 gap-2">
            <div className="text-4xl">📊</div>
            <p className="text-sm font-medium text-gray-500">위치를 선택하고 &ldquo;상권 분석하기&rdquo;를 누르면</p>
            <p className="text-sm text-gray-400">종합 상권 점수 → 업종별 심층 분석을 탭으로 볼 수 있습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NotSeoulCard({ result }: { result: AnalysisResult }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 min-h-[460px] flex flex-col items-center justify-center text-center gap-3">
      <div className="text-5xl">🚫</div>
      <p className="text-base font-bold text-amber-900">서울 지역만 분석할 수 있어요</p>
      <p className="text-sm text-amber-800 leading-relaxed">
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
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 space-y-4">
      <div>
        <h3 className="text-base font-bold text-gray-900">업종별 심층 분석</h3>
        <p className="text-xs text-gray-400">
          {areaName} 기준 · 특정 업종의 매출·고객·개폐업·경쟁을 봅니다.
        </p>
      </div>
      <div className="flex gap-2">
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm bg-white"
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
          className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "분석중…" : "이 업종 분석"}
        </button>
      </div>
      {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
      {!res && !loading && !err && (
        <p className="text-xs text-gray-400 py-6 text-center">
          업종을 고르고 <b>이 업종 분석</b>을 누르면 서울 실데이터 기반 상세가 나옵니다.
        </p>
      )}
      {res && <IndustryCard res={res} />}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3 text-center">
      <div className="text-lg font-bold" style={{ color: color ?? "#111827" }}>
        {value}
      </div>
      <div className="text-[11px] text-gray-500">{label}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function IndustryCard({ res }: { res: IndustryResult }) {
  const s = res.seoul;
  const eok = s ? Math.round(s.salesAmt / 1e8).toLocaleString() : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold text-gray-900">{res.industryLabel}</span>
        {res.source === "live" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">실데이터</span>
        )}
      </div>

      {/* 핵심 지표 */}
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

      {/* 서울 업종 상세 */}
      {s && (
        <div className="rounded-xl border border-gray-100 p-4 space-y-2">
          <p className="text-xs font-bold text-gray-700">서울 업종 실데이터 상세</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-600">
            <div>주 고객 <b className="text-gray-800">{[s.mainAge, s.mainGender].filter(Boolean).join(" ") || "—"}</b></div>
            <div>피크 시간대 <b className="text-gray-800">{s.peakTime ?? "—"}</b></div>
            <div>동 내 점포수 <b className="text-gray-800">{s.storeCount.toLocaleString()}개</b></div>
            <div>프랜차이즈 <b className="text-gray-800">{s.franchiseRate.toFixed(0)}%</b></div>
            <div>개업률 <b className="text-emerald-600">{s.openRate.toFixed(1)}%</b></div>
            <div>폐업률 <b className="text-red-600">{s.closeRate.toFixed(1)}%</b></div>
          </div>
        </div>
      )}

      {/* 업종 인사이트 3가지 */}
      <InsightList insights={res.insights} title="업종 핵심 인사이트" />

      <p className="text-[11px] text-gray-400 leading-relaxed">{res.note}</p>
    </div>
  );
}

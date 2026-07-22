"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, LatLng } from "@/lib/sangkwon/types";
import ResultInfographic from "./ResultInfographic";

// 카카오 지도 SDK 는 전역에 window.kakao 를 올린다.
declare global {
  interface Window {
    kakao: any;
  }
}

const SEOUL_CENTER: LatLng = { lat: 37.5665, lng: 126.978 }; // 서울시청

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

  // 지도 SDK 로드
  useEffect(() => {
    if (!KAKAO_JS_KEY) return; // 키 없으면 지도 대신 안내 표시
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
        // 클릭 → 위치 선택
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

  // 주소/장소 검색
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

  // 분석 실행
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

  // 키 없이도 데모 흐름 가능: 서울시청 기준
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
                카카오 지도 JavaScript 키(<code>NEXT_PUBLIC_KAKAO_JS_KEY</code>)가 설정되면
                여기에 서울 지도가 표시됩니다. 키 없이도 아래 버튼으로 분석 흐름을 미리 볼 수 있어요.
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
            <p className="absolute bottom-2 left-2 text-[11px] bg-white/85 rounded px-2 py-1 text-gray-500">
              확대/축소 후 지도를 클릭해 위치를 선택하세요
            </p>
          )}
        </div>

        {/* 선택 상태 + 분석 버튼 */}
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

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}
      </div>

      {/* 우: 결과 인포그래픽 */}
      <div>
        {result ? (
          <ResultInfographic result={result} />
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 h-full min-h-[460px] flex flex-col items-center justify-center text-center px-6 gap-2">
            <div className="text-4xl">📊</div>
            <p className="text-sm font-medium text-gray-500">
              위치를 선택하고 &ldquo;상권 분석하기&rdquo;를 누르면
            </p>
            <p className="text-sm text-gray-400">
              9개 팩터 기반 상권 점수 인포그래픽이 여기에 표시됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

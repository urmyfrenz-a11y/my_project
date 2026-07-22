import SangkwonClient from "./SangkwonClient";

const FACTORS = [
  "점포 현황",
  "유동인구",
  "배후 수요",
  "소비력",
  "매출 수준",
  "경쟁·동태",
  "임대료·권리금",
  "입지·접근성",
  "집객시설",
];

export default function SangkwonPage() {
  return (
    <div className="flex min-h-full flex-col bg-slate-50 text-slate-900">
      {/* ── 상단 내비게이션 (sticky) ── */}
      <header className="sticky top-0 z-30 h-16 border-b border-slate-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-4xl items-center justify-between px-5">
          <a href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-500 shadow-sm shadow-indigo-500/30">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-extrabold tracking-tight text-slate-900">서울 상권분석</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Sangkwon Score
              </span>
            </span>
          </a>
          <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            공공데이터 9종 실시간 연동
          </span>
        </div>
      </header>

      <main className="flex-1">
        {/* ── 히어로 ── */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-indigo-50/80 via-white to-slate-50" />
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
            style={{ background: "radial-gradient(closest-side, #a5b4fc, transparent)" }}
          />
          <div className="relative mx-auto max-w-4xl px-5 pb-6 pt-12 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-semibold text-indigo-600 shadow-sm">
              서울 한정 · 공공데이터 기반 상권 리포트
            </span>
            <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.6rem] sm:leading-[1.1]">
              지도로 찾는{" "}
              <span className="bg-gradient-to-r from-indigo-600 to-blue-500 bg-clip-text text-transparent">
                우리 동네 상권 점수
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-500 sm:text-base">
              위치를 선택하거나 주소를 검색하면 9개 팩터로 상권을 분석해 종합 점수와 한 장의 인포그래픽으로 보여줍니다.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-1.5">
              {FACTORS.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-500"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── 지도 + 분석 ── */}
        <section className="mx-auto max-w-4xl px-5 pb-20">
          <SangkwonClient />
        </section>
      </main>

      {/* ── 푸터 ── */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-2 px-5 py-6 text-center text-xs text-slate-400 sm:flex-row sm:text-left">
          <p>© 2026 서울 상권분석 · 지도로 찾는 상권 점수</p>
          <p className="text-[11px]">
            데이터: 서울 열린데이터광장 · 소상공인시장진흥공단 · 한국부동산원 R-ONE · 카카오
          </p>
        </div>
      </footer>
    </div>
  );
}

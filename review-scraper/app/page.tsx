// 장소 리뷰 수집기 — 카카오맵 · 네이버맵 · 구글맵
import ReviewClient from "./ReviewClient";

const SOURCES = [
  { label: "카카오맵", dot: "bg-amber-400" },
  { label: "네이버맵", dot: "bg-emerald-500" },
  { label: "구글맵", dot: "bg-red-500" },
];

export default function Home() {
  return (
    <main className="relative overflow-hidden">
      {/* decorative background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px] bg-gradient-to-b from-indigo-100/70 via-[var(--bg)] to-[var(--bg)] dark:from-indigo-950/40"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-120px] -z-10 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-600/20"
      />

      {/* single shared-width container: hero + client are identical width */}
      <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-14 sm:pt-20">
        <header className="text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
              <path
                d="M12 2C8 2 5 5 5 8.7 5 13.6 12 21 12 21s7-7.4 7-12.3C19 5 16 2 12 2z"
                fill="#fff"
              />
              <circle cx="12" cy="8.6" r="2.6" fill="#7c3aed" />
            </svg>
          </div>

          <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[40px]">
            장소 리뷰,{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              한 번에 수집
            </span>
          </h1>
          <p className="mx-auto mt-3.5 max-w-lg text-[15px] leading-relaxed text-muted sm:text-base">
            카카오맵 · 네이버맵 · 구글맵의 리뷰를 검색 한 번으로 모아 요약을
            보여주고, 전체 리뷰를 txt 파일로 내려받을 수 있습니다.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {SOURCES.map((s) => (
              <span
                key={s.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card/70 px-3 py-1 text-xs font-medium text-muted backdrop-blur"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </span>
            ))}
          </div>

        </header>

        <div className="mt-10">
          <ReviewClient />
        </div>

        <footer className="mt-16">
          <p className="mb-2 text-sm font-semibold text-muted">사용시 유의사항</p>
          <div className="space-y-2 rounded-xl border border-line p-4 text-xs leading-relaxed text-muted">
            <p>
              리뷰 작성자 정보는 익명 처리되어 표시됩니다 · 개인 · 연구 목적으로만
              이용하시기 바랍니다.
            </p>
            <p>리뷰는 최신순으로 최대 100개만 가져옵니다.</p>
            <p>
              네이버맵과 구글맵 리뷰는 API 호출 월간 한도를 초과할 경우 리뷰
              데이터를 가져오지 못할 수 있습니다.
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}

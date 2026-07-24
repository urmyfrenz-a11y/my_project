import ReviewClient from "./ReviewClient";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          장소 리뷰 수집기
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          구글맵 · 카카오맵 · 네이버 플레이스의 리뷰를 통합 스키마로 수집합니다.
        </p>
      </header>
      <ReviewClient />
    </main>
  );
}

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
    <main className="flex-1 bg-gradient-to-b from-slate-50 to-white">
      {/* 히어로 */}
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-8 text-center">
        <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
          서울 한정 · 공공데이터 기반
        </span>
        <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">
          지도로 찾는 <span className="text-blue-600">우리 동네 상권 점수</span>
        </h1>
        <p className="mt-3 text-gray-500 max-w-2xl mx-auto text-sm sm:text-base">
          서울 지도를 확대·축소해 위치를 클릭하거나 주소를 검색하면, 9개 팩터로 상권을 분석해
          한 장의 인포그래픽과 종합 상권 점수로 도출합니다.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {FACTORS.map((f) => (
            <span
              key={f}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500"
            >
              {f}
            </span>
          ))}
        </div>
      </section>

      {/* 지도 + 분석 */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <SangkwonClient />
      </section>
    </main>
  );
}

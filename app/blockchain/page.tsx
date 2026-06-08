"use client";
// 블록체인 강의 실습 홈페이지 — 강사가 이 URL(/blockchain)을 공유하면
// 수강생 50명이 접속해 개념별 인터랙티브 실습 + 실시간 공유 장부를 체험합니다.

import { useEffect, useRef, useState } from "react";
import { getSupabase, uid } from "./lib";
import { LedgerSection, CentralVsDistributed, DoubleSpend, HashSection } from "./sections-basics";
import { SignatureSection, TransactionSection, BlockSection, ChainSection } from "./sections-crypto";
import { ConsensusSection, PowSection, PosSection, FiftyOneSection } from "./sections-consensus";
import { AppsSection } from "./sections-apps";

const NAV = [
  { id: "intro", label: "들어가며", emoji: "🚀" },
  { id: "ledger", label: "장부", emoji: "📒" },
  { id: "central", label: "중앙 vs 분산", emoji: "🌐" },
  { id: "doublespend", label: "이중지불 문제", emoji: "⚠️" },
  { id: "hash", label: "해시", emoji: "🔢" },
  { id: "signature", label: "공개키·서명", emoji: "🔑" },
  { id: "transaction", label: "트랜잭션", emoji: "📝" },
  { id: "block", label: "블록", emoji: "📦" },
  { id: "chain", label: "체인·불변성", emoji: "⛓️" },
  { id: "consensus", label: "합의", emoji: "🤝" },
  { id: "pow", label: "작업증명·채굴", emoji: "⛏️" },
  { id: "pos", label: "지분증명", emoji: "🪙" },
  { id: "attack51", label: "51% 공격", emoji: "💥" },
  { id: "apps", label: "암호화폐·스마트컨트랙트", emoji: "🤖" },
];

export default function BlockchainPage() {
  const [joined, setJoined] = useState(false);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("main");
  const [online, setOnline] = useState(1);
  const [active, setActive] = useState("intro");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const presenceRef = useRef<any>(null);
  const clientId = useRef(uid());

  // 저장된 이름/방 복원 + URL ?room= 지원
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get("room");
    if (urlRoom) setRoom(urlRoom.slice(0, 30));
    const saved = localStorage.getItem("bc_name");
    if (saved) setName(saved);
  }, []);

  // 현재 보고 있는 섹션 추적(내비 하이라이트)
  useEffect(() => {
    if (!joined) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    NAV.forEach((n) => {
      const el = document.getElementById(n.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [joined]);

  async function join() {
    const nm = name.trim() || `수강생-${clientId.current.slice(0, 4)}`;
    setName(nm);
    localStorage.setItem("bc_name", nm);
    setJoined(true);

    // 페이지뷰 기록(있으면) — 실패해도 무시
    fetch(`${"https://ywofxncimmukmjldcyuk.supabase.co"}/rest/v1/rpc/increment_page_view`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: "sb_publishable_MVVFMcNJK7yfsFIMCikrvQ_ief-0CNV",
        Authorization: "Bearer sb_publishable_MVVFMcNJK7yfsFIMCikrvQ_ief-0CNV",
      },
      body: JSON.stringify({ page_slug: "blockchain" }),
    }).catch(() => {});

    // 실시간 접속자 수(presence)
    try {
      const sb = await getSupabase();
      const ch = sb.channel(`presence-${room}`, {
        config: { presence: { key: clientId.current } },
      });
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        setOnline(Object.keys(state).length || 1);
      });
      ch.subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") await ch.track({ name: nm, at: Date.now() });
      });
      presenceRef.current = ch;
    } catch { /* 오프라인이어도 실습은 동작 */ }
  }

  useEffect(() => () => { if (presenceRef.current) presenceRef.current.unsubscribe(); }, []);

  if (!joined) {
    return <JoinGate name={name} setName={setName} room={room} setRoom={setRoom} onJoin={join} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* 상단 바 */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold">
            <span className="text-xl">⛓️</span> 블록체인 체험 교실
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-slate-500">교실 <code className="font-mono text-slate-700">{room}</code></span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> 접속 {online}명
            </span>
            <span className="rounded-full bg-indigo-50 text-indigo-700 px-3 py-1 font-semibold">{name}</span>
          </div>
        </div>
        {/* 모바일 가로 내비 */}
        <nav className="lg:hidden border-t border-slate-100 overflow-x-auto">
          <div className="flex gap-1 px-3 py-2 w-max">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`}
                className={`whitespace-nowrap text-xs px-2.5 py-1 rounded-full ${active === n.id ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                {n.emoji} {n.label}
              </a>
            ))}
          </div>
        </nav>
      </header>

      <div className="max-w-6xl mx-auto px-4 flex gap-8">
        {/* 데스크톱 사이드 내비 */}
        <aside className="hidden lg:block w-56 shrink-0 py-8">
          <div className="sticky top-20">
            <div className="text-xs font-bold text-slate-400 mb-2 px-3">학습 순서</div>
            <ul className="space-y-0.5">
              {NAV.map((n, i) => (
                <li key={n.id}>
                  <a href={`#${n.id}`}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition ${active === n.id ? "bg-indigo-600 text-white font-semibold" : "text-slate-600 hover:bg-slate-100"}`}>
                    <span className="text-xs opacity-60 w-4">{i === 0 ? "" : i}</span>
                    <span>{n.emoji}</span>
                    <span className="truncate">{n.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* 본문 */}
        <main className="flex-1 min-w-0 pb-24">
          <Hero />
          <LedgerSection room={room} me={name} />
          <CentralVsDistributed />
          <DoubleSpend />
          <HashSection />
          <SignatureSection />
          <TransactionSection />
          <BlockSection />
          <ChainSection />
          <ConsensusSection />
          <PowSection />
          <PosSection />
          <FiftyOneSection />
          <AppsSection />
          <Wrapup />
        </main>
      </div>
    </div>
  );
}

function JoinGate({
  name, setName, room, setRoom, onJoin,
}: {
  name: string; setName: (s: string) => void; room: string; setRoom: (s: string) => void; onJoin: () => void;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-600 to-indigo-800 flex items-center justify-center p-4 text-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">⛓️</div>
          <h1 className="text-3xl font-bold">블록체인 체험 교실</h1>
          <p className="text-indigo-200 mt-2">직접 만지면서 배우는 블록체인의 원리<br />— 장부부터 스마트컨트랙트까지</p>
        </div>
        <div className="bg-white rounded-2xl p-6 text-slate-800 shadow-2xl">
          <label className="block mb-4">
            <span className="block text-sm font-semibold text-slate-600 mb-1">이름(닉네임)</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onJoin()}
              placeholder="예: 김철수"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </label>
          <label className="block mb-5">
            <span className="block text-sm font-semibold text-slate-600 mb-1">교실 코드 <span className="font-normal text-slate-400">(강사 안내값, 보통 그대로)</span></span>
            <input value={room} onChange={(e) => setRoom(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </label>
          <button onClick={onJoin}
            className="w-full rounded-lg bg-indigo-600 text-white font-bold py-3 hover:bg-indigo-700 transition">
            교실 입장하기 →
          </button>
          <p className="text-xs text-slate-400 mt-3 text-center">같은 교실 코드를 입력한 사람끼리 장부를 실시간으로 공유합니다.</p>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section id="intro" className="scroll-mt-24 py-10">
      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 text-white p-8 sm:p-10">
        <span className="inline-block text-xs font-bold tracking-widest bg-white/20 px-3 py-1 rounded-full mb-4">블록체인 입문 실습</span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">만지면서 이해하는<br />블록체인의 원리</h1>
        <p className="mt-4 text-indigo-100 max-w-2xl leading-relaxed">
          블록체인은 어려운 수학이 아니라 <b className="text-white">몇 개의 단순한 아이디어가 쌓인 구조</b>입니다.
          왼쪽 순서대로 따라오면, "왜 은행 없이도 돈이 작동하는가"가 자연스럽게 이해됩니다.
          각 단계마다 <b className="text-white">직접 버튼을 누르고 값을 바꿔 보세요.</b>
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-sm">
          {["장부", "해시", "블록·체인", "합의(PoW/PoS)", "51% 공격", "스마트컨트랙트"].map((t) => (
            <span key={t} className="bg-white/15 px-3 py-1 rounded-full">{t}</span>
          ))}
        </div>
      </div>

      <div className="mt-8 grid sm:grid-cols-3 gap-4">
        {[
          { t: "❶ 왜 필요한가", d: "장부 · 중앙 vs 분산 · 이중지불 문제로 '풀어야 할 숙제'를 먼저 봅니다." },
          { t: "❷ 어떻게 만드는가", d: "해시 · 공개키/서명 · 트랜잭션 · 블록 · 체인으로 위조 불가능한 장부를 조립합니다." },
          { t: "❸ 어떻게 합의·응용하는가", d: "합의 · PoW/PoS · 51% 공격 · 암호화폐 · 스마트컨트랙트로 마무리합니다." },
        ].map((c) => (
          <div key={c.t} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="font-bold text-slate-800 mb-1">{c.t}</div>
            <p className="text-sm text-slate-600 leading-relaxed">{c.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Wrapup() {
  return (
    <section className="py-12 border-t border-slate-200">
      <h2 className="text-2xl font-bold text-slate-900 mb-4">🎓 전체 흐름 한눈에 정리</h2>
      <div className="rounded-2xl bg-slate-900 text-slate-100 p-6 leading-relaxed">
        <p className="mb-3">오늘 배운 조각들이 어떻게 하나로 이어지는지 다시 보세요:</p>
        <ol className="space-y-2 text-sm">
          <li><b className="text-indigo-300">문제</b> — 중앙(은행) 없이 디지털 돈을 쓰려면 <b>이중지불</b>을 막아야 한다.</li>
          <li><b className="text-indigo-300">기록</b> — 거래(트랜잭션)에 <b>디지털 서명</b>을 붙여 "내 돈은 나만" 쓰게 한다.</li>
          <li><b className="text-indigo-300">봉인</b> — 거래를 <b>블록</b>에 담고 <b>해시</b>로 봉인, 블록을 <b>체인</b>으로 이어 위조하면 들통나게 한다(불변성).</li>
          <li><b className="text-indigo-300">합의</b> — <b>PoW/PoS</b>로 블록 만들기를 비싸게 만들고, "가장 긴 체인"에 모두가 동의한다.</li>
          <li><b className="text-indigo-300">한계</b> — 누가 <b>과반(51%)</b>을 쥐면 위험. 그래서 충분한 분산이 곧 보안.</li>
          <li><b className="text-indigo-300">응용</b> — 이 장부 위에서 <b>암호화폐</b>와 <b>스마트컨트랙트</b>가 돌아간다.</li>
        </ol>
      </div>
      <p className="text-center text-sm text-slate-400 mt-8">수고하셨습니다! 위로 올라가 값을 바꿔 가며 다시 실험해 보세요. 🔁</p>
    </section>
  );
}

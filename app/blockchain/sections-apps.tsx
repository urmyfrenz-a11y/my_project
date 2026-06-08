"use client";
// 섹션 14: 응용 — 암호화폐와 스마트컨트랙트

import { useState } from "react";
import { SectionCard, Explain, Lab, KeyNote, Btn, Badge } from "./ui";

const CONTRACT_CODE = `contract 모금 {
  목표액 = 100코인;
  마감 = 있음;
  모인돈 = 0;

  function 후원(금액) {
    모인돈 += 금액;       // 후원이 들어오면 합산
  }

  function 마감처리() {
    if (모인돈 >= 목표액)  // 목표 달성 시
      창작자에게_송금(모인돈);   //  → 자동으로 창작자에게
    else                  // 실패 시
      후원자에게_전액환불();     //  → 자동으로 전원 환불
  }
}`;

export function AppsSection() {
  const GOAL = 100;
  const [pledges, setPledges] = useState<{ who: string; amt: number }[]>([]);
  const [closed, setClosed] = useState(false);
  const total = pledges.reduce((s, p) => s + p.amt, 0);
  const success = total >= GOAL;
  const names = ["철수", "영희", "민수", "지우", "수빈"];

  function pledge() {
    if (closed) return;
    const who = names[pledges.length % names.length];
    const amt = [20, 30, 15, 40, 25][pledges.length % 5];
    setPledges((p) => [...p, { who, amt }]);
  }

  return (
    <SectionCard id="apps" step="14" title="응용: 암호화폐와 스마트컨트랙트"
      subtitle="장부 위에서 '돈'과 '자동 계약'이 돌아간다">
      <Explain>
        <p>
          지금까지 만든 <b>위조 불가능한 공유 장부</b> 위에서 두 가지가 자연스럽게 태어납니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>암호화폐(Cryptocurrency):</b> 장부에 기록되는 그 "코인"이 곧 돈입니다. 비트코인은 이
            장부를 <b>'돈을 주고받는 용도'</b>에 집중한 것이고요. 거래를 처리하는 채굴자/검증자에게 주는
            <b> 수수료(가스)</b>가 시스템을 돌아가게 합니다.
          </li>
          <li>
            <b>스마트컨트랙트(Smart Contract):</b> 장부 위에 <b>'조건이 충족되면 자동 실행되는 코드'</b>를
            올릴 수 있습니다(이더리움이 대표적). 중개인 없이 <b>약속이 코드대로 자동 집행</b>됩니다 —
            "목표 금액이 모이면 송금, 아니면 환불" 같은 규칙을요.
          </li>
        </ul>
      </Explain>

      <Lab title="스마트컨트랙트 체험 — '조건부 자동 모금' 계약을 실행해 보세요">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1">📜 배포된 계약 코드 (사람이 못 고침 · 자동 실행)</div>
            <pre className="rounded-xl bg-slate-900 text-slate-200 p-4 text-[12px] leading-relaxed overflow-auto font-mono">{CONTRACT_CODE}</pre>
          </div>

          <div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-end justify-between mb-1">
                <span className="text-sm font-semibold text-slate-700">모인 금액</span>
                <span className="font-mono"><b className="text-indigo-700 text-lg">{total}</b> / {GOAL} 코인</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden mb-3">
                <div className={`h-full transition-all ${success ? "bg-emerald-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(100, (total / GOAL) * 100)}%` }} />
              </div>

              <div className="space-y-1 max-h-28 overflow-auto mb-3 text-sm">
                {pledges.length === 0 && <p className="text-slate-400">아직 후원이 없습니다.</p>}
                {pledges.map((p, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-slate-600">{p.who} 후원</span>
                    <span className="font-mono text-slate-700">+{p.amt}</span>
                  </div>
                ))}
              </div>

              {!closed ? (
                <div className="flex gap-2">
                  <Btn onClick={pledge}>후원하기</Btn>
                  <Btn variant="amber" onClick={() => setClosed(true)} disabled={pledges.length === 0}>마감 처리 실행</Btn>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
                    계약이 <b>자동으로</b> 판단했습니다:
                    <div className="mt-1">
                      {success
                        ? <span className="text-emerald-700">✅ 목표 달성 → <b>창작자에게 {total}코인 자동 송금</b></span>
                        : <span className="text-rose-600">↩️ 목표 미달 → <b>후원자 전원에게 자동 환불</b></span>}
                    </div>
                  </div>
                  <Badge ok={success} okText="계약 성공적으로 집행됨 (중개인 0명)" badText="환불 실행됨 (중개인 0명)" />
                  <div><Btn variant="ghost" onClick={() => { setPledges([]); setClosed(false); }} className="!py-1">다시 하기</Btn></div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>중요한 건 <b>중개인이 없다</b>는 점입니다. 은행·플랫폼·변호사가 약속을 보증하는 대신,
            <b> 코드와 모두가 검증하는 장부</b>가 그 역할을 합니다.</p>
          <p>이 원리로 디파이(탈중앙 금융), NFT, 탈중앙 신원·투표 등 수많은 응용이 만들어집니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

"use client";
// 섹션 1~4: 장부 · 중앙집중 vs 분산 · 이중지불 · 해시

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SectionCard, Explain, Lab, KeyNote, Btn, Field, Badge, inputCls,
} from "./ui";
import {
  Tx, fetchLedger, addTx, resetRoom, getSupabase, computeBalances, sha256,
} from "./lib";

// ════════════════════════════════════════════════════════════════
// 섹션 2 — 장부(Ledger): 50명이 실시간으로 공유하는 하나의 장부
// ════════════════════════════════════════════════════════════════
export function LedgerSection({ room, me }: { room: string; me: string }) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    fetchLedger(room).then((rows) => {
      if (!alive) return;
      rows.forEach((r) => seen.current.add(r.id));
      setTxs(rows);
    }).catch(() => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any;
    getSupabase().then((sb) => {
      channel = sb
        .channel(`ledger-${room}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "bc_transactions", filter: `room=eq.${room}` },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload: any) => {
            const t = payload.new as Tx;
            if (seen.current.has(t.id)) return;
            seen.current.add(t.id);
            setTxs((prev) => [...prev, t]);
          },
        )
        .subscribe();
    });
    return () => {
      alive = false;
      if (channel) channel.unsubscribe();
    };
  }, [room]);

  const balances = useMemo(() => computeBalances(txs), [txs]);

  async function send() {
    setErr("");
    if (!recipient.trim()) return setErr("받는 사람을 입력하세요");
    if (recipient.trim() === me) return setErr("자기 자신에게는 보낼 수 없어요");
    if (amount <= 0) return setErr("금액은 1 이상이어야 합니다");
    if ((balances[me] ?? 100) < amount) return setErr("잔액이 부족합니다");
    setBusy(true);
    try {
      await addTx(room, me, recipient.trim(), amount);
      setRecipient("");
    } catch {
      setErr("전송 실패 — 잠시 후 다시 시도하세요");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm("이 교실의 장부를 모두 초기화할까요? (강사용)")) return;
    await resetRoom(room);
    seen.current.clear();
    setTxs([]);
  }

  const people = Object.keys(balances).sort();

  return (
    <SectionCard id="ledger" step="2" title="장부(Ledger)란?" subtitle="블록체인은 결국 '거래 기록 장부'입니다">
      <Explain>
        <p>
          은행을 떠올려 보세요. 누가 누구에게 얼마를 보냈는지 적어 둔 <b>거래 기록부(장부)</b>가 있고,
          그 기록을 보면 각자의 잔액을 알 수 있습니다. 블록체인도 똑같이 <b>장부</b>에서 출발합니다.
          다른 점은 <b>이 장부를 한 곳이 아니라 모두가 똑같이 나눠 갖는다</b>는 것뿐이에요.
        </p>
        <p>
          아래는 지금 이 강의를 듣는 <b>모든 사람이 공유하는 단 하나의 장부</b>입니다. 여러분이 거래를
          추가하면, 50명의 화면에 <b>실시간으로 똑같이</b> 나타납니다. 모두 100코인으로 시작합니다.
        </p>
      </Explain>

      <Lab title="공유 장부에 거래를 추가해 보세요">
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          {/* 입력 + 장부 */}
          <div>
            <div className="flex flex-wrap items-end gap-3 mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-sm">
                <span className="text-slate-500">보내는 사람</span>
                <div className="font-bold text-indigo-700">{me}</div>
              </div>
              <div className="text-slate-400 pb-1">→</div>
              <div className="w-36">
                <Field label="받는 사람">
                  <input className={inputCls} value={recipient}
                    onChange={(e) => setRecipient(e.target.value)} placeholder="예: 영희" />
                </Field>
              </div>
              <div className="w-24">
                <Field label="금액">
                  <input type="number" min={1} className={inputCls} value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))} />
                </Field>
              </div>
              <Btn onClick={send} disabled={busy}>{busy ? "전송 중…" : "거래 추가"}</Btn>
            </div>
            {err && <p className="text-rose-600 text-sm mb-3">{err}</p>}

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[40px_1fr_1fr_70px] bg-slate-100 text-xs font-bold text-slate-600 px-3 py-2">
                <span>#</span><span>보낸 사람</span><span>받는 사람</span><span className="text-right">금액</span>
              </div>
              <div className="max-h-72 overflow-auto divide-y divide-slate-100">
                {txs.length === 0 && (
                  <div className="px-3 py-8 text-center text-slate-400 text-sm">아직 거래가 없습니다. 첫 거래를 추가해 보세요!</div>
                )}
                {txs.map((t, i) => (
                  <div key={t.id} className="grid grid-cols-[40px_1fr_1fr_70px] px-3 py-2 text-sm items-center">
                    <span className="text-slate-400">{i + 1}</span>
                    <span className={t.sender === me ? "font-bold text-indigo-700" : ""}>{t.sender}</span>
                    <span className={t.recipient === me ? "font-bold text-indigo-700" : ""}>{t.recipient}</span>
                    <span className="text-right font-mono text-slate-700">{Number(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 잔액판 */}
          <div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-bold text-slate-500 mb-2">실시간 잔액 (시작 100코인)</div>
              <div className="space-y-1.5 max-h-72 overflow-auto">
                {people.length === 0 && <div className="text-slate-400 text-sm">거래가 생기면 표시됩니다</div>}
                {people.map((p) => (
                  <div key={p} className="flex items-center justify-between text-sm">
                    <span className={p === me ? "font-bold text-indigo-700" : "text-slate-700"}>{p}</span>
                    <span className={`font-mono font-semibold ${balances[p] < 0 ? "text-rose-600" : "text-slate-800"}`}>
                      {balances[p]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={reset} className="mt-2 text-xs text-slate-400 hover:text-rose-600">장부 초기화 (강사용)</button>
          </div>
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p><b>장부 = 거래의 목록.</b> 잔액은 따로 저장하지 않고 "거래를 처음부터 다 더하면" 나옵니다.</p>
          <p>방금 여러분은 모두가 같은 장부를 보고 있다는 걸 확인했습니다. 그렇다면 질문 — <b>이 장부를 누가 보관해야 할까요?</b></p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 3 — 중앙집중형 vs 분산형
// ════════════════════════════════════════════════════════════════
export function CentralVsDistributed() {
  const [mode, setMode] = useState<"central" | "distributed">("central");
  const [downCentral, setDownCentral] = useState(false);
  const [downNodes, setDownNodes] = useState<Set<number>>(new Set());

  const nodes = [0, 1, 2, 3, 4, 5];
  const aliveCount = nodes.length - downNodes.size;
  const networkUp = mode === "central" ? !downCentral : aliveCount > nodes.length / 2;

  function toggleNode(i: number) {
    setDownNodes((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  }

  return (
    <SectionCard id="central" step="3" title="중앙집중형 vs 분산형"
      subtitle="장부를 '한 곳'이 보관할 때와 '모두'가 보관할 때의 차이">
      <Explain>
        <p>
          앞의 장부를 <b>은행 한 곳</b>이 보관한다고 해봅시다(중앙집중형). 편리하지만, 그 한 곳이
          멈추거나 해킹당하거나 기록을 몰래 고치면 모두가 피해를 봅니다. 모든 권한이 한 곳에 있으니까요.
        </p>
        <p>
          블록체인은 반대로 <b>장부의 복사본을 수많은 참가자(노드)가 각자 보관</b>합니다(분산형).
          몇몇이 고장 나도 나머지가 같은 장부를 갖고 있어 시스템은 멈추지 않습니다.
          아래에서 노드를 직접 꺼 보세요.
        </p>
      </Explain>

      <Lab>
        <div className="flex gap-2 mb-5">
          <Btn variant={mode === "central" ? "primary" : "ghost"} onClick={() => setMode("central")}>중앙집중형</Btn>
          <Btn variant={mode === "distributed" ? "primary" : "ghost"} onClick={() => setMode("distributed")}>분산형</Btn>
        </div>

        <div className="relative rounded-xl bg-slate-50 border border-slate-200 p-6 min-h-[260px] flex items-center justify-center">
          {mode === "central" ? (
            <div className="flex flex-col items-center gap-6">
              <button onClick={() => setDownCentral((v) => !v)}
                className={`w-28 h-28 rounded-2xl flex flex-col items-center justify-center text-white font-bold shadow-lg transition ${downCentral ? "bg-slate-400 line-through" : "bg-indigo-600"}`}>
                <span className="text-3xl">🏦</span>중앙 서버
              </button>
              <div className="flex gap-6">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex flex-col items-center">
                    <div className={`w-px h-6 ${downCentral ? "bg-rose-300" : "bg-slate-300"}`} />
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl ${downCentral ? "bg-slate-200 opacity-50" : "bg-white border border-slate-300"}`}>👤</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">서버를 눌러 꺼 보세요</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-5">
              {nodes.map((i) => {
                const down = downNodes.has(i);
                return (
                  <button key={i} onClick={() => toggleNode(i)}
                    className={`w-20 h-20 rounded-xl flex flex-col items-center justify-center text-xs font-semibold transition ${down ? "bg-slate-200 text-slate-400 line-through" : "bg-white border-2 border-emerald-400 text-emerald-700"}`}>
                    <span className="text-2xl">🖥️</span>노드 {i + 1}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Badge ok={networkUp} okText="네트워크 정상 작동" badText="시스템 마비 — 장부 사용 불가" />
          {mode === "distributed" && (
            <span className="text-sm text-slate-500">살아있는 노드 {aliveCount} / {nodes.length}</span>
          )}
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p><b>중앙집중형:</b> 한 곳만 무너져도 전체가 멈춤 (단일 실패 지점).</p>
          <p><b>분산형:</b> 과반수만 살아 있으면 계속 작동 — 그래서 "왜 과반수인가?"가 뒤의 <b>합의</b>로 이어집니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 4 — 이중지불 문제
// ════════════════════════════════════════════════════════════════
export function DoubleSpend() {
  const [balance] = useState(100);
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);
  const [spent, setSpent] = useState(0);

  function trySpend(to: string) {
    const ok = spent + 100 <= balance;
    if (ok) setSpent((s) => s + 100);
    setLog((l) => [
      ...l,
      ok
        ? { text: `✅ ${to}에게 100코인 전송 성공 (잔액 ${balance - spent - 100})`, ok: true }
        : { text: `❌ ${to}에게 100코인 전송 실패 — 이미 다 써서 잔액 0`, ok: false },
    ]);
  }

  return (
    <SectionCard id="doublespend" step="4" title="이중지불 문제"
      subtitle="블록체인이 풀려고 만든 바로 그 문제">
      <Explain>
        <p>
          디지털 데이터는 <b>복사가 공짜</b>입니다. 사진 파일을 100명에게 보내도 내 사진은 그대로 남죠.
          그런데 "돈"이 이러면 큰일입니다. 내가 가진 100코인을 <b>철수에게도 100, 영희에게도 100</b>
          동시에 보내 버리면? 똑같은 돈을 두 번 쓰는 <b>이중지불</b>이 됩니다.
        </p>
        <p>
          은행이 있으면 간단합니다. 은행이 "잔액 0원이니 두 번째 거래는 거절!"이라고 막아 주니까요.
          하지만 <b>중앙의 은행이 없는</b> 블록체인은 이걸 어떻게 막을까요? 직접 시도해 보세요.
        </p>
      </Explain>

      <Lab title="100코인으로 두 번 결제를 시도해 보세요">
        <div className="flex items-center gap-4 mb-4">
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 px-4 py-3">
            <div className="text-xs text-indigo-500 font-semibold">내 잔액</div>
            <div className="text-2xl font-bold text-indigo-700">{balance - spent}<span className="text-sm font-normal"> 코인</span></div>
          </div>
          <div className="flex gap-2">
            <Btn variant="amber" onClick={() => trySpend("철수")}>철수에게 100 보내기</Btn>
            <Btn variant="amber" onClick={() => trySpend("영희")}>영희에게 100 보내기</Btn>
          </div>
          <Btn variant="ghost" onClick={() => { setSpent(0); setLog([]); }}>처음으로</Btn>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 min-h-[100px] space-y-1 text-sm">
          {log.length === 0 && <p className="text-slate-400">두 버튼을 빠르게 눌러 같은 돈을 두 번 써 보세요.</p>}
          {log.map((l, i) => (
            <p key={i} className={l.ok ? "text-emerald-700" : "text-rose-600"}>{l.text}</p>
          ))}
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>두 번째 결제가 막히려면 <b>"누구 거래가 먼저인지"에 모두가 동의</b>해야 합니다.</p>
          <p>이 "순서에 대한 합의"를 은행 없이 이루는 방법 — 그게 블록체인의 핵심이고, 이제부터 그 부품들(<b>해시 · 블록 · 체인 · 합의</b>)을 하나씩 배웁니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 5 — 해시(Hash)
// ════════════════════════════════════════════════════════════════
export function HashSection() {
  const [text, setText] = useState("안녕하세요 블록체인");
  const [hash, setHash] = useState("");
  const [altHash, setAltHash] = useState("");

  useEffect(() => {
    let alive = true;
    sha256(text).then((h) => alive && setHash(h));
    // 한 글자만 바꾼 버전(눈사태 효과 비교용)
    const alt = text.length ? text.slice(0, -1) + (text.slice(-1) === "." ? "!" : ".") : ".";
    sha256(alt).then((h) => alive && setAltHash(h));
    return () => { alive = false; };
  }, [text]);

  // 두 해시에서 다른 글자를 강조
  const diff = useMemo(() => {
    return hash.split("").map((c, i) => c !== altHash[i]);
  }, [hash, altHash]);

  return (
    <SectionCard id="hash" step="5" title="해시(Hash)"
      subtitle="어떤 데이터든 '고유한 지문'으로 바꾸는 함수">
      <Explain>
        <p>
          <b>해시 함수</b>는 아무리 긴 글이든 짧은 글이든 넣으면 <b>항상 똑같은 길이의 암호 같은 문자열</b>
          (여기서는 64자리)을 내놓는 계산기입니다. 블록체인은 <b>SHA-256</b>이라는 해시를 씁니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>같은 입력 → 항상 같은 출력</b> (지문처럼 고유)</li>
          <li><b>한 글자만 바뀌어도 결과가 완전히 달라짐</b> (눈사태 효과)</li>
          <li><b>거꾸로(출력 → 입력) 되돌리는 건 사실상 불가능</b></li>
        </ul>
      </Explain>

      <Lab title="직접 입력해 해시가 바뀌는 걸 확인하세요">
        <textarea className={`${inputCls} h-20 font-sans`} value={text}
          onChange={(e) => setText(e.target.value)} />
        <div className="mt-4 grid gap-3">
          <div className="rounded-xl bg-slate-900 p-4">
            <div className="text-xs text-slate-400 mb-1">SHA-256 해시 (입력 길이와 무관하게 항상 64자리)</div>
            <code className="font-mono text-[12px] break-all text-emerald-300">{hash}</code>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs text-slate-500 mb-1">↑ 마지막 글자 하나만 바꾸면? (빨간 부분이 달라진 자리)</div>
            <code className="font-mono text-[12px] break-all">
              {altHash.split("").map((c, i) => (
                <span key={i} className={diff[i] ? "bg-rose-200 text-rose-800" : "text-slate-400"}>{c}</span>
              ))}
            </code>
          </div>
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>해시는 <b>"데이터가 조금이라도 바뀌면 즉시 표가 난다"</b>는 성질을 줍니다.</p>
          <p>바로 이 성질로 다음 단계에서 <b>블록을 봉인</b>하고, 그 블록들을 <b>체인으로 묶어</b> 위조를 막습니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

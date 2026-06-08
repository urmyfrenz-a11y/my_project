"use client";
// 섹션 10~13: 합의 · 작업증명(PoW)·채굴 · 지분증명(PoS) · 51% 공격

import { useRef, useState } from "react";
import {
  SectionCard, Explain, Lab, KeyNote, Btn, Field, Badge, inputCls,
} from "./ui";
import { hashBlock, leadingZeros } from "./lib";

// ════════════════════════════════════════════════════════════════
// 섹션 10 — 합의(Consensus): 가장 긴 체인이 이긴다
// ════════════════════════════════════════════════════════════════
export function ConsensusSection() {
  const [chainA, setChainA] = useState(3); // 정직한 체인 길이
  const [chainB, setChainB] = useState(3); // 경쟁 체인 길이
  const winner = chainA === chainB ? "동률" : chainA > chainB ? "A" : "B";

  return (
    <SectionCard id="consensus" step="10" title="합의(Consensus)"
      subtitle="누구도 대장이 아닌데, 어떻게 하나의 장부에 동의할까?">
      <Explain>
        <p>
          분산형에서는 수천 명이 각자 장부를 갖습니다. 그런데 두 사람이 거의 동시에 새 블록을 만들면
          장부가 잠깐 <b>두 갈래</b>로 갈라질 수 있어요. 누구 말이 맞을까요? 대장이 없으니 정해야 합니다.
        </p>
        <p>
          비트코인의 규칙은 단순합니다: <b>"가장 긴(가장 많은 노력이 쌓인) 체인을 모두가 정답으로 인정한다."</b>
          이 규칙 하나로, 멀리 떨어진 수천 명이 결국 <b>같은 장부</b>에 수렴합니다. 이것이 <b>합의</b>입니다.
        </p>
      </Explain>

      <Lab title="두 갈래로 갈라진 체인 — 네트워크는 더 긴 쪽을 택합니다">
        <div className="grid sm:grid-cols-2 gap-4">
          {([["A", chainA, setChainA], ["B", chainB, setChainB]] as const).map(([name, len, set]) => (
            <div key={name} className={`rounded-xl border-2 p-3 ${winner === name ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold">체인 {name}</span>
                {winner === name && <span className="text-xs font-bold text-emerald-600">← 채택됨</span>}
              </div>
              <div className="flex flex-wrap gap-1 mb-3 min-h-[28px]">
                {Array.from({ length: len }).map((_, i) => (
                  <div key={i} className="w-6 h-6 rounded bg-indigo-500 text-white text-[10px] flex items-center justify-center">{i}</div>
                ))}
              </div>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => set((v) => v + 1)} className="!py-1 !px-3">블록 추가 (+1 채굴)</Btn>
                <Btn variant="ghost" onClick={() => set((v) => Math.max(1, v - 1))} className="!py-1 !px-3">−1</Btn>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center">
          {winner === "동률"
            ? <span className="text-sm text-slate-500">동률 — 다음 블록이 나오는 순간 더 길어진 쪽으로 결정됩니다.</span>
            : <Badge ok okText={`체인 ${winner}가 정답으로 합의됨 (더 긴 체인)`} badText="" />}
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>"가장 긴 체인이 이긴다"가 성립하려면, 블록 만들기에 <b>진짜 노력(비용)</b>이 들어야 합니다.
            공짜라면 누구나 긴 가짜 체인을 만들 테니까요.</p>
          <p>그 "노력"을 만드는 두 가지 방식이 바로 <b>작업증명(PoW)</b>과 <b>지분증명(PoS)</b>입니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 11 — 작업증명(PoW)과 채굴
// ════════════════════════════════════════════════════════════════
export function PowSection() {
  const [data, setData] = useState("철수→영희 10코인");
  const [difficulty, setDifficulty] = useState(4); // 앞에 0이 몇 개
  const [nonce, setNonce] = useState(0);
  const [hash, setHash] = useState("");
  const [mining, setMining] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const stop = useRef(false);

  const target = "0".repeat(difficulty);
  const found = hash.startsWith(target) && hash !== "";

  async function mine() {
    setMining(true); stop.current = false;
    let n = 0, tries = 0;
    const start = performance.now();
    while (!stop.current) {
      const h = await hashBlock({ index: 0, data, prev: "0", nonce: n });
      tries++;
      if (leadingZeros(h) >= difficulty) {
        setNonce(n); setHash(h); setAttempts(tries);
        setElapsed((performance.now() - start) / 1000);
        break;
      }
      // 1000번마다 화면 갱신 + UI 양보
      if (tries % 800 === 0) {
        setNonce(n); setHash(h); setAttempts(tries);
        setElapsed((performance.now() - start) / 1000);
        await new Promise((r) => setTimeout(r, 0));
      }
      n++;
    }
    setMining(false);
  }

  return (
    <SectionCard id="pow" step="11" title="작업증명(PoW)과 채굴(Mining)"
      subtitle="블록을 봉인하려면 '어려운 퍼즐'을 풀어야 한다">
      <Explain>
        <p>
          작업증명은 이렇게 말합니다. <b>"블록의 해시가 0으로 여러 개 시작하도록, 논스(nonce)라는 숫자를
          맞춰 와라."</b> 해시는 거꾸로 계산이 안 되니, 방법은 하나 — 논스를 <b>0, 1, 2, 3…</b>
          무식하게 바꿔 가며 <b>될 때까지 시도</b>하는 것뿐입니다. 이 노가다가 바로 <b>채굴</b>이에요.
        </p>
        <p>
          0의 개수(<b>난이도</b>)를 늘릴수록 평균 시도 횟수가 폭발적으로 늘어납니다. 그래서 블록 위조에는
          <b> 막대한 계산(전기·시간)</b>이 필요하고, 정직하게 따라가는 게 이득이 됩니다. 직접 채굴해 보세요.
        </p>
      </Explain>

      <Lab title="난이도를 정하고 '채굴 시작'을 눌러 보세요">
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div className="grow min-w-[200px]"><Field label="블록 데이터">
            <input className={inputCls} value={data} onChange={(e) => setData(e.target.value)} />
          </Field></div>
          <Field label={`난이도 (앞자리 0의 개수: ${difficulty})`}>
            <input type="range" min={1} max={6} value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))} className="w-40" />
          </Field>
        </div>
        <div className="flex gap-2 mb-4">
          {!mining
            ? <Btn onClick={mine}>⛏️ 채굴 시작</Btn>
            : <Btn variant="danger" onClick={() => { stop.current = true; }}>중지</Btn>}
          <Btn variant="ghost" onClick={() => { setHash(""); setNonce(0); setAttempts(0); setElapsed(0); }}>초기화</Btn>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-3 text-center">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-xs text-slate-500">찾은 논스</div>
            <div className="text-xl font-bold font-mono text-slate-800">{nonce.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-xs text-slate-500">시도 횟수</div>
            <div className="text-xl font-bold font-mono text-slate-800">{attempts.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-xs text-slate-500">걸린 시간</div>
            <div className="text-xl font-bold font-mono text-slate-800">{elapsed.toFixed(1)}초</div>
          </div>
        </div>
        <div className="rounded-lg bg-slate-900 p-3">
          <div className="text-xs text-slate-400 mb-1">목표: <span className="text-amber-300 font-mono">{target}…</span> 으로 시작하는 해시</div>
          <code className="font-mono text-[12px] break-all">
            <span className={found ? "text-emerald-300 font-bold" : "text-amber-300"}>{hash.slice(0, difficulty)}</span>
            <span className="text-slate-300">{hash.slice(difficulty)}</span>
          </code>
          <div className="mt-2">{found && <Badge ok okText="채굴 성공! 유효한 블록을 찾았습니다" badText="" />}</div>
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>난이도 1~2와 5~6을 비교해 보세요. <b>0 하나 늘 때마다 평균 16배</b> 어려워집니다.</p>
          <p>이 "어려움"이 곧 <b>보안</b>입니다. 과거를 위조하려면 그 뒤 모든 블록을 <b>다시 채굴</b>해야 하니까요.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 12 — 지분증명(PoS)
// ════════════════════════════════════════════════════════════════
export function PosSection() {
  const validators = [
    { name: "철수", stake: 50 },
    { name: "영희", stake: 30 },
    { name: "민수", stake: 15 },
    { name: "지우", stake: 5 },
  ];
  const total = validators.reduce((s, v) => s + v.stake, 0);
  const [winner, setWinner] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [rolling, setRolling] = useState(false);

  function pickOnce(): string {
    let r = Math.random() * total;
    for (const v of validators) { r -= v.stake; if (r <= 0) return v.name; }
    return validators[0].name;
  }

  async function simulate(n: number) {
    setRolling(true);
    const c: Record<string, number> = {};
    for (let i = 0; i < n; i++) { const w = pickOnce(); c[w] = (c[w] ?? 0) + 1; }
    setCounts(c); setWinner(pickOnce()); setRolling(false);
  }

  return (
    <SectionCard id="pos" step="12" title="지분증명(PoS)"
      subtitle="전기를 태우는 대신, '지분을 건' 사람에게 기록 권한을">
      <Explain>
        <p>
          작업증명은 안전하지만 <b>전기를 엄청나게 씁니다.</b> 그래서 등장한 게 <b>지분증명</b>입니다.
          퍼즐을 푸는 대신, 코인을 <b>예치(스테이킹)</b>한 사람들 중에서 <b>지분에 비례한 확률</b>로
          다음 블록 기록자를 뽑습니다. 많이 건 사람이 뽑힐 확률이 높죠.
        </p>
        <p>
          만약 그 사람이 <b>부정한 블록</b>을 만들면, 예치한 코인을 <b>몰수(슬래싱)</b>당합니다. "정직한 게
          이득"이 되도록 설계한 거예요. 이더리움도 2022년에 PoW에서 PoS로 바꿨습니다.
        </p>
      </Explain>

      <Lab title="지분에 비례해 기록자가 뽑히는지 시뮬레이션해 보세요">
        <div className="space-y-2 mb-4">
          {validators.map((v) => {
            const pct = Math.round((v.stake / total) * 100);
            const got = counts[v.name] ?? 0;
            const gotPct = Object.values(counts).reduce((s, x) => s + x, 0)
              ? Math.round((got / Object.values(counts).reduce((s, x) => s + x, 0)) * 100) : 0;
            return (
              <div key={v.name} className={`rounded-lg border p-2 ${winner === v.name ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold">{v.name} <span className="text-slate-400 font-normal">예치 {v.stake} ({pct}%)</span></span>
                  {Object.keys(counts).length > 0 && <span className="text-xs text-slate-500">당첨 {got}회 ({gotPct}%)</span>}
                </div>
                <div className="h-2 rounded bg-slate-100 overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Btn onClick={() => simulate(1)} disabled={rolling}>1번 뽑기</Btn>
          <Btn variant="ghost" onClick={() => simulate(1000)} disabled={rolling}>1000번 시뮬레이션</Btn>
        </div>
        {winner && <p className="mt-3 text-sm">이번 블록 기록자: <b className="text-emerald-700">{winner}</b></p>}
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>1000번 돌려 보면 <b>당첨 비율 ≈ 예치 비율</b>로 수렴합니다. 지분이 곧 영향력이죠.</p>
          <p><b>PoW</b>는 "계산 능력", <b>PoS</b>는 "예치한 돈"으로 기록 권한을 나눠 줍니다. 둘 다 핵심은
            <b> 공격이 손해가 되도록</b> 만드는 것 — 그 한계가 다음의 51% 공격입니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 13 — 51% 공격
// ════════════════════════════════════════════════════════════════
export function FiftyOneSection() {
  const [power, setPower] = useState(30); // 공격자 점유율 %
  const [result, setResult] = useState<null | { wins: number; trials: number }>(null);
  const [running, setRunning] = useState(false);

  // 간단 모델: 정직 체인이 6블록 앞선 상태에서, 공격자가 따라잡을 확률을 몬테카를로로 추정
  async function simulate() {
    setRunning(true);
    const p = power / 100;
    const trials = 2000;
    let wins = 0;
    for (let t = 0; t < trials; t++) {
      let lead = 6; // 정직 체인이 6블록 앞섬(확정까지의 격차)
      let steps = 0;
      while (lead > 0 && lead < 30 && steps < 500) {
        if (Math.random() < p) lead--; else lead++;
        steps++;
      }
      if (lead <= 0) wins++;
    }
    setResult({ wins, trials });
    setRunning(false);
  }

  const pct = result ? ((result.wins / result.trials) * 100) : null;
  const danger = power >= 50;

  return (
    <SectionCard id="attack51" step="13" title="51% 공격"
      subtitle="블록체인의 보안이 무너지는 단 하나의 조건">
      <Explain>
        <p>
          "가장 긴 체인이 이긴다"는 규칙에는 빈틈이 있습니다. 만약 누군가 <b>전체 계산력(또는 지분)의
          절반을 넘게</b> 가지면, 다른 모두를 합친 것보다 블록을 빨리 만들 수 있습니다. 그러면 자기만의
          체인을 더 길게 만들어 <b>과거 거래를 뒤집을</b> 수 있어요 (예: 보냈던 코인을 무효로 — 이중지불).
        </p>
        <p>
          이게 <b>51% 공격</b>입니다. 점유율을 바꿔 가며, 공격자가 앞선 정직 체인을 따라잡을 확률을
          시뮬레이션해 보세요. <b>50%를 넘기 전엔</b> 성공 확률이 급격히 낮아진다는 걸 볼 수 있습니다.
        </p>
      </Explain>

      <Lab title="공격자의 계산력 점유율을 조절해 보세요">
        <Field label={`공격자 점유율: ${power}%  (정직한 네트워크 ${100 - power}%)`}>
          <input type="range" min={5} max={80} value={power}
            onChange={(e) => { setPower(Number(e.target.value)); setResult(null); }} className="w-full" />
        </Field>
        <div className="my-3 h-6 rounded-full overflow-hidden flex text-[11px] font-bold text-white">
          <div className="bg-rose-500 flex items-center justify-center" style={{ width: `${power}%` }}>{power >= 12 && `공격자 ${power}%`}</div>
          <div className="bg-emerald-500 flex items-center justify-center grow">{100 - power >= 12 && `정직 ${100 - power}%`}</div>
        </div>
        <div className="flex items-center gap-3">
          <Btn variant="danger" onClick={simulate} disabled={running}>{running ? "시뮬레이션 중…" : "공격 시뮬레이션 실행 (2000회)"}</Btn>
          {danger && <span className="text-rose-600 text-sm font-bold">⚠ 50% 초과 — 사실상 언제든 성공</span>}
        </div>
        {pct !== null && (
          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-600 mb-1">6블록 앞선 거래를 뒤집는 데 성공한 비율</div>
            <div className={`text-3xl font-bold ${pct > 50 ? "text-rose-600" : pct > 5 ? "text-amber-600" : "text-emerald-600"}`}>
              {pct.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-slate-400">{result!.wins.toLocaleString()} / {result!.trials.toLocaleString()}회 성공</div>
          </div>
        )}
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>점유율을 10% → 40% → 55%로 바꿔 보세요. <b>50% 부근에서 성공 확률이 급변</b>합니다.</p>
          <p>그래서 블록체인의 보안은 "<b>아무도 과반을 갖지 못하도록 충분히 많은 참가자가 분산</b>되어 있다"는
            전제에 기댑니다. 비트코인에서 51%를 확보하는 비용은 천문학적이라 현실적으로 어렵습니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

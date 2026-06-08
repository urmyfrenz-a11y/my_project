"use client";
// 섹션 6~9: 공개키/서명 · 트랜잭션 · 블록 · 체인과 불변성

import { useEffect, useState } from "react";
import {
  SectionCard, Explain, Lab, KeyNote, Btn, Field, Badge, inputCls,
} from "./ui";
import {
  KeyPairHex, generateKeyPair, signMessage, verifyMessage, hashBlock, MiniBlock,
} from "./lib";

// ════════════════════════════════════════════════════════════════
// 섹션 6 — 공개키 / 개인키 / 디지털 서명
// ════════════════════════════════════════════════════════════════
export function SignatureSection() {
  const [kp, setKp] = useState<KeyPairHex | null>(null);
  const [message, setMessage] = useState("영희에게 10코인을 보냅니다");
  const [signature, setSignature] = useState("");
  const [tampered, setTampered] = useState("");
  const [verifyResult, setVerifyResult] = useState<null | boolean>(null);
  const [busy, setBusy] = useState(false);

  async function genKey() {
    setBusy(true);
    setKp(await generateKeyPair());
    setSignature(""); setVerifyResult(null);
    setBusy(false);
  }

  async function sign() {
    if (!kp) return;
    setBusy(true);
    const sig = await signMessage(kp.keyPair.privateKey, message);
    setSignature(sig); setTampered(message); setVerifyResult(null);
    setBusy(false);
  }

  async function verify() {
    if (!kp) return;
    setBusy(true);
    setVerifyResult(await verifyMessage(kp.publicKeyHex, tampered, signature));
    setBusy(false);
  }

  return (
    <SectionCard id="signature" step="6" title="공개키·개인키와 디지털 서명"
      subtitle="'이 거래는 진짜 내가 했다'를 은행 없이 증명하는 법">
      <Explain>
        <p>
          공유 장부에 누구나 글을 쓸 수 있다면, 내가 남의 돈을 마음대로 보낼 수도 있겠죠? 이를 막는 게
          <b> 공개키·개인키</b>입니다. 사람마다 <b>열쇠 한 쌍</b>을 가집니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>개인키</b> — 나만 아는 비밀 열쇠. <b>서명(도장)</b>을 만들 때만 씁니다.</li>
          <li><b>공개키</b> — 모두에게 공개. 누군가의 서명이 진짜인지 <b>검증</b>할 때 씁니다.</li>
          <li>공개키를 해시한 짧은 값이 곧 내 <b>계좌 주소</b>가 됩니다.</li>
        </ul>
        <p>개인키로 서명하면, <b>개인키 없이는 위조할 수 없고</b>, 공개키로 누구나 진짜임을 확인할 수 있습니다.</p>
      </Explain>

      <Lab title="① 열쇠 만들기 → ② 서명 → ③ 검증, 그리고 위조 시도">
        {!kp ? (
          <Btn onClick={genKey} disabled={busy}>🔑 내 열쇠 한 쌍 만들기</Btn>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                <div className="text-xs font-bold text-emerald-600">내 주소 (공개)</div>
                <code className="font-mono text-[11px] break-all text-emerald-800">{kp.address}</code>
              </div>
              <div className="rounded-lg bg-sky-50 border border-sky-200 p-3">
                <div className="text-xs font-bold text-sky-600">공개키 (모두 공개)</div>
                <code className="font-mono text-[11px] break-all text-sky-800">{kp.publicKeyHex.slice(0, 40)}…</code>
              </div>
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3">
                <div className="text-xs font-bold text-rose-600">개인키 (절대 비밀!)</div>
                <code className="font-mono text-[11px] break-all text-rose-800">{(kp.privateKeyJwk.d ?? "").slice(0, 30)}…</code>
              </div>
            </div>

            <Field label="① 서명할 메시지(거래 내용)">
              <input className={inputCls} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={sign} disabled={busy}>✍️ 개인키로 서명하기</Btn>
              <Btn variant="ghost" onClick={genKey} disabled={busy}>열쇠 다시 만들기</Btn>
            </div>

            {signature && (
              <>
                <div className="rounded-lg bg-slate-900 p-3">
                  <div className="text-xs text-slate-400">디지털 서명 (개인키로만 만들 수 있음)</div>
                  <code className="font-mono text-[11px] break-all text-amber-300">{signature.slice(0, 96)}…</code>
                </div>
                <Field label="② 검증할 메시지 — 한 글자라도 바꾸면 검증이 실패합니다 (위조 시도)">
                  <input className={inputCls} value={tampered} onChange={(e) => setTampered(e.target.value)} />
                </Field>
                <div className="flex items-center gap-3">
                  <Btn onClick={verify} disabled={busy}>🔎 공개키로 검증하기</Btn>
                  {verifyResult !== null && (
                    <Badge ok={verifyResult}
                      okText="진짜 — 본인이 서명한 내용 그대로"
                      badText="위조/변조됨 — 검증 실패" />
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>서명 덕분에 <b>"내 계좌의 돈은 내 개인키를 가진 나만 움직일 수 있다"</b>가 보장됩니다.</p>
          <p>이제 이 서명을 거래에 붙이면 완전한 <b>트랜잭션</b>이 됩니다.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 7 — 트랜잭션(Transaction)
// ════════════════════════════════════════════════════════════════
export function TransactionSection() {
  const [kp, setKp] = useState<KeyPairHex | null>(null);
  const [to, setTo] = useState("0x받는사람주소");
  const [amount, setAmount] = useState(10);
  const [signed, setSigned] = useState<null | { body: string; sig: string; ok: boolean }>(null);
  const [busy, setBusy] = useState(false);

  async function buildAndSign() {
    setBusy(true);
    let key = kp;
    if (!key) { key = await generateKeyPair(); setKp(key); }
    const body = JSON.stringify({ from: key.address, to, amount, nonce: Date.now() });
    const sig = await signMessage(key.keyPair.privateKey, body);
    const ok = await verifyMessage(key.publicKeyHex, body, sig);
    setSigned({ body, sig, ok });
    setBusy(false);
  }

  return (
    <SectionCard id="transaction" step="7" title="트랜잭션(Transaction)"
      subtitle="블록 안에 담기는 '서명된 거래' 한 건">
      <Explain>
        <p>
          <b>트랜잭션</b>은 장부에 올라가는 거래 한 건입니다. "누가(from) → 누구에게(to) 얼마(amount)"라는
          내용에, 보낸 사람의 <b>디지털 서명</b>이 붙어 있습니다. 서명이 있으니 <b>위조할 수 없고</b>,
          누구든 공개키로 진짜임을 확인할 수 있습니다.
        </p>
        <p>이런 트랜잭션 여러 개를 묶은 게 바로 다음에 배울 <b>블록</b>입니다.</p>
      </Explain>

      <Lab title="트랜잭션을 만들고 서명해 보세요">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44"><Field label="받는 주소">
            <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field></div>
          <div className="w-24"><Field label="금액">
            <input type="number" min={1} className={inputCls} value={amount}
              onChange={(e) => setAmount(Number(e.target.value))} />
          </Field></div>
          <Btn onClick={buildAndSign} disabled={busy}>트랜잭션 만들고 서명</Btn>
        </div>

        {signed && (
          <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden font-mono text-[12px]">
            <div className="bg-slate-900 text-slate-200 p-3 break-all">
              <span className="text-slate-400">내용: </span>{signed.body}
            </div>
            <div className="bg-slate-800 text-amber-300 p-3 break-all">
              <span className="text-slate-400">서명: </span>{signed.sig.slice(0, 80)}…
            </div>
            <div className="bg-white p-3">
              <Badge ok={signed.ok} okText="유효한 트랜잭션 — 네트워크가 받아들임" badText="무효" />
            </div>
          </div>
        )}
      </Lab>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 8 — 블록(Block)
// ════════════════════════════════════════════════════════════════
export function BlockSection() {
  const [index] = useState(1);
  const [data, setData] = useState("철수→영희 10코인, 영희→민수 3코인");
  const [prev] = useState("0000a1b2c3d4e5f6...");
  const [nonce, setNonce] = useState(0);
  const [hash, setHash] = useState("");

  useEffect(() => {
    let alive = true;
    hashBlock({ index, data, prev, nonce }).then((h) => alive && setHash(h));
    return () => { alive = false; };
  }, [index, data, prev, nonce]);

  return (
    <SectionCard id="block" step="8" title="블록(Block)"
      subtitle="트랜잭션을 한 묶음으로 포장하고 해시로 봉인">
      <Explain>
        <p>
          트랜잭션을 하나씩 처리하면 느립니다. 그래서 여러 거래를 모아 <b>한 블록</b>으로 묶습니다.
          블록 하나에는 보통 이런 게 들어갑니다:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>거래 목록</b> (이 묶음에 담긴 트랜잭션들)</li>
          <li><b>이전 블록의 해시</b> (← 이게 블록들을 사슬로 잇는 고리)</li>
          <li><b>논스(nonce)</b> (채굴에서 쓰는 숫자 — 뒤에서 배웁니다)</li>
          <li>그리고 위 전부를 합쳐 만든 <b>이 블록의 해시</b> = 봉인 도장</li>
        </ul>
      </Explain>

      <Lab title="블록의 내용을 바꾸면 해시(봉인)가 어떻게 변하는지 보세요">
        <div className="rounded-xl border-2 border-indigo-200 overflow-hidden">
          <div className="bg-indigo-600 text-white px-4 py-2 font-bold text-sm">블록 #{index}</div>
          <div className="p-4 space-y-3">
            <Field label="거래 목록(데이터)">
              <textarea className={`${inputCls} h-16`} value={data} onChange={(e) => setData(e.target.value)} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="이전 블록 해시">
                <input className={`${inputCls} font-mono text-xs`} value={prev} readOnly />
              </Field>
              <Field label="논스(nonce)">
                <div className="flex gap-2">
                  <input type="number" className={inputCls} value={nonce}
                    onChange={(e) => setNonce(Number(e.target.value))} />
                  <Btn variant="ghost" onClick={() => setNonce((n) => n + 1)}>+1</Btn>
                </div>
              </Field>
            </div>
            <div className="rounded-lg bg-slate-900 p-3">
              <div className="text-xs text-slate-400">이 블록의 해시 (봉인)</div>
              <code className="font-mono text-[12px] break-all text-emerald-300">{hash}</code>
            </div>
          </div>
        </div>
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>블록 안의 무엇이든 바꾸면 해시가 즉시 달라집니다 — <b>봉인이 깨진 게 한눈에 보입니다.</b></p>
          <p>각 블록이 <b>"이전 블록의 해시"</b>를 품고 있다는 점이 핵심. 이걸로 블록들을 줄줄이 잇습니다 → 체인.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════
// 섹션 9 — 체인(Chain)과 불변성
// ════════════════════════════════════════════════════════════════
const GENESIS_PREV = "0000000000000000000000000000000000000000000000000000000000000000";

export function ChainSection() {
  const [datas, setDatas] = useState<string[]>([
    "🌱 제네시스 블록",
    "철수→영희 10코인",
    "영희→민수 3코인",
    "민수→철수 1코인",
  ]);
  const [hashes, setHashes] = useState<string[]>([]);

  // 데이터가 바뀔 때마다 체인 전체의 해시를 앞에서부터 다시 계산
  useEffect(() => {
    let alive = true;
    (async () => {
      const hs: string[] = [];
      let prev = GENESIS_PREV;
      for (let i = 0; i < datas.length; i++) {
        const h = await hashBlock({ index: i, data: datas[i], prev, nonce: 0 });
        hs.push(h);
        prev = h;
      }
      if (alive) setHashes(hs);
    })();
    return () => { alive = false; };
  }, [datas]);

  function edit(i: number, v: string) {
    setDatas((d) => d.map((x, j) => (j === i ? v : x)));
  }

  return (
    <SectionCard id="chain" step="9" title="체인(Chain)과 불변성"
      subtitle="블록을 해시로 잇기 — 하나를 고치면 뒤가 전부 무너진다">
      <Explain>
        <p>
          각 블록은 <b>이전 블록의 해시</b>를 안에 담습니다. 그래서 블록들이 <b>사슬(체인)</b>처럼 이어지죠.
          여기서 마법이 일어납니다. 만약 누군가 <b>옛날 블록의 거래를 몰래 고치면</b>, 그 블록의 해시가
          바뀌고 → 다음 블록이 품고 있던 "이전 해시"와 어긋나고 → 그 다음도, 또 그 다음도 전부 깨집니다.
        </p>
        <p>아래에서 중간 블록의 내용을 고쳐 보세요. <b>고친 블록부터 끝까지 빨갛게</b> 변합니다.</p>
      </Explain>

      <Lab title="아무 블록이나 내용을 고쳐서 체인을 깨뜨려 보세요">
        <div className="space-y-2">
          {datas.map((d, i) => {
            const prevHash = i === 0 ? GENESIS_PREV : hashes[i - 1];
            // 깨짐 판정은 화면용으로 단순화: 첫 블록 외에는 항상 prev=직전 해시이므로
            // 여기서는 사용자가 만든 변경이 자동 전파되어 모든 해시가 재계산됨 → 항상 일관.
            // 대신 "변조 탐지"를 보이기 위해 직전 해시 표시.
            return (
              <div key={i} className="rounded-xl border-2 border-emerald-300 bg-emerald-50/40 overflow-hidden">
                <div className="flex items-center justify-between bg-white px-3 py-1.5 border-b border-emerald-200">
                  <span className="font-bold text-sm text-slate-700">블록 #{i}</span>
                  <span className="text-[11px] text-slate-400 font-mono">prev: {(prevHash ?? "").slice(0, 12)}…</span>
                </div>
                <div className="p-3 grid gap-2 sm:grid-cols-[1fr_auto] items-center">
                  <input className={`${inputCls} bg-white`} value={d} onChange={(e) => edit(i, e.target.value)} />
                  <code className="font-mono text-[11px] text-emerald-700 break-all">
                    hash: {(hashes[i] ?? "").slice(0, 16)}…
                  </code>
                </div>
              </div>
            );
          })}
        </div>
        <ChainTamperDemo />
      </Lab>

      <div className="mt-4">
        <KeyNote>
          <p>이게 <b>불변성(immutability)</b>입니다. 과거를 고치려면 그 뒤의 모든 블록을 <b>전부 다시</b> 만들어야 합니다.</p>
          <p>그런데 "다시 만드는 일"을 일부러 <b>아주 어렵게</b> 만들면 위조가 사실상 불가능해집니다 → 그게 <b>작업증명(PoW)</b>.</p>
        </KeyNote>
      </div>
    </SectionCard>
  );
}

// 변조 탐지를 분명히 보여주는 별도 데모: 봉인된 체인 vs 고친 체인
function ChainTamperDemo() {
  const blocks0: { data: string }[] = [
    { data: "A→B 5" }, { data: "B→C 2" }, { data: "C→D 1" },
  ];
  const [datas, setDatas] = useState(blocks0.map((b) => b.data));
  const [sealed, setSealed] = useState<MiniBlock[]>([]);
  const [current, setCurrent] = useState<MiniBlock[]>([]);

  async function buildChain(ds: string[]): Promise<MiniBlock[]> {
    const out: MiniBlock[] = [];
    let prev = GENESIS_PREV;
    for (let i = 0; i < ds.length; i++) {
      const base = { index: i, data: ds[i], prev, nonce: 0 };
      const hash = await hashBlock(base);
      out.push({ ...base, hash });
      prev = hash;
    }
    return out;
  }

  async function seal() {
    const chain = await buildChain(datas);
    setSealed(chain); setCurrent(chain);
  }
  useEffect(() => { seal(); /* 최초 1회 봉인 */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let alive = true;
    buildChain(datas).then((c) => alive && setCurrent(c));
    return () => { alive = false; };
  }, [datas]);

  return (
    <div className="mt-5 rounded-xl bg-slate-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-white">변조 탐지기 — 봉인된 체인과 비교</span>
        <Btn variant="ghost" onClick={seal} className="!py-1 !px-3">지금 상태로 다시 봉인</Btn>
      </div>
      <div className="flex flex-wrap gap-2">
        {datas.map((d, i) => {
          const broken = sealed[i] && current[i] && sealed[i].hash !== current[i].hash;
          return (
            <div key={i} className={`rounded-lg p-2 border-2 w-40 ${broken ? "border-rose-500 bg-rose-950" : "border-emerald-500 bg-emerald-950"}`}>
              <div className={`text-[10px] font-bold ${broken ? "text-rose-300" : "text-emerald-300"}`}>
                블록 #{i} {broken ? "⚠ 변조됨" : "✓ 정상"}
              </div>
              <input className="w-full bg-transparent text-white text-xs mt-1 border-b border-white/20 focus:outline-none"
                value={d} onChange={(e) => setDatas((p) => p.map((x, j) => j === i ? e.target.value : x))} />
              <code className="block text-[9px] text-slate-400 mt-1 break-all">{(current[i]?.hash ?? "").slice(0, 14)}…</code>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400 mt-2">먼저 체인을 봉인한 뒤, 아무 블록 글자를 고쳐 보세요. 고친 블록부터 뒤가 전부 ⚠ 변조됨으로 바뀝니다.</p>
    </div>
  );
}

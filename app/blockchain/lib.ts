// 블록체인 강의 실습 — 공통 로직 헬퍼
// 해시(SHA-256), 공개키/개인키·디지털 서명(Web Crypto), Supabase 실시간 연결을 담당합니다.

export const SUPABASE_URL = "https://ywofxncimmukmjldcyuk.supabase.co";
export const SUPABASE_KEY = "sb_publishable_MVVFMcNJK7yfsFIMCikrvQ_ief-0CNV";

// ── 0. 작은 유틸 ───────────────────────────────────────────────
export const uid = () => Math.random().toString(36).slice(2, 10);

export function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// Web Crypto 입력용: 항상 ArrayBuffer로 반환 (TS의 BufferSource 타입 충족)
export function hexToArrayBuffer(hex: string): ArrayBuffer {
  const b = hexToBytes(hex);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const enc = new TextEncoder();

// ── 1. 해시 ────────────────────────────────────────────────────
// 같은 입력 → 항상 같은 64자리(256비트) 16진수. 한 글자만 바뀌어도 완전히 달라짐(눈사태 효과).
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return bytesToHex(digest);
}

// 16진수 해시의 앞부분 0 개수 — 작업증명(PoW) 난이도 판정에 사용
export function leadingZeros(hex: string): number {
  let n = 0;
  for (const c of hex) {
    if (c === "0") n++;
    else break;
  }
  return n;
}

// ── 2. 공개키 / 개인키 / 디지털 서명 (ECDSA P-256) ───────────────
export interface KeyPairHex {
  publicKeyHex: string;   // 모두에게 공개 — "내 계좌(주소)"의 근거
  privateKeyJwk: JsonWebKey; // 절대 공개 금지 — 서명할 때만 사용
  address: string;        // 공개키를 해시한 짧은 주소 (0x…)
  keyPair: CryptoKeyPair;
}

export async function generateKeyPair(): Promise<KeyPairHex> {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const rawPub = await crypto.subtle.exportKey("raw", kp.publicKey);
  const publicKeyHex = bytesToHex(rawPub);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const addrFull = await sha256(publicKeyHex);
  const address = "0x" + addrFull.slice(0, 40); // 이더리움처럼 20바이트 주소
  return { publicKeyHex, privateKeyJwk, address, keyPair: kp };
}

export async function signMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    enc.encode(message),
  );
  return bytesToHex(sig);
}

export async function verifyMessage(
  publicKeyHex: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  try {
    const pub = await crypto.subtle.importKey(
      "raw",
      hexToArrayBuffer(publicKeyHex),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      hexToArrayBuffer(signatureHex),
      enc.encode(message),
    );
  } catch {
    return false;
  }
}

// ── 3. 블록 해시 계산 (블록·체인 실습용) ──────────────────────────
export interface MiniBlock {
  index: number;
  data: string;
  prev: string;
  nonce: number;
  hash: string;
}

export async function hashBlock(b: Omit<MiniBlock, "hash">): Promise<string> {
  return sha256(`${b.index}|${b.data}|${b.prev}|${b.nonce}`);
}

// ── 4. Supabase 실시간 (CDN 동적 로드 — 별도 설치 불필요) ──────────
// 기존 프로젝트와 동일한 cdnImport 패턴을 사용합니다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cdnImport = (url: string) => new Function(`return import("${url}")`)() as Promise<any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSupabase(): Promise<any> {
  if (_client) return _client;
  const m = await cdnImport("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const createClient = m.createClient ?? m.default?.createClient;
  _client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return _client;
}

// ── 5. 공유 장부 REST 헬퍼 ────────────────────────────────────────
export interface Tx {
  id: number;
  room: string;
  sender: string;
  recipient: string;
  amount: number;
  note: string | null;
  created_at: string;
}

const restHeaders = {
  "Content-Type": "application/json",
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

export async function fetchLedger(room: string): Promise<Tx[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/bc_transactions?room=eq.${encodeURIComponent(room)}&order=id.asc`,
    { headers: restHeaders },
  );
  if (!r.ok) throw new Error("장부를 불러오지 못했습니다");
  return r.json();
}

export async function addTx(
  room: string,
  sender: string,
  recipient: string,
  amount: number,
  note?: string,
): Promise<Tx> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bc_transactions`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ room, sender, recipient, amount, note: note ?? null }),
  });
  if (!r.ok) throw new Error(await r.text());
  const rows = await r.json();
  return rows[0];
}

export async function resetRoom(room: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/bc_reset_room`, {
    method: "POST",
    headers: restHeaders,
    body: JSON.stringify({ p_room: room }),
  });
}

// 장부로부터 각 사람의 잔액을 계산 (모두 100코인으로 시작했다고 가정)
export function computeBalances(txs: Tx[], starting = 100): Record<string, number> {
  const bal: Record<string, number> = {};
  const ensure = (k: string) => {
    if (!(k in bal)) bal[k] = starting;
  };
  for (const t of txs) {
    ensure(t.sender);
    ensure(t.recipient);
    bal[t.sender] -= Number(t.amount);
    bal[t.recipient] += Number(t.amount);
  }
  return bal;
}

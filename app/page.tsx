"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { PDFDocument, rgb, BlendMode } from "pdf-lib";

type Tab = "split" | "merge" | "edit" | "compress" | "convert" | "annotate";
type MdTemplate = "basic" | "report" | "proposal" | "lecture" | "minutes";
type AnnTool = "move" | "text" | "highlight" | "eraser";
interface AnnText { id: string; page: number; type: "text"; xPct: number; yPct: number; wPct: number; text: string; }
interface AnnHi { id: string; page: number; type: "hi"; xPct: number; yPct: number; wPct: number; hPct: number; hex: string; }
type Ann = AnnText | AnnHi;
const COMPRESS_DPI = 150;
const COMPRESS_QUALITY = 0.7;
type SplitMode = "count" | "size" | "range";
type EditMode = "delete" | "extract" | "insert";

interface PageRange { from: number; to: number; }
interface SplitResult { name: string; blob: Blob; pages: string; sizeMB: number; }
interface MergeFile { file: File; pages: number | null; }
interface PageThumb { pageNum: number; dataUrl: string; }

let _pdfjsLib: unknown = null;
const getPdfJs = async () => {
  if (_pdfjsLib) return _pdfjsLib as any;
  // eslint-disable-next-line no-new-func
  const lib = await (new Function('return import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs")')() as Promise<any>);
  lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
  _pdfjsLib = lib;
  return lib;
};

// eslint-disable-next-line no-new-func
const cdnImport = (url: string) => (new Function(`return import("${url}")`)() as Promise<any>);

let _marked: any = null;
const getMarked = async () => {
  if (_marked) return _marked;
  const m = await cdnImport("https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js");
  _marked = m.marked ?? m.default ?? m;
  return _marked;
};
let _jsPDF: any = null;
const getJsPDF = async () => {
  if (_jsPDF) return _jsPDF;
  const m = await cdnImport("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
  _jsPDF = m.jsPDF ?? m.default;
  return _jsPDF;
};
let _html2canvas: any = null;
const getHtml2Canvas = async () => {
  if (_html2canvas) return _html2canvas;
  const m = await cdnImport("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm");
  _html2canvas = m.default ?? m;
  return _html2canvas;
};

const SUPABASE_URL = "https://ywofxncimmukmjldcyuk.supabase.co";
const SUPABASE_KEY = "sb_publishable_MVVFMcNJK7yfsFIMCikrvQ_ief-0CNV";

const TAB_COLORS: Record<string, { active: string; idle: string }> = {
  indigo:  { active: "bg-indigo-600 text-white shadow-sm",  idle: "text-slate-500 hover:text-indigo-600" },
  emerald: { active: "bg-emerald-600 text-white shadow-sm", idle: "text-slate-500 hover:text-emerald-600" },
  violet:  { active: "bg-violet-600 text-white shadow-sm",  idle: "text-slate-500 hover:text-violet-600" },
  sky:     { active: "bg-sky-600 text-white shadow-sm",     idle: "text-slate-500 hover:text-sky-600" },
  amber:   { active: "bg-amber-500 text-white shadow-sm",   idle: "text-slate-500 hover:text-amber-600" },
  rose:    { active: "bg-rose-600 text-white shadow-sm",    idle: "text-slate-500 hover:text-rose-600" },
};

const HL_COLORS = [
  { name: "노랑", hex: "#facc15" },
  { name: "초록", hex: "#4ade80" },
  { name: "분홍", hex: "#f472b6" },
  { name: "파랑", hex: "#60a5fa" },
  { name: "주황", hex: "#fb923c" },
];
const uid = () => Math.random().toString(36).slice(2, 9);
const hexToRgb01 = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

const MD_TEMPLATES: { key: MdTemplate; label: string }[] = [
  { key: "basic",    label: "기본" },
  { key: "report",   label: "보고서" },
  { key: "proposal", label: "제안서" },
  { key: "lecture",  label: "강의안" },
  { key: "minutes",  label: "회의록" },
];

const MD_SAMPLES: Record<MdTemplate, string> = {
  basic: `# 문서 제목\n\n여기에 내용을 작성하세요.\n\n- 항목 1\n- 항목 2\n`,
  report: `# 월간 운영 보고서\n\n## 1. 개요\n이번 기간의 주요 활동과 성과를 요약합니다.\n\n## 2. 주요 성과\n- 성과 1\n- 성과 2\n- 성과 3\n\n## 3. 이슈 및 개선점\n| 구분 | 내용 | 조치 |\n| --- | --- | --- |\n| 이슈 | 내용을 적으세요 | 조치를 적으세요 |\n\n## 4. 다음 계획\n1. 계획 1\n2. 계획 2\n`,
  proposal: `# 프로젝트 제안서\n\n## 제안 배경\n해결하려는 문제와 그 필요성을 설명합니다.\n\n## 제안 내용\n- 핵심 제안 1\n- 핵심 제안 2\n\n## 기대 효과\n도입 시 기대되는 정량적·정성적 효과를 적습니다.\n\n## 일정 및 예산\n| 단계 | 기간 | 예산 |\n| --- | --- | --- |\n| 1단계 | 0주 | 0원 |\n| 2단계 | 0주 | 0원 |\n`,
  lecture: `# 강의 제목\n\n> **학습 목표:** 이 강의를 통해 학습자가 무엇을 얻는지 적어주세요.\n\n## 1. 도입\n- 핵심 개념 소개\n- 왜 중요한가\n\n## 2. 본론\n### 2-1. 개념 설명\n핵심 내용을 설명합니다.\n\n### 2-2. 예시\n구체적인 사례나 예시를 듭니다.\n\n## 3. 정리\n- 요약 1\n- 요약 2\n\n## 과제\n- 과제 내용을 적어주세요.\n`,
  minutes: `# 회의록\n\n**일시:** 2026-00-00 14:00\n**장소:** 회의실 A\n**참석자:** 홍길동, 김철수, 이영희\n\n## 안건 1. 제목\n- 논의 내용\n- 결정 사항\n\n## 안건 2. 제목\n- 논의 내용\n- 결정 사항\n\n## 액션 아이템\n| 담당 | 할 일 | 기한 |\n| --- | --- | --- |\n| 홍길동 | 할 일 | 2026-00-00 |\n`,
};

const TEMPLATE_CSS = `
.pdfdoc{width:794px;box-sizing:border-box;padding:56px 60px;background:#fff;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif;color:#1e293b;font-size:14px;line-height:1.75;}
.pdfdoc h1{font-size:26px;font-weight:700;color:#0f172a;margin:1.1em 0 .5em;}
.pdfdoc h2{font-size:20px;font-weight:700;color:#0f172a;margin:1.5em 0 .5em;}
.pdfdoc h3{font-size:16px;font-weight:700;color:#334155;margin:1.2em 0 .4em;}
.pdfdoc p{margin:.6em 0;}
.pdfdoc ul,.pdfdoc ol{margin:.6em 0;padding-left:1.4em;}
.pdfdoc li{margin:.25em 0;}
.pdfdoc code{background:#f1f5f9;padding:.1em .35em;border-radius:4px;font-family:monospace;font-size:.9em;}
.pdfdoc pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow:auto;font-size:12.5px;}
.pdfdoc pre code{background:none;color:inherit;padding:0;}
.pdfdoc blockquote{border-left:3px solid #c7d2fe;background:#f8fafc;margin:.8em 0;padding:.5em 1em;color:#475569;}
.pdfdoc table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:13px;}
.pdfdoc th,.pdfdoc td{border:1px solid #e2e8f0;padding:7px 10px;text-align:left;}
.pdfdoc th{background:#f1f5f9;font-weight:700;}
.pdfdoc a{color:#4f46e5;}
.pdfdoc hr{border:none;border-top:1px solid #e2e8f0;margin:1.2em 0;}
.pdfdoc img{max-width:100%;}
.pdfdoc .doc-head{margin-bottom:1.6em;}
.pdfdoc .doc-kicker{font-size:12px;font-weight:700;letter-spacing:.15em;color:#4f46e5;}
.pdfdoc .doc-title{font-size:30px;font-weight:800;color:#0f172a;margin:.15em 0 .25em;}
.pdfdoc .doc-meta{font-size:12.5px;color:#94a3b8;}
.pdfdoc.tpl-report .doc-head{border-bottom:2px solid #0f172a;padding-bottom:.7em;}
.pdfdoc.tpl-report h2{border-bottom:1px solid #e2e8f0;padding-bottom:.2em;}
.pdfdoc.tpl-proposal .doc-head{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;padding:26px 24px;border-radius:12px;}
.pdfdoc.tpl-proposal .doc-kicker{color:#c7d2fe;}
.pdfdoc.tpl-proposal .doc-title{color:#fff;}
.pdfdoc.tpl-proposal .doc-meta{color:#e0e7ff;}
.pdfdoc.tpl-proposal h2{color:#4f46e5;}
.pdfdoc.tpl-lecture h2{background:#eef2ff;color:#3730a3;padding:.35em .6em;border-radius:8px;}
.pdfdoc.tpl-lecture .doc-kicker{color:#7c3aed;}
.pdfdoc.tpl-lecture blockquote{border-left-color:#7c3aed;background:#f5f3ff;}
.pdfdoc.tpl-minutes{font-size:13.5px;}
.pdfdoc.tpl-minutes .doc-head{border-left:4px solid #4f46e5;padding-left:.8em;}
.pdfdoc.tpl-minutes h2{font-size:17px;border-bottom:1px dashed #cbd5e1;padding-bottom:.2em;}
.pdfdoc-preview .pdfdoc{width:100%;padding:26px 28px;font-size:13px;}
`;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const buildDocHtml = (innerHtml: string, template: MdTemplate, title: string) => {
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const kicker: Record<MdTemplate, string> = { basic: "", report: "REPORT", proposal: "PROPOSAL", lecture: "강의안", minutes: "회의록" };
  const head = template === "basic" ? "" :
    `<div class="doc-head"><div class="doc-kicker">${kicker[template]}</div><div class="doc-title">${escapeHtml(title)}</div><div class="doc-meta">${today}</div></div>`;
  return `<style>${TEMPLATE_CSS}</style><div class="pdfdoc tpl-${template}">${head}${innerHtml}</div>`;
};

const parseMdTitle = (md: string, template: MdTemplate): { title: string; body: string } => {
  const m = md.match(/^\s*#\s+(.+?)\s*$/m);
  const title = m ? m[1].trim() : "문서";
  const body = template !== "basic" && m ? md.replace(m[0], "") : md;
  return { title, body };
};

async function makeThumbs(bytes: Uint8Array): Promise<PageThumb[]> {
  const lib = await getPdfJs();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const out: PageThumb[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 0.25 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await pg.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    out.push({ pageNum: i, dataUrl: canvas.toDataURL("image/jpeg", 0.8) });
  }
  return out;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("split");
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    let done = false;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_page_view`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ page_slug: "landing" }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(n => { if (!done) setViews(typeof n === "number" ? n : Number(n)); })
      .catch(() => { /* 카운터 실패 시 조용히 무시 */ });
    return () => { done = true; };
  }, []);

  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // ── split
  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>("count");
  const [splitCount, setSplitCount] = useState(2);
  const [maxSizeMB, setMaxSizeMB] = useState(5);
  const [ranges, setRanges] = useState<PageRange[]>([{ from: 1, to: 1 }]);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [splitResults, setSplitResults] = useState<SplitResult[]>([]);
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitError, setSplitError] = useState("");
  const [splitDragging, setSplitDragging] = useState(false);
  const splitBufRef = useRef<ArrayBuffer | null>(null);

  // ── compress
  const [compressFile, setCompressFile] = useState<File | null>(null);
  const [compressLoading, setCompressLoading] = useState(false);
  const [compressProgress, setCompressProgress] = useState(0);
  const [compressResult, setCompressResult] = useState<{blob:Blob;origMB:number;newMB:number;ratio:number;fallback:boolean}|null>(null);
  const [compressError, setCompressError] = useState("");
  const [compressDragging, setCompressDragging] = useState(false);
  const compressBufRef = useRef<ArrayBuffer | null>(null);

  const compress = async () => {
    if (!compressFile || !compressBufRef.current) return;
    const dpi = COMPRESS_DPI, quality = COMPRESS_QUALITY;
    setCompressLoading(true); setCompressError(""); setCompressResult(null); setCompressProgress(0);
    try {
      const lib = await getPdfJs();
      const origBuf = compressBufRef.current;
      const pdfDoc = await lib.getDocument({data: origBuf.slice()}).promise;
      const numPages = pdfDoc.numPages;
      const newPdf = await PDFDocument.create();
      const scale = dpi / 72;
      for (let i = 1; i <= numPages; i++) {
        setCompressProgress(Math.round((i-1)/numPages*100));
        const pg = await pdfDoc.getPage(i);
        const vp = pg.getViewport({scale});
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        await pg.render({canvasContext: canvas.getContext("2d")!, viewport: vp}).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.split(",")[1];
        const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const img = await newPdf.embedJpg(imgBytes);
        const page = newPdf.addPage([vp.width, vp.height]);
        page.drawImage(img, {x:0, y:0, width:vp.width, height:vp.height});
      }
      setCompressProgress(100);
      // Method 2: save with object streams for additional compression
      const saved = await newPdf.save({useObjectStreams: true});
      const origMB = origBuf.byteLength / 1024 / 1024;
      const origSize = origBuf.byteLength;

      // If rasterized result is larger than original, fall back to method 2 only on original
      let finalBytes: Uint8Array;
      let finalMB: number;
      let fallback = false;
      if (saved.length >= origSize) {
        const origPdf = await PDFDocument.load(origBuf.slice());
        const origSaved = await origPdf.save({useObjectStreams: true});
        if (origSaved.length < origSize) {
          finalBytes = origSaved;
          finalMB = origSaved.length / 1024 / 1024;
        } else {
          finalBytes = saved;
          finalMB = saved.length / 1024 / 1024;
        }
        fallback = true;
      } else {
        finalBytes = saved;
        finalMB = saved.length / 1024 / 1024;
      }

      const newMB = finalMB;
      const ratio = Math.round((1 - newMB / origMB) * 100);
      setCompressResult({
        blob: new Blob([finalBytes.buffer as ArrayBuffer], {type:"application/pdf"}),
        origMB, newMB, ratio, fallback,
      });
    } catch(e) { setCompressError("압축 중 오류: " + (e as Error).message); }
    finally { setCompressLoading(false); }
  };
  const downloadCompressed = () => {
    if (!compressResult || !compressFile) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(compressResult.blob);
    a.download = `${compressFile.name.replace(/\.pdf$/i,"")}_압축.pdf`;
    a.click();
  };

  // ── merge
  const [mergeFiles, setMergeFiles] = useState<MergeFile[]>([]);
  const [mergeResult, setMergeResult] = useState<{ blob: Blob; sizeMB: number } | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [mergeDragging, setMergeDragging] = useState(false);

  // ── edit
  const [editMode, setEditMode] = useState<EditMode>("delete");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editThumbs, setEditThumbs] = useState<PageThumb[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editDragging, setEditDragging] = useState(false);
  const [selPages, setSelPages] = useState<Set<number>>(new Set());
  const editBytesRef = useRef<Uint8Array | null>(null);
  const [undoStack, setUndoStack] = useState<Uint8Array[]>([]);
  const [srcFile, setSrcFile] = useState<File | null>(null);
  const [srcThumbs, setSrcThumbs] = useState<PageThumb[]>([]);
  const [srcLoading, setSrcLoading] = useState(false);
  const [srcDragging, setSrcDragging] = useState(false);
  const [selSrcPages, setSelSrcPages] = useState<Set<number>>(new Set());
  // dropZoneIndex: 0 = before page 1, N = after page N (i.e. at end)
  const [dropZoneIndex, setDropZoneIndex] = useState<number | null>(null);
  const dragPayloadRef = useRef<Set<number>>(new Set());

  // ── convert (Markdown ↔ PDF)
  const [convertMode, setConvertMode] = useState<"md2pdf" | "pdf2md">("md2pdf");
  const [mdText, setMdText] = useState("");
  const [mdTemplate, setMdTemplate] = useState<MdTemplate>("basic");
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertError, setConvertError] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [pdfMdFile, setPdfMdFile] = useState<File | null>(null);
  const [pdf2mdResult, setPdf2mdResult] = useState("");
  const [pdfMdDragging, setPdfMdDragging] = useState(false);

  useEffect(() => {
    if (tab !== "convert" || convertMode !== "md2pdf") return;
    if (!mdText.trim()) { setPreviewHtml(""); return; }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const marked = await getMarked();
        const { title, body } = parseMdTitle(mdText, mdTemplate);
        const inner = await marked.parse(body);
        if (!cancelled) setPreviewHtml(buildDocHtml(inner, mdTemplate, title));
      } catch { /* ignore preview errors */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [mdText, mdTemplate, tab, convertMode]);

  const generateMdPdf = async () => {
    if (!mdText.trim()) { setConvertError("Markdown 내용을 입력하세요."); return; }
    setConvertLoading(true); setConvertError("");
    try {
      const marked = await getMarked();
      const { title, body } = parseMdTitle(mdText, mdTemplate);
      const inner = await marked.parse(body);
      const holder = document.createElement("div");
      holder.style.position = "absolute"; holder.style.left = "-10000px"; holder.style.top = "0";
      holder.innerHTML = buildDocHtml(inner, mdTemplate, title);
      document.body.appendChild(holder);
      await new Promise(r => setTimeout(r, 60));
      const target = holder.querySelector(".pdfdoc") as HTMLElement;
      const html2canvas = await getHtml2Canvas();
      const canvas = await html2canvas(target, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      document.body.removeChild(holder);
      const JsPDF = await getJsPDF();
      const pdf = new JsPDF("p", "mm", "a4");
      const pageW = 210, pageH = 297;
      const imgH = canvas.height * pageW / canvas.width;
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      let heightLeft = imgH, position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH);
        heightLeft -= pageH;
      }
      pdf.save(`${title || "document"}.pdf`);
    } catch (e) { setConvertError("PDF 생성 중 오류: " + (e as Error).message); }
    finally { setConvertLoading(false); }
  };

  const loadMdFile = async (f: File) => {
    try { setMdText(await f.text()); setConvertError(""); }
    catch { setConvertError("Markdown 파일을 읽을 수 없습니다."); }
  };

  const convertPdfToMd = async (f: File) => {
    setPdfMdFile(f); setConvertLoading(true); setPdf2mdResult(""); setConvertError("");
    try {
      const lib = await getPdfJs();
      const data = new Uint8Array(await f.arrayBuffer());
      const doc = await lib.getDocument({ data }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const lines: string[] = []; let line = ""; let lastY: number | null = null;
        for (const it of tc.items as any[]) {
          const y = it.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 5 && line.trim()) { lines.push(line.trim()); line = ""; }
          line += it.str;
          if (it.hasEOL) { if (line.trim()) lines.push(line.trim()); line = ""; }
          lastY = y;
        }
        if (line.trim()) lines.push(line.trim());
        pages.push(`## 페이지 ${i}\n\n${lines.join("\n\n")}`);
      }
      setPdf2mdResult(pages.join("\n\n---\n\n"));
    } catch (e) { setConvertError("Markdown 변환 중 오류: " + (e as Error).message); }
    finally { setConvertLoading(false); }
  };

  const downloadMd = () => {
    if (!pdf2mdResult) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([pdf2mdResult], { type: "text/markdown;charset=utf-8" }));
    a.download = `${(pdfMdFile?.name ?? "document").replace(/\.pdf$/i, "")}.md`; a.click();
  };

  // ── annotate (텍스트 주석 + 형광펜)
  const [annFile, setAnnFile] = useState<File | null>(null);
  const annBufRef = useRef<ArrayBuffer | null>(null);
  const [annPageNum, setAnnPageNum] = useState(1);
  const [annNumPages, setAnnNumPages] = useState(0);
  const [annPage, setAnnPage] = useState<{ url: string; dispW: number; dispH: number; pw: number; ph: number } | null>(null);
  const [annLoading, setAnnLoading] = useState(false);
  const [annError, setAnnError] = useState("");
  const [annDragOver, setAnnDragOver] = useState(false);
  const [annTool, setAnnTool] = useState<AnnTool>("move");
  const [hlIdx, setHlIdx] = useState(0);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [annSaving, setAnnSaving] = useState(false);
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const annOverlayRef = useRef<HTMLDivElement | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const moveRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const renderAnnPage = async (pageNum: number) => {
    if (!annBufRef.current) return;
    setAnnLoading(true); setAnnError("");
    try {
      const lib = await getPdfJs();
      const doc = await lib.getDocument({ data: annBufRef.current.slice(0) }).promise;
      const page = await doc.getPage(pageNum);
      const base = page.getViewport({ scale: 1 });
      const dispW = Math.min(820, base.width);
      const vp = page.getViewport({ scale: (dispW / base.width) * 2 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
      setAnnPage({ url: canvas.toDataURL("image/jpeg", 0.9), dispW, dispH: dispW * base.height / base.width, pw: base.width, ph: base.height });
    } catch { setAnnError("페이지를 렌더링하지 못했습니다."); }
    finally { setAnnLoading(false); }
  };

  const loadAnnFile = async (f: File) => {
    if (f.type !== "application/pdf") { setAnnError("PDF 파일만 업로드할 수 있습니다."); return; }
    setAnnFile(f); setAnns([]); setAnnError(""); setAnnTool("move"); setAnnLoading(true);
    try {
      const buf = await f.arrayBuffer(); annBufRef.current = buf;
      const lib = await getPdfJs();
      const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
      setAnnNumPages(doc.numPages); setAnnPageNum(1);
      await renderAnnPage(1);
    } catch { setAnnError("PDF를 읽을 수 없습니다."); }
    finally { setAnnLoading(false); }
  };

  const goAnnPage = (n: number) => {
    if (!annNumPages) return;
    const p = Math.max(1, Math.min(annNumPages, n));
    setAnnPageNum(p); setDrawRect(null); drawStartRef.current = null; renderAnnPage(p);
  };

  const annXY = (clientX: number, clientY: number) => {
    const r = annOverlayRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const onAnnDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (annTool !== "highlight" || !annPage) return;
    const p = annXY(e.clientX, e.clientY); drawStartRef.current = p; setDrawRect({ x: p.x, y: p.y, w: 0, h: 0 });
    annOverlayRef.current?.setPointerCapture(e.pointerId);
  };
  const onAnnMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!annPage) return;
    if (annTool === "highlight" && drawStartRef.current) {
      const p = annXY(e.clientX, e.clientY); const s = drawStartRef.current;
      setDrawRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
    } else if (moveRef.current) {
      const p = annXY(e.clientX, e.clientY); const m = moveRef.current;
      setAnns(a => a.map(an => an.id === m.id ? { ...an, xPct: (p.x - m.dx) / annPage.dispW, yPct: (p.y - m.dy) / annPage.dispH } : an));
    }
  };
  const onAnnUp = () => {
    if (annTool === "highlight" && drawStartRef.current && drawRect && annPage) {
      if (drawRect.w > 6 && drawRect.h > 3) {
        setAnns(a => [...a, { id: uid(), page: annPageNum, type: "hi", xPct: drawRect.x / annPage.dispW, yPct: drawRect.y / annPage.dispH, wPct: drawRect.w / annPage.dispW, hPct: drawRect.h / annPage.dispH, hex: HL_COLORS[hlIdx].hex }]);
      }
      drawStartRef.current = null; setDrawRect(null);
    }
    moveRef.current = null;
  };
  const onAnnClickAdd = (e: React.MouseEvent<HTMLDivElement>) => {
    if (annTool !== "text" || !annPage) return;
    const p = annXY(e.clientX, e.clientY);
    setAnns(a => [...a, { id: uid(), page: annPageNum, type: "text", xPct: p.x / annPage.dispW, yPct: p.y / annPage.dispH, wPct: 0.32, text: "텍스트 입력" }]);
    setAnnTool("move");
  };
  const addTextCenter = () => {
    if (!annPage) return;
    setAnns(a => [...a, { id: uid(), page: annPageNum, type: "text", xPct: 0.34, yPct: 0.42, wPct: 0.32, text: "텍스트 입력" }]);
    setAnnTool("move");
  };
  const startTextMove = (e: React.PointerEvent, id: string) => {
    if (annTool === "eraser" || annTool === "highlight" || !annPage) return;
    e.stopPropagation();
    const an = anns.find(a => a.id === id) as AnnText | undefined; if (!an) return;
    const p = annXY(e.clientX, e.clientY);
    moveRef.current = { id, dx: p.x - an.xPct * annPage.dispW, dy: p.y - an.yPct * annPage.dispH };
    annOverlayRef.current?.setPointerCapture(e.pointerId);
  };
  const updateText = (id: string, text: string) => setAnns(a => a.map(an => an.id === id ? { ...an, text } : an));

  const saveAnnotated = async () => {
    if (!annBufRef.current) return;
    setAnnSaving(true); setAnnError("");
    try {
      const pdfDoc = await PDFDocument.load(annBufRef.current.slice(0));
      const pages = pdfDoc.getPages();
      const html2canvas = await getHtml2Canvas();
      for (const an of anns) {
        const page = pages[an.page - 1]; if (!page) continue;
        const { width: pw, height: ph } = page.getSize();
        if (an.type === "hi") {
          const c = hexToRgb01(an.hex);
          page.drawRectangle({ x: an.xPct * pw, y: ph - (an.yPct + an.hPct) * ph, width: an.wPct * pw, height: an.hPct * ph, color: rgb(c.r, c.g, c.b), opacity: 0.4, blendMode: BlendMode.Multiply });
        } else {
          const R = 3;
          const div = document.createElement("div");
          div.style.cssText = `position:absolute;left:-10000px;top:0;width:${an.wPct * pw * R}px;padding:${pw * 0.008 * R}px ${pw * 0.011 * R}px;font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:${pw * 0.019 * R}px;line-height:1.4;color:#111827;background:rgba(254,243,199,0.96);border:1px solid #f59e0b;border-radius:6px;white-space:pre-wrap;word-break:break-word;`;
          div.textContent = an.text || " ";
          document.body.appendChild(div);
          const canvas = await html2canvas(div, { scale: 1, backgroundColor: null });
          document.body.removeChild(div);
          const png = await pdfDoc.embedPng(canvas.toDataURL("image/png"));
          const wPt = an.wPct * pw;
          const hPt = wPt * (canvas.height / canvas.width);
          page.drawImage(png, { x: an.xPct * pw, y: ph - an.yPct * ph - hPt, width: wPt, height: hPt });
        }
      }
      const bytes = await pdfDoc.save();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }));
      a.download = `${(annFile?.name ?? "document").replace(/\.pdf$/i, "")}_주석.pdf`; a.click();
    } catch (e) { setAnnError("저장 중 오류: " + (e as Error).message); }
    finally { setAnnSaving(false); }
  };

  const resetEditState = () => {
    setSelPages(new Set()); setEditFile(null); setEditThumbs([]);
    editBytesRef.current = null; setUndoStack([]); setEditError("");
    setSrcFile(null); setSrcThumbs([]); setSelSrcPages(new Set());
    setDropZoneIndex(null);
  };

  // ── SPLIT
  const loadSplitFile = async (f: File) => {
    setSplitFile(f); setSplitResults([]); setSplitError("");
    try {
      const buf = await f.arrayBuffer(); splitBufRef.current = buf;
      const pdf = await PDFDocument.load(buf); const n = pdf.getPageCount();
      setTotalPages(n); setRanges([{ from: 1, to: n }]);
    } catch { setSplitError("PDF 파일을 읽을 수 없습니다."); setTotalPages(null); }
  };
  const onSplitDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setSplitDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f?.type === "application/pdf") loadSplitFile(f);
    else setSplitError("PDF 파일만 업로드할 수 있습니다.");
  }, []);
  const split = async () => {
    if (!splitFile || !totalPages) return;
    setSplitLoading(true); setSplitError(""); setSplitResults([]);
    try {
      const buf = splitBufRef.current ?? (await splitFile.arrayBuffer());
      const src = await PDFDocument.load(buf); const pageCount = src.getPageCount();
      let chunks: { pages: number[]; label: string }[] = [];
      if (splitMode === "count") {
        if (splitCount < 2 || splitCount > pageCount) { setSplitError(`분할 개수는 2 이상 ${pageCount} 이하여야 합니다.`); return; }
        const base = Math.floor(pageCount / splitCount), extra = pageCount % splitCount; let cur = 0;
        for (let i = 0; i < splitCount; i++) { const len = base + (i < extra ? 1 : 0); if (len > 0) { chunks.push({ pages: Array.from({ length: len }, (_, j) => cur + j), label: `part${i + 1}` }); cur += len; } }
      } else if (splitMode === "size") {
        const maxBytes = maxSizeMB * 1024 * 1024; let cur: number[] = [], idx = 1;
        for (let i = 0; i < pageCount; i++) {
          cur.push(i); const tmp = await PDFDocument.create();
          const pp = await tmp.copyPages(src, cur); pp.forEach(p => tmp.addPage(p));
          const bytes = await tmp.save();
          if (bytes.length > maxBytes && cur.length > 1) { chunks.push({ pages: cur.slice(0, -1), label: `part${idx++}` }); cur = [i]; }
        }
        if (cur.length) chunks.push({ pages: cur, label: `part${idx}` });
      } else {
        for (let i = 0; i < ranges.length; i++) {
          const from = ranges[i].from - 1, to = ranges[i].to - 1;
          if (from < 0 || to >= pageCount || from > to) { setSplitError(`범위 ${i + 1}: 유효하지 않은 페이지 범위 (1–${pageCount})`); return; }
          chunks.push({ pages: Array.from({ length: to - from + 1 }, (_, j) => from + j), label: `part${i + 1}` });
        }
      }
      const results: SplitResult[] = [];
      for (const { pages: pp, label } of chunks) {
        const doc = await PDFDocument.create();
        const copied = await doc.copyPages(src, pp); copied.forEach(p => doc.addPage(p));
        const bytes = await doc.save();
        results.push({ name: `${splitFile.name.replace(/\.pdf$/i, "")}_${label}.pdf`, blob: new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }), pages: pp[0] + 1 === pp[pp.length - 1] + 1 ? `${pp[0] + 1}` : `${pp[0] + 1}–${pp[pp.length - 1] + 1}`, sizeMB: bytes.length / 1024 / 1024 });
      }
      setSplitResults(results);
    } catch (e) { setSplitError("PDF 분할 중 오류: " + (e as Error).message); }
    finally { setSplitLoading(false); }
  };
  const downloadAllSplit = () => splitResults.forEach(r => { const a = document.createElement("a"); a.href = URL.createObjectURL(r.blob); a.download = r.name; a.click(); });

  // ── MERGE
  const addMergeFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type === "application/pdf");
    if (!arr.length) { setMergeError("PDF 파일만 추가할 수 있습니다."); return; }
    setMergeError(""); setMergeResult(null);
    const loaded: MergeFile[] = await Promise.all(arr.map(async (file) => {
      try { const pdf = await PDFDocument.load(await file.arrayBuffer()); return { file, pages: pdf.getPageCount() }; }
      catch { return { file, pages: null }; }
    }));
    setMergeFiles(prev => [...prev, ...loaded]);
  };
  const onMergeDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setMergeDragging(false); addMergeFiles(e.dataTransfer.files); }, []);
  const removeMergeFile = (i: number) => setMergeFiles(prev => prev.filter((_, j) => j !== i));
  const moveMergeFile = (i: number, dir: -1 | 1) => setMergeFiles(prev => { const a = [...prev]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; return a; });
  const merge = async () => {
    if (mergeFiles.length < 2) { setMergeError("2개 이상의 PDF 파일을 추가하세요."); return; }
    setMergeLoading(true); setMergeError(""); setMergeResult(null);
    try {
      const merged = await PDFDocument.create();
      for (const { file } of mergeFiles) {
        const src = await PDFDocument.load(await file.arrayBuffer());
        const copied = await merged.copyPages(src, Array.from({ length: src.getPageCount() }, (_, i) => i));
        copied.forEach(p => merged.addPage(p));
      }
      const bytes = await merged.save();
      setMergeResult({ blob: new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }), sizeMB: bytes.length / 1024 / 1024 });
    } catch (e) { setMergeError("PDF 합치기 중 오류: " + (e as Error).message); }
    finally { setMergeLoading(false); }
  };
  const downloadMerged = () => {
    if (!mergeResult) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(mergeResult.blob);
    a.download = `${(mergeFiles[0]?.file.name ?? "merged").replace(/\.pdf$/i, "")}_합본.pdf`; a.click();
  };

  // ── EDIT
  const loadEditFile = async (f: File) => {
    setEditFile(f); setEditThumbs([]); setSelPages(new Set()); setUndoStack([]); setEditError(""); setEditLoading(true);
    try { const bytes = new Uint8Array(await f.arrayBuffer()); editBytesRef.current = bytes; setEditThumbs(await makeThumbs(bytes)); }
    catch { setEditError("PDF를 읽을 수 없습니다."); }
    finally { setEditLoading(false); }
  };
  const loadSrcFile = async (f: File) => {
    setSrcFile(f); setSrcThumbs([]); setSrcLoading(true); setSelSrcPages(new Set());
    try { setSrcThumbs(await makeThumbs(new Uint8Array(await f.arrayBuffer()))); }
    catch { setEditError("소스 PDF를 읽을 수 없습니다."); }
    finally { setSrcLoading(false); }
  };
  const toggleSel = (n: number) => setSelPages(prev => { const s = new Set(prev); s.has(n) ? s.delete(n) : s.add(n); return s; });
  const applyDelete = async () => {
    if (!editBytesRef.current || !selPages.size) return;
    const prev = editBytesRef.current; setUndoStack(s => [...s.slice(-9), prev]); setEditLoading(true);
    try {
      const src = await PDFDocument.load(prev);
      const keep = Array.from({ length: src.getPageCount() }, (_, i) => i).filter(i => !selPages.has(i + 1));
      if (!keep.length) { setEditError("모든 페이지를 삭제할 수 없습니다."); setUndoStack(s => s.slice(0, -1)); return; }
      const doc = await PDFDocument.create();
      const pp = await doc.copyPages(src, keep); pp.forEach(p => doc.addPage(p));
      const bytes = new Uint8Array(await doc.save()); editBytesRef.current = bytes; setSelPages(new Set());
      setEditThumbs(await makeThumbs(bytes));
    } catch (e) { setEditError("삭제 중 오류: " + (e as Error).message); }
    finally { setEditLoading(false); }
  };
  const applyUndo = async () => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1]; setUndoStack(s => s.slice(0, -1)); setEditLoading(true);
    try { editBytesRef.current = prev; setSelPages(new Set()); setEditThumbs(await makeThumbs(prev)); }
    catch { setEditError("되돌리기 실패"); }
    finally { setEditLoading(false); }
  };
  const applyExtract = async () => {
    if (!editBytesRef.current || !selPages.size) return; setEditLoading(true);
    try {
      const src = await PDFDocument.load(editBytesRef.current); const doc = await PDFDocument.create();
      const pp = await doc.copyPages(src, [...selPages].sort((a, b) => a - b).map(n => n - 1)); pp.forEach(p => doc.addPage(p));
      const saved = await doc.save(); const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([saved.buffer as ArrayBuffer], { type: "application/pdf" }));
      a.download = `${editFile!.name.replace(/\.pdf$/i, "")}_추출.pdf`; a.click();
    } catch (e) { setEditError("추출 중 오류: " + (e as Error).message); }
    finally { setEditLoading(false); }
  };
  const saveEdited = () => {
    if (!editBytesRef.current || !editFile) return;
    const bytes = editBytesRef.current; const ab = new ArrayBuffer(bytes.byteLength); new Uint8Array(ab).set(bytes);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ab], { type: "application/pdf" }));
    a.download = `${editFile.name.replace(/\.pdf$/i, "")}_편집.pdf`; a.click();
  };
  const applyInsert = async (afterN: number, pages: Set<number>) => {
    if (!editBytesRef.current || !srcFile || !pages.size) return;
    const prev = editBytesRef.current; setUndoStack(s => [...s.slice(-9), prev]); setEditLoading(true);
    try {
      const basePdf = await PDFDocument.load(prev);
      const srcPdf = await PDFDocument.load(await srcFile.arrayBuffer());
      const sorted = [...pages].sort((a, b) => a - b).map(n => n - 1);
      const copied = await basePdf.copyPages(srcPdf, sorted);
      copied.forEach((page, i) => basePdf.insertPage(afterN + i, page));
      const bytes = new Uint8Array(await basePdf.save()); editBytesRef.current = bytes;
      setEditThumbs(await makeThumbs(bytes));
    } catch (e) { setEditError("삽입 중 오류: " + (e as Error).message); }
    finally { setEditLoading(false); }
  };
  const deleteBasePage = async (pageNum: number) => {
    if (!editBytesRef.current) return;
    const prev = editBytesRef.current; setUndoStack(s => [...s.slice(-9), prev]); setEditLoading(true);
    try {
      const src = await PDFDocument.load(prev);
      const keep = Array.from({ length: src.getPageCount() }, (_, i) => i).filter(i => i !== pageNum - 1);
      if (!keep.length) { setEditError("페이지가 1장만 남아 삭제할 수 없습니다."); setUndoStack(s => s.slice(0, -1)); return; }
      const doc = await PDFDocument.create();
      const pp = await doc.copyPages(src, keep); pp.forEach(p => doc.addPage(p));
      const bytes = new Uint8Array(await doc.save()); editBytesRef.current = bytes;
      setEditThumbs(await makeThumbs(bytes));
    } catch (e) { setEditError("삭제 중 오류: " + (e as Error).message); }
    finally { setEditLoading(false); }
  };

  // Compute drop zone index from drag event over a thumbnail
  const getDropIdx = (e: React.DragEvent, thumbIdx: number) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? thumbIdx : thumbIdx + 1;
  };

  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-9">
          <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium px-3 py-1 rounded-full shadow-sm mb-4">
            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            파일은 브라우저에서만 처리 · 서버 저장 없음
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-3">강의용 PDF 편집기</h1>
          <p className="text-slate-500 max-w-xl mx-auto leading-relaxed">강의 자료 준비를 위한 가장 쉬운 PDF 편집 도구.<br className="hidden sm:block"/> 분할·병합·편집·압축·변환을 설치 없이 한 곳에서.</p>
        </header>

        <div className="flex bg-white border border-slate-200 rounded-2xl shadow-sm p-1.5 mb-6 gap-1.5">
          {([["split","✂️ PDF 분할","indigo"],["merge","🔗 PDF 합치기","emerald"],["edit","✏️ 페이지 편집","violet"],["compress","🗜️ PDF 압축","sky"],["convert","🔄 파일 변환","amber"],["annotate","🖍️ 주석","rose"]] as const).map(([key,label,color])=>(
            <button key={key} onClick={()=>setTab(key)} className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${tab===key?TAB_COLORS[color].active:TAB_COLORS[color].idle}`}>{label}</button>
          ))}
        </div>

        {tab==="split" && (
          <div>
            <div className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors mb-6 ${splitDragging?"border-indigo-500 bg-indigo-50":"border-indigo-300 bg-white hover:border-indigo-500"}`}
              onDragOver={e=>{e.preventDefault();setSplitDragging(true);}} onDragLeave={()=>setSplitDragging(false)} onDrop={onSplitDrop} onClick={()=>document.getElementById("splitInput")?.click()}>
              <input id="splitInput" type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)loadSplitFile(f);}}/>
              {splitFile?(<div><p className="text-indigo-700 font-semibold text-lg">{splitFile.name}</p><p className="text-gray-400 text-sm mt-1">{totalPages!==null?`총 ${totalPages}페이지`:""} · {(splitFile.size/1024/1024).toFixed(2)} MB</p><p className="text-gray-400 text-xs mt-2">클릭하여 다른 파일 선택</p></div>
              ):(<div><svg className="mx-auto mb-3 w-12 h-12 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg><p className="text-gray-500">PDF 파일을 드래그하거나 클릭하여 업로드</p></div>)}
            </div>
            {splitFile&&totalPages&&(<div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
              <p className="font-semibold text-gray-700 mb-4">분할 방식 선택</p>
              <div className="flex gap-2 mb-4">{(["count","size","range"] as SplitMode[]).map(m=>(<button key={m} onClick={()=>setSplitMode(m)} className={`flex-1 py-2 rounded-xl border-2 font-medium text-sm transition-colors ${splitMode===m?m==="range"?"border-violet-500 bg-violet-50 text-violet-700":"border-indigo-500 bg-indigo-50 text-indigo-700":"border-gray-200 text-gray-500 hover:border-indigo-300"}`}>{m==="count"?"분할 개수":m==="size"?"최대 파일 크기":"페이지 범위"}</button>))}</div>
              {splitMode==="count"&&<div><label className="block text-sm text-gray-600 mb-2">몇 개의 파일로 나눌까요? <span className="text-gray-400">(최대 {totalPages}개)</span></label><input type="number" min={2} max={totalPages} value={splitCount} onChange={e=>setSplitCount(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"/><p className="text-xs text-gray-400 mt-2">페이지를 최대한 균등하게 나눕니다.</p></div>}
              {splitMode==="size"&&<div><label className="block text-sm text-gray-600 mb-2">파일당 최대 크기 (MB)</label><input type="number" min={0.1} step={0.1} value={maxSizeMB} onChange={e=>setMaxSizeMB(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"/><p className="text-xs text-gray-400 mt-2">각 파일이 지정한 크기를 초과하지 않도록 분할합니다.</p></div>}
              {splitMode==="range"&&(<div><p className="text-sm text-gray-600 mb-3">분할할 페이지 범위 입력 <span className="text-gray-400">(총 {totalPages}페이지)</span></p><div className="space-y-2">{ranges.map((r,i)=>(<div key={i} className="flex items-center gap-2"><span className="text-gray-400 text-sm w-14 shrink-0">파일 {i+1}</span><input type="number" min={1} max={totalPages} value={r.from} onChange={e=>setRanges(prev=>prev.map((x,j)=>j===i?{...x,from:Number(e.target.value)}:x))} className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300"/><span className="text-gray-400">–</span><input type="number" min={1} max={totalPages} value={r.to} onChange={e=>setRanges(prev=>prev.map((x,j)=>j===i?{...x,to:Number(e.target.value)}:x))} className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300"/><span className="text-gray-400 text-xs">페이지</span>{ranges.length>1&&<button onClick={()=>setRanges(prev=>prev.filter((_,j)=>j!==i))} className="ml-auto text-gray-300 hover:text-red-400 text-xl px-1">×</button>}</div>))}</div><button onClick={()=>setRanges(prev=>[...prev,{from:1,to:totalPages??1}])} className="mt-3 w-full py-2 border-2 border-dashed border-violet-200 text-violet-500 hover:border-violet-400 hover:text-violet-600 rounded-xl text-sm font-medium transition-colors">+ 범위 추가</button></div>)}
              <button onClick={split} disabled={splitLoading} className={`mt-5 w-full disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors ${splitMode==="range"?"bg-violet-600 hover:bg-violet-700":"bg-indigo-600 hover:bg-indigo-700"}`}>{splitLoading?"분할 중…":"PDF 분할하기"}</button>
            </div>)}
            {splitError&&<div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">{splitError}</div>}
            {splitResults.length>0&&(<div className="bg-white rounded-2xl shadow-sm p-6"><div className="flex items-center justify-between mb-4"><p className="font-semibold text-gray-700">분할 결과 ({splitResults.length}개)</p><button onClick={downloadAllSplit} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg transition-colors">전체 다운로드</button></div><ul className="space-y-2">{splitResults.map((r,i)=>(<li key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3"><div className="min-w-0 flex-1 mr-4"><p className="text-sm font-medium text-gray-700 truncate" title={r.name}>{r.name}</p><p className="text-xs text-gray-400">페이지 {r.pages} · {r.sizeMB.toFixed(2)} MB</p></div><a href={URL.createObjectURL(r.blob)} download={r.name} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium shrink-0">다운로드</a></li>))}</ul></div>)}
          </div>
        )}

        {tab==="merge" && (
          <div>
            <div className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors mb-4 ${mergeDragging?"border-emerald-500 bg-emerald-50":"border-emerald-300 bg-white hover:border-emerald-500"}`}
              onDragOver={e=>{e.preventDefault();setMergeDragging(true);}} onDragLeave={()=>setMergeDragging(false)} onDrop={onMergeDrop} onClick={()=>document.getElementById("mergeInput")?.click()}>
              <input id="mergeInput" type="file" accept="application/pdf" multiple className="hidden" onChange={e=>{if(e.target.files)addMergeFiles(e.target.files);e.target.value="";}}/>
              <svg className="mx-auto mb-3 w-10 h-10 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4"/></svg>
              <p className="text-gray-500 text-sm">PDF 파일을 드래그하거나 클릭하여 추가</p>
              <p className="text-gray-400 text-xs mt-1">여러 파일을 한 번에 선택할 수 있습니다</p>
            </div>
            {mergeFiles.length>0&&(<div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between mb-3"><p className="font-semibold text-gray-700">합칠 파일 목록 ({mergeFiles.length}개)</p><button onClick={()=>{setMergeFiles([]);setMergeResult(null);}} className="text-xs text-gray-400 hover:text-red-400 transition-colors">전체 삭제</button></div>
              <ul className="space-y-2 mb-4">{mergeFiles.map((mf,i)=>(<li key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5"><div className="flex flex-col gap-0.5 shrink-0"><button onClick={()=>i>0&&moveMergeFile(i,-1)} disabled={i===0} className="text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none text-sm">▲</button><button onClick={()=>i<mergeFiles.length-1&&moveMergeFile(i,1)} disabled={i===mergeFiles.length-1} className="text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none text-sm">▼</button></div><span className="text-emerald-500 font-bold text-sm w-6 text-center shrink-0">{i+1}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-700 truncate">{mf.file.name}</p><p className="text-xs text-gray-400">{mf.pages!==null?`${mf.pages}페이지`:"읽기 실패"} · {(mf.file.size/1024/1024).toFixed(2)} MB</p></div><button onClick={()=>removeMergeFile(i)} className="text-gray-300 hover:text-red-400 text-xl leading-none px-1 shrink-0">×</button></li>))}</ul>
              {mergeFiles.length>=2&&(<div className="bg-emerald-50 rounded-xl p-3 mb-4"><p className="text-xs text-emerald-700 font-semibold mb-2">합쳐지는 순서</p><div className="flex flex-wrap items-center gap-1.5">{mergeFiles.map((mf,i)=>(<span key={i} className="contents"><span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2 py-1 text-xs text-gray-700 max-w-[140px]"><span className="text-emerald-500 font-bold shrink-0">{i+1}</span><span className="truncate">{mf.file.name.replace(/\.pdf$/i,"")}</span>{mf.pages!==null&&<span className="text-emerald-400 shrink-0">({mf.pages}p)</span>}</span>{i<mergeFiles.length-1&&<span className="text-emerald-400 font-bold text-sm">→</span>}</span>))}<span className="text-emerald-400 font-bold text-sm">→</span><span className="inline-flex items-center gap-1 bg-emerald-600 rounded-lg px-2 py-1 text-xs text-white font-semibold"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-3-3v6"/></svg>합쳐진 PDF</span></div></div>)}
              <button onClick={merge} disabled={mergeLoading||mergeFiles.length<2} className="w-full disabled:opacity-50 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors">{mergeLoading?"합치는 중…":`PDF ${mergeFiles.length}개 합치기`}</button>
            </div>)}
            {mergeError&&<div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">{mergeError}</div>}
            {mergeResult&&(<div className="bg-white rounded-2xl shadow-sm p-6"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0"><svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg></div><div className="flex-1 min-w-0"><p className="font-semibold text-gray-700">합치기 완료</p><p className="text-xs text-gray-400">{mergeResult.sizeMB.toFixed(2)} MB</p></div><button onClick={downloadMerged} className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors shrink-0">다운로드</button></div></div>)}
          </div>
        )}

        {tab==="edit" && (
          <>
            <div className="flex bg-white rounded-2xl shadow-sm p-1 mb-4 gap-1">
              {([  ["delete","🗑️ 페이지 삭제","rose"],["extract","📤 페이지 추출","blue"],["insert","➕ 페이지 삽입","violet"] ] as const).map(([key,label,color])=>(
                <button key={key} onClick={()=>{setEditMode(key);resetEditState();}} className={`flex-1 py-2 rounded-xl font-semibold text-sm transition-colors ${editMode===key?color==="rose"?"bg-rose-600 text-white":color==="blue"?"bg-blue-600 text-white":"bg-violet-600 text-white":color==="rose"?"text-gray-500 hover:text-rose-600":color==="blue"?"text-gray-500 hover:text-blue-600":"text-gray-500 hover:text-violet-600"}`}>{label}</button>
              ))}
            </div>

            {editMode!=="insert"&&(
              <div className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors mb-4 ${editDragging?"border-violet-500 bg-violet-50":"border-violet-300 bg-white hover:border-violet-500"}`}
                onDragOver={e=>{e.preventDefault();setEditDragging(true);}} onDragLeave={()=>setEditDragging(false)}
                onDrop={e=>{e.preventDefault();setEditDragging(false);const f=e.dataTransfer.files?.[0];if(f?.type==="application/pdf")loadEditFile(f);else setEditError("PDF 파일만 업로드할 수 있습니다.");}}
                onClick={()=>document.getElementById("editInput")?.click()}>
                <input id="editInput" type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)loadEditFile(f);e.currentTarget.value="";}}/>
                {editFile?(<div><p className="text-violet-700 font-semibold">{editFile.name}</p><p className="text-gray-400 text-sm mt-1">{editThumbs.length}페이지 · {(editFile.size/1024/1024).toFixed(2)} MB</p><p className="text-gray-400 text-xs mt-1">클릭하여 다른 파일 선택</p></div>
                ):(<div><svg className="mx-auto mb-2 w-10 h-10 text-violet-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg><p className="text-gray-500 text-sm">편집할 PDF 파일을 드래그하거나 클릭하여 업로드</p></div>)}
              </div>
            )}

            {editLoading&&(<div className="flex items-center justify-center gap-2 py-8 text-violet-600"><svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg><span className="text-sm font-medium">처리 중…</span></div>)}
            {editError&&<div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-4 text-sm">{editError}</div>}

            {editMode==="delete"&&editThumbs.length>0&&!editLoading&&(
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between"><p className="text-sm font-semibold text-gray-700">{selPages.size>0?<span className="text-rose-600">{selPages.size}페이지 선택됨 — 클릭으로 선택/해제</span>:"삭제할 페이지를 클릭하여 선택"}</p>{selPages.size>0&&<button onClick={()=>setSelPages(new Set())} className="text-xs text-gray-400 hover:text-gray-600">선택 해제</button>}</div>
                <div className="flex flex-wrap gap-3 p-4 max-h-[480px] overflow-y-auto">{editThumbs.map(t=>{const sel=selPages.has(t.pageNum);return(<div key={t.pageNum} onClick={()=>toggleSel(t.pageNum)} className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all select-none ${sel?"border-rose-500 ring-2 ring-rose-200":"border-gray-200 hover:border-gray-400"}`} style={{width:96}}><img src={t.dataUrl} className="w-full block" alt={`페이지 ${t.pageNum}`}/><div className={`text-center text-xs py-1 ${sel?"bg-rose-50 text-rose-600 font-semibold":"bg-gray-50 text-gray-500"}`}>{t.pageNum}</div>{sel&&(<div className="absolute inset-0 bottom-6 bg-rose-500/20 flex items-center justify-center"><div className="w-8 h-8 bg-rose-500 rounded-full flex items-center justify-center"><span className="text-white text-lg font-bold leading-none">✕</span></div></div>)}</div>);})}</div>
                <div className="p-4 border-t border-gray-100 flex gap-2"><button onClick={applyDelete} disabled={!selPages.size} className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white py-3 rounded-xl font-semibold text-sm transition-colors">{selPages.size?`선택한 ${selPages.size}페이지 삭제`:"삭제할 페이지를 선택하세요"}</button>{undoStack.length>0&&<button onClick={applyUndo} className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-sm transition-colors">↩ 되돌리기</button>}</div>
                {undoStack.length>0&&<div className="px-4 pb-4"><button onClick={saveEdited} className="w-full bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors">편집된 PDF 저장하기</button></div>}
              </div>
            )}

            {editMode==="extract"&&editThumbs.length>0&&!editLoading&&(
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between"><p className="text-sm font-semibold text-gray-700">{selPages.size>0?<span className="text-blue-600">{selPages.size}페이지 선택됨</span>:"추출할 페이지를 클릭하여 선택"}</p>{selPages.size>0&&<button onClick={()=>setSelPages(new Set())} className="text-xs text-gray-400 hover:text-gray-600">선택 해제</button>}</div>
                <div className="flex flex-wrap gap-3 p-4 max-h-[480px] overflow-y-auto">{editThumbs.map(t=>{const sel=selPages.has(t.pageNum);return(<div key={t.pageNum} onClick={()=>toggleSel(t.pageNum)} className={`relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all select-none ${sel?"border-blue-500 ring-2 ring-blue-200":"border-gray-200 hover:border-gray-400"}`} style={{width:96}}><img src={t.dataUrl} className="w-full block" alt={`페이지 ${t.pageNum}`}/><div className={`text-center text-xs py-1 ${sel?"bg-blue-50 text-blue-600 font-semibold":"bg-gray-50 text-gray-500"}`}>{t.pageNum}</div>{sel&&(<div className="absolute top-1.5 right-1.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center"><span className="text-white text-xs font-bold">✓</span></div>)}</div>);})}</div>
                <div className="p-4 border-t border-gray-100"><button onClick={applyExtract} disabled={!selPages.size} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white py-3 rounded-xl font-semibold text-sm transition-colors">{selPages.size?`선택한 ${selPages.size}페이지 추출하여 저장`:"추출할 페이지를 선택하세요"}</button></div>
              </div>
            )}

            {/* ===== INSERT MODE ===== */}
            {editMode==="insert"&&!editLoading&&(
              <div className="grid grid-cols-2 gap-4">

                {/* Left: 기존 PDF — drag target with live vertical cursor line */}
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
                  <div className="p-3 border-b border-gray-100">
                    <p className="font-semibold text-sm text-gray-700">기존 PDF {editThumbs.length>0?`(${editThumbs.length}페이지)`:""}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {editThumbs.length>0
                        ? selSrcPages.size>0?"드래그하여 원하는 위치에 놓으세요":"오른쪽에서 삽입할 페이지를 선택 후 드래그"
                        : "PDF를 업로드하세요"}
                    </p>
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    {/* Upload */}
                    <div className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors mb-3 ${editDragging?"border-violet-500 bg-violet-50":"border-violet-200 hover:border-violet-400"}`}
                      onDragEnter={e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.types.includes("Files"))setEditDragging(true);}}
                      onDragOver={e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.types.includes("Files"))setEditDragging(true);}}
                      onDragLeave={e=>{e.preventDefault();e.stopPropagation();setEditDragging(false);}}
                      onDrop={e=>{e.preventDefault();e.stopPropagation();setEditDragging(false);const f=e.dataTransfer.files?.[0];if(f?.type==="application/pdf")loadEditFile(f);}}
                      onClick={()=>document.getElementById("editBaseInput")?.click()}>
                      <input id="editBaseInput" type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)loadEditFile(f);e.currentTarget.value="";}} />
                      {editFile?(<div><p className="text-violet-700 text-xs font-semibold truncate">{editFile.name}</p><p className="text-gray-400 text-xs">{editThumbs.length}페이지 · 클릭으로 변경</p></div>
                      ):(<p className="text-gray-400 text-xs">기존 PDF 업로드<br/><span className="text-gray-300">드래그 또는 클릭</span></p>)}
                    </div>

                    {/* Thumbnail grid with insertion drop zones between pages */}
                    {editThumbs.length>0&&(
                      <div className="overflow-y-auto flex-1" style={{maxHeight:440}}>
                        {/*
                          Layout: [DropZone0] [Thumb0] [DropZone1] [Thumb1] ... [ThumbN] [DropZoneN+1]
                          Each DropZone is a thin hit area (8px wide) that shows a violet glow line
                          when active. The active zone is highlighted to show insertion position.
                          dropZoneIndex: 0 = before page 1, N = after page N.
                        */}
                        <div
                          className="flex flex-wrap items-start p-2"
                          style={{gap:"8px 4px"}}
                          onDragLeave={e=>{
                            if(!e.currentTarget.contains(e.relatedTarget as Node))setDropZoneIndex(null);
                          }}
                          onDragOver={e=>{e.preventDefault();}}
                          onDrop={e=>{e.preventDefault();}}
                        >
                          {editThumbs.map((t,idx)=>{
                            const isActiveLeft  = dropZoneIndex===idx;
                            const isActiveRight = dropZoneIndex===editThumbs.length && idx===editThumbs.length-1;
                            return (
                              <div key={t.pageNum} className="contents">
                                {/* Drop zone BEFORE this thumb */}
                                <div
                                  className="self-stretch flex items-center justify-center cursor-col-resize"
                                  style={{width:isActiveLeft?12:8,minHeight:100,transition:"width 0.1s"}}
                                  onDragEnter={e=>{e.preventDefault();e.stopPropagation();if(!e.dataTransfer.types.includes("Files"))setDropZoneIndex(idx);}}
                                  onDragOver={e=>{e.preventDefault();e.stopPropagation();if(!e.dataTransfer.types.includes("Files"))setDropZoneIndex(idx);}}
                                  onDrop={e=>{e.preventDefault();e.stopPropagation();setDropZoneIndex(null);applyInsert(idx,dragPayloadRef.current);}}
                                >
                                  {isActiveLeft&&(
                                    <div className="rounded-full" style={{width:3,height:"100%",minHeight:100,background:"#7c3aed",boxShadow:"0 0 8px 2px rgba(124,58,237,0.6)"}} />
                                  )}
                                </div>
                                {/* Thumbnail */}
                                <div className="relative group" style={{width:80}}>
                                  <div className="rounded-xl overflow-hidden border-2 border-gray-200 hover:border-gray-300 transition-colors">
                                    <img src={t.dataUrl} className="w-full block" alt={`p${t.pageNum}`}/>
                                    <div className="text-center text-xs py-1 bg-gray-50 text-gray-500">{t.pageNum}</div>
                                  </div>
                                  <button
                                    onClick={e=>{e.stopPropagation();deleteBasePage(t.pageNum);}}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 rounded-full text-white text-xs hidden group-hover:flex items-center justify-center shadow z-10 transition-colors"
                                    title="이 페이지 삭제"
                                  >×</button>
                                </div>
                                {/* Drop zone AFTER last thumb */}
                                {idx===editThumbs.length-1&&(
                                  <div
                                    className="self-stretch flex items-center justify-center cursor-col-resize"
                                    style={{width:isActiveRight?12:8,minHeight:100,transition:"width 0.1s"}}
                                    onDragEnter={e=>{e.preventDefault();e.stopPropagation();if(!e.dataTransfer.types.includes("Files"))setDropZoneIndex(editThumbs.length);}}
                                    onDragOver={e=>{e.preventDefault();e.stopPropagation();if(!e.dataTransfer.types.includes("Files"))setDropZoneIndex(editThumbs.length);}}
                                    onDrop={e=>{e.preventDefault();e.stopPropagation();setDropZoneIndex(null);applyInsert(editThumbs.length,dragPayloadRef.current);}}
                                  >
                                    {isActiveRight&&(
                                      <div className="rounded-full" style={{width:3,height:"100%",minHeight:100,background:"#7c3aed",boxShadow:"0 0 8px 2px rgba(124,58,237,0.6)"}} />
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {undoStack.length>0&&(
                          <div className="pt-2 px-1 flex gap-2">
                            <button onClick={applyUndo} className="flex-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 py-2 rounded-lg font-medium">↩ 되돌리기</button>
                            <button onClick={saveEdited} className="flex-1 text-xs bg-violet-600 hover:bg-violet-700 text-white py-2 rounded-lg font-medium">저장하기</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: 삽입할 PDF — drag source */}
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
                  <div className="p-3 border-b border-gray-100">
                    <p className="font-semibold text-sm text-gray-700">삽입할 PDF</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {selSrcPages.size>0
                        ?<span className="text-violet-600 font-medium">{selSrcPages.size}페이지 선택됨 — 왼쪽으로 드래그하여 삽입</span>
                        :"페이지 클릭으로 선택 후 왼쪽으로 드래그"}
                    </p>
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    <div className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors mb-3 ${srcDragging?"border-violet-500 bg-violet-50":"border-violet-200 hover:border-violet-400"}`}
                      onDragEnter={e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.types.includes("Files"))setSrcDragging(true);}}
                      onDragOver={e=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.types.includes("Files"))setSrcDragging(true);}}
                      onDragLeave={e=>{e.preventDefault();e.stopPropagation();setSrcDragging(false);}}
                      onDrop={e=>{e.preventDefault();e.stopPropagation();setSrcDragging(false);const f=e.dataTransfer.files?.[0];if(f?.type==="application/pdf")loadSrcFile(f);}}
                      onClick={()=>document.getElementById("srcInput")?.click()}>
                      <input id="srcInput" type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)loadSrcFile(f);e.currentTarget.value="";}} />
                      {srcFile?(<div><p className="text-violet-700 text-xs font-semibold truncate">{srcFile.name}</p><p className="text-gray-400 text-xs">{srcThumbs.length}페이지 · 클릭으로 변경</p></div>
                      ):(<p className="text-gray-400 text-xs">삽입할 PDF 업로드<br/><span className="text-gray-300">드래그 또는 클릭</span></p>)}
                    </div>
                    {srcLoading&&<div className="text-center text-xs text-violet-500 py-4">썸네일 생성 중…</div>}
                    {srcThumbs.length>0&&!srcLoading&&(
                      <>
                        {selSrcPages.size>0&&(
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-violet-600 font-medium">{selSrcPages.size}개 선택됨</span>
                            <button onClick={()=>setSelSrcPages(new Set())} className="text-xs text-gray-400 hover:text-gray-600">선택 해제</button>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 overflow-y-auto" style={{maxHeight:400}}>
                          {srcThumbs.map(t=>{
                            const sel=selSrcPages.has(t.pageNum);
                            return(
                              <div key={t.pageNum}
                                draggable
                                onDragStart={e=>{
                                  const payload=sel&&selSrcPages.size>0?new Set(selSrcPages):new Set([t.pageNum]);
                                  dragPayloadRef.current=payload;
                                  if(!sel)setSelSrcPages(new Set([t.pageNum]));
                                  e.dataTransfer.effectAllowed="copy";
                                }}
                                onDragEnd={()=>setDropZoneIndex(null)}
                                onClick={()=>setSelSrcPages(prev=>{const s=new Set(prev);s.has(t.pageNum)?s.delete(t.pageNum):s.add(t.pageNum);return s;})}
                                className={`relative cursor-grab active:cursor-grabbing rounded-xl overflow-hidden border-2 transition-all select-none ${sel?"border-violet-500 ring-2 ring-violet-300":"border-gray-200 hover:border-violet-300"}`}
                                style={{width:88}}>
                                <img src={t.dataUrl} className="w-full block" alt={`소스 ${t.pageNum}`}/>
                                <div className={`text-center text-xs py-1 ${sel?"bg-violet-50 text-violet-600 font-semibold":"bg-gray-50 text-gray-500"}`}>{t.pageNum}</div>
                                {sel&&(<div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center"><span className="text-white text-xs font-bold">✓</span></div>)}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>

              </div>
            )}
          </>
        )}

        {tab==="compress" && (
          <div>
            {/* Upload area */}
            <div
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors mb-6 ${compressDragging?"border-sky-500 bg-sky-50":"border-sky-300 bg-white hover:border-sky-500"}`}
              onDragOver={e=>{e.preventDefault();setCompressDragging(true);}}
              onDragLeave={()=>setCompressDragging(false)}
              onDrop={e=>{e.preventDefault();setCompressDragging(false);const f=e.dataTransfer.files?.[0];if(f?.type==="application/pdf"){setCompressFile(f);setCompressResult(null);setCompressError("");compressBufRef.current=null;f.arrayBuffer().then(b=>{compressBufRef.current=b;});}else setCompressError("PDF 파일만 업로드할 수 있습니다.");}}
              onClick={()=>document.getElementById("compressInput")?.click()}
            >
              <input id="compressInput" type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f){setCompressFile(f);setCompressResult(null);setCompressError("");compressBufRef.current=null;f.arrayBuffer().then(b=>{compressBufRef.current=b;});}e.currentTarget.value="";}}/>
              {compressFile?(
                <div>
                  <p className="text-sky-700 font-semibold text-lg">{compressFile.name}</p>
                  <p className="text-gray-400 text-sm mt-1">{(compressFile.size/1024/1024).toFixed(2)} MB · 클릭하여 다른 파일 선택</p>
                </div>
              ):(
                <div>
                  <svg className="mx-auto mb-3 w-12 h-12 text-sky-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                  <p className="text-gray-500">PDF 파일을 드래그하거나 클릭하여 업로드</p>
                </div>
              )}
            </div>

            {/* Compress button */}
            {compressFile&&!compressLoading&&(
              <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
                <p className="text-xs text-gray-400 mb-4">150DPI · JPEG 0.7 품질로 압축합니다. 압축 후 텍스트 선택·검색이 되지 않을 수 있습니다.</p>
                <button onClick={compress} className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 rounded-xl transition-colors">
                  PDF 압축 시작
                </button>
              </div>
            )}

            {/* Progress */}
            {compressLoading&&(
              <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <svg className="animate-spin w-5 h-5 text-sky-600 shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  <span className="text-sm font-medium text-gray-700">압축 중… {compressProgress}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="bg-sky-500 h-2 rounded-full transition-all duration-300" style={{width:`${compressProgress}%`}}/>
                </div>
              </div>
            )}

            {compressError&&<div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">{compressError}</div>}

            {/* Result */}
            {compressResult&&(
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-700">압축 완료</p>
                    <p className="text-xs text-gray-400">150DPI · JPEG 0.7</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-gray-400 mb-1">원본 크기</p>
                    <p className="font-semibold text-gray-700">{compressResult.origMB.toFixed(2)} MB</p>
                  </div>
                  <div className="bg-sky-50 rounded-xl p-3 text-center">
                    <p className="text-xs text-sky-500 mb-1">압축 후</p>
                    <p className="font-semibold text-sky-700">{compressResult.newMB.toFixed(2)} MB</p>
                  </div>
                  <div className={`rounded-xl p-3 text-center ${compressResult.ratio>0?"bg-emerald-50":"bg-orange-50"}`}>
                    <p className={`text-xs mb-1 ${compressResult.ratio>0?"text-emerald-500":"text-orange-400"}`}>감소율</p>
                    <p className={`font-bold text-lg ${compressResult.ratio>0?"text-emerald-600":"text-orange-500"}`}>
                      {compressResult.ratio>0?`-${compressResult.ratio}%`:`+${Math.abs(compressResult.ratio)}%`}
                    </p>
                  </div>
                </div>
                {compressResult.fallback&&(
                  <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-xs mb-4">
                    텍스트·벡터 위주 PDF는 이미지 변환 시 오히려 커질 수 있습니다. 메타데이터 정리만 적용된 결과를 제공합니다.
                  </div>
                )}
                {!compressResult.fallback&&compressResult.ratio<=0&&(
                  <div className="bg-orange-50 border border-orange-200 text-orange-700 rounded-xl px-4 py-3 text-xs mb-4">
                    원본이 이미 잘 압축된 파일입니다. 더 낮은 품질 프리셋을 시도해보세요.
                  </div>
                )}
                <button onClick={downloadCompressed} className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold py-3 rounded-xl transition-colors">
                  압축 파일 다운로드
                </button>
              </div>
            )}
          </div>
        )}

        {tab==="convert" && (
          <div>
            <div className="flex bg-white border border-slate-200 rounded-2xl shadow-sm p-1 mb-4 gap-1">
              {([["md2pdf","📝 Markdown → PDF"],["pdf2md","📄 PDF → Markdown"]] as const).map(([key,label])=>(
                <button key={key} onClick={()=>{setConvertMode(key);setConvertError("");}} className={`flex-1 py-2 rounded-xl font-semibold text-sm transition-colors ${convertMode===key?"bg-amber-500 text-white shadow-sm":"text-slate-500 hover:text-amber-600"}`}>{label}</button>
              ))}
            </div>

            {convertError&&<div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-4 text-sm">{convertError}</div>}

            {convertMode==="md2pdf"&&(
              <div className="grid lg:grid-cols-2 gap-4">
                {/* 입력 + 템플릿 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-sm text-slate-700">Markdown 입력</p>
                    <div className="flex items-center gap-3">
                      <button onClick={()=>setMdText(MD_SAMPLES[mdTemplate])} className="text-xs text-amber-600 hover:text-amber-700 font-medium">템플릿 예시 불러오기</button>
                      <button onClick={()=>document.getElementById("mdFileInput")?.click()} className="text-xs text-slate-500 hover:text-slate-700 font-medium">📂 .md 열기</button>
                      <input id="mdFileInput" type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)loadMdFile(f);e.currentTarget.value="";}}/>
                    </div>
                  </div>
                  <div className="mb-3">
                    <p className="text-xs text-slate-400 mb-1.5">문서 템플릿</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {MD_TEMPLATES.map(t=>(
                        <button key={t.key} onClick={()=>setMdTemplate(t.key)} className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${mdTemplate===t.key?"border-amber-500 bg-amber-50 text-amber-700":"border-slate-200 text-slate-500 hover:border-amber-300"}`}>{t.label}</button>
                      ))}
                    </div>
                  </div>
                  <textarea value={mdText} onChange={e=>setMdText(e.target.value)} placeholder={"# 제목\n\n여기에 Markdown을 입력하거나\n위에서 '템플릿 예시 불러오기'를 눌러보세요."} className="flex-1 min-h-[360px] w-full border border-slate-200 rounded-xl p-3 text-sm font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"/>
                  <button onClick={generateMdPdf} disabled={convertLoading} className="mt-3 w-full disabled:opacity-50 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-3 rounded-xl transition-colors">{convertLoading?"PDF 생성 중…":"PDF로 변환하여 다운로드"}</button>
                </div>

                {/* 미리보기 */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
                  <div className="px-4 py-2.5 border-b border-slate-100"><p className="font-semibold text-sm text-slate-700">미리보기 <span className="text-xs text-slate-400 font-normal">· 선택한 템플릿 적용</span></p></div>
                  <div className="pdfdoc-preview flex-1 overflow-auto bg-slate-100 p-4" style={{maxHeight:560}}>
                    {previewHtml
                      ? <div className="bg-white rounded-lg shadow-sm overflow-hidden" dangerouslySetInnerHTML={{__html: previewHtml}}/>
                      : <div className="h-full min-h-[320px] flex items-center justify-center text-sm text-slate-400 text-center px-6">왼쪽에 내용을 입력하면<br/>선택한 템플릿으로 미리보기가 표시됩니다.</div>}
                  </div>
                </div>
              </div>
            )}

            {convertMode==="pdf2md"&&(
              <div>
                <div className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors mb-4 ${pdfMdDragging?"border-amber-500 bg-amber-50":"border-amber-300 bg-white hover:border-amber-500"}`}
                  onDragOver={e=>{e.preventDefault();setPdfMdDragging(true);}} onDragLeave={()=>setPdfMdDragging(false)}
                  onDrop={e=>{e.preventDefault();setPdfMdDragging(false);const f=e.dataTransfer.files?.[0];if(f?.type==="application/pdf")convertPdfToMd(f);else setConvertError("PDF 파일만 업로드할 수 있습니다.");}}
                  onClick={()=>document.getElementById("pdfMdInput")?.click()}>
                  <input id="pdfMdInput" type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)convertPdfToMd(f);e.currentTarget.value="";}}/>
                  {pdfMdFile
                    ?(<div><p className="text-amber-700 font-semibold text-lg">{pdfMdFile.name}</p><p className="text-gray-400 text-sm mt-1">{(pdfMdFile.size/1024/1024).toFixed(2)} MB · 클릭하여 다른 파일 선택</p></div>)
                    :(<div><svg className="mx-auto mb-3 w-12 h-12 text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg><p className="text-gray-500">PDF 파일을 드래그하거나 클릭하여 업로드</p></div>)}
                </div>
                {convertLoading&&<div className="text-center text-sm text-amber-600 py-4">텍스트 추출 중…</div>}
                {pdf2mdResult&&!convertLoading&&(
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-semibold text-sm text-slate-700">변환 결과 (Markdown)</p>
                      <button onClick={downloadMd} className="text-sm bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg transition-colors">.md 다운로드</button>
                    </div>
                    <textarea readOnly value={pdf2mdResult} className="w-full min-h-[360px] border border-slate-200 rounded-xl p-3 text-sm font-mono text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300"/>
                    <p className="text-xs text-slate-400 mt-2">※ PDF의 텍스트만 추출합니다. 스캔(이미지) PDF나 복잡한 단·표 레이아웃은 결과가 정확하지 않을 수 있습니다.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab==="annotate" && (
          <div>
            {!annFile && (
              <div className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${annDragOver?"border-rose-500 bg-rose-50":"border-rose-300 bg-white hover:border-rose-500"}`}
                onDragOver={e=>{e.preventDefault();setAnnDragOver(true);}} onDragLeave={()=>setAnnDragOver(false)}
                onDrop={e=>{e.preventDefault();setAnnDragOver(false);const f=e.dataTransfer.files?.[0];if(f)loadAnnFile(f);}}
                onClick={()=>document.getElementById("annInput")?.click()}>
                <input id="annInput" type="file" accept="application/pdf" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)loadAnnFile(f);e.currentTarget.value="";}}/>
                <svg className="mx-auto mb-3 w-12 h-12 text-rose-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                <p className="text-gray-500">주석을 추가할 PDF를 드래그하거나 클릭하여 업로드</p>
                <p className="text-gray-400 text-xs mt-1">텍스트 주석과 형광펜 마킹을 추가해 새 PDF로 저장합니다</p>
              </div>
            )}

            {annError&&<div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-3 text-sm">{annError}</div>}

            {annFile&&(
              <>
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-2.5 mb-3 flex flex-wrap items-center gap-2">
                  <div className="flex gap-1">
                    {([["move","🖱 이동"],["text","📝 텍스트"],["highlight","🖍 형광펜"],["eraser","🧽 지우개"]] as const).map(([key,label])=>(
                      <button key={key} onClick={()=>setAnnTool(key)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${annTool===key?"bg-rose-600 text-white":"text-slate-500 hover:bg-slate-100"}`}>{label}</button>
                    ))}
                  </div>

                  {annTool==="highlight"&&(
                    <div className="flex items-center gap-1.5 pl-2 ml-1 border-l border-slate-200">
                      {HL_COLORS.map((c,i)=>(
                        <button key={c.hex} onClick={()=>setHlIdx(i)} title={c.name} className={`w-5 h-5 rounded-full transition-transform ${hlIdx===i?"ring-2 ring-offset-1 ring-slate-400 scale-110":"border border-slate-200"}`} style={{background:c.hex}}/>
                      ))}
                    </div>
                  )}
                  {annTool==="text"&&<span className="text-xs text-slate-400 pl-1">페이지를 클릭해 주석을 추가하세요</span>}
                  {annTool==="eraser"&&<span className="text-xs text-slate-400 pl-1">지울 주석/형광펜을 클릭하세요</span>}

                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={addTextCenter} className="text-xs font-medium text-rose-600 hover:text-rose-700 px-2 py-1.5">+ 주석 삽입</button>
                    <div className="flex items-center gap-1 text-slate-600 px-1">
                      <button onClick={()=>goAnnPage(annPageNum-1)} disabled={annPageNum<=1} className="w-7 h-7 rounded-lg hover:bg-slate-100 disabled:opacity-30 font-bold">‹</button>
                      <span className="tabular-nums text-xs w-12 text-center">{annPageNum} / {annNumPages}</span>
                      <button onClick={()=>goAnnPage(annPageNum+1)} disabled={annPageNum>=annNumPages} className="w-7 h-7 rounded-lg hover:bg-slate-100 disabled:opacity-30 font-bold">›</button>
                    </div>
                    <button onClick={()=>{setAnnFile(null);setAnnPage(null);setAnns([]);annBufRef.current=null;}} className="text-xs text-slate-400 hover:text-slate-600 px-1">다른 PDF</button>
                    <button onClick={saveAnnotated} disabled={annSaving} className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors">{annSaving?"저장 중…":"주석 저장(PDF)"}</button>
                  </div>
                </div>

                <div className="bg-slate-100 rounded-2xl p-4 overflow-auto flex justify-center" style={{maxHeight:640}}>
                  {annLoading&&!annPage&&<div className="py-20 text-sm text-slate-400">불러오는 중…</div>}
                  {annPage&&(
                    <div className="relative shadow-lg bg-white shrink-0" style={{width:annPage.dispW,height:annPage.dispH}}>
                      <img src={annPage.url} alt={`page ${annPageNum}`} width={annPage.dispW} height={annPage.dispH} draggable={false} className="block select-none"/>
                      <div ref={annOverlayRef} className="absolute inset-0"
                        style={{cursor: annTool==="highlight"?"crosshair":annTool==="eraser"?"pointer":annTool==="text"?"copy":"default", touchAction:"none"}}
                        onPointerDown={onAnnDown} onPointerMove={onAnnMove} onPointerUp={onAnnUp} onClick={onAnnClickAdd}>

                        {anns.filter(a=>a.page===annPageNum&&a.type==="hi").map(a=>{const h=a as AnnHi;return(
                          <div key={h.id} onClick={(e)=>{e.stopPropagation();if(annTool==="eraser")setAnns(prev=>prev.filter(x=>x.id!==h.id));}} className={annTool==="eraser"?"cursor-pointer hover:outline hover:outline-2 hover:outline-rose-400":""}
                            style={{position:"absolute",left:h.xPct*annPage.dispW,top:h.yPct*annPage.dispH,width:h.wPct*annPage.dispW,height:h.hPct*annPage.dispH,background:h.hex,opacity:0.4,mixBlendMode:"multiply",borderRadius:2}}/>
                        );})}

                        {drawRect&&annTool==="highlight"&&(
                          <div className="absolute pointer-events-none" style={{left:drawRect.x,top:drawRect.y,width:drawRect.w,height:drawRect.h,background:HL_COLORS[hlIdx].hex,opacity:0.4,mixBlendMode:"multiply",borderRadius:2}}/>
                        )}

                        {anns.filter(a=>a.page===annPageNum&&a.type==="text").map(a=>{const t=a as AnnText;return(
                          <div key={t.id} className="absolute" style={{left:t.xPct*annPage.dispW,top:t.yPct*annPage.dispH,width:t.wPct*annPage.dispW}}
                            onClick={(e)=>{e.stopPropagation();if(annTool==="eraser")setAnns(prev=>prev.filter(x=>x.id!==t.id));}}>
                            {annTool!=="eraser"&&(
                              <div onPointerDown={(e)=>startTextMove(e,t.id)} className="absolute -top-5 left-0 right-0 h-5 bg-amber-400 rounded-t-md cursor-move flex items-center justify-between px-1.5 text-white text-[10px] select-none">
                                <span>⠿ 이동</span>
                                <button onClick={(e)=>{e.stopPropagation();setAnns(prev=>prev.filter(x=>x.id!==t.id));}} className="hover:bg-amber-500 rounded px-1 leading-none">×</button>
                              </div>
                            )}
                            <textarea value={t.text} onChange={(e)=>updateText(t.id,e.target.value)} onPointerDown={e=>e.stopPropagation()} readOnly={annTool==="eraser"}
                              className="w-full resize-none rounded-b-md rounded-tr-md border border-amber-400 bg-amber-50/95 p-1.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-300 shadow-sm overflow-hidden"
                              style={{fontSize:annPage.dispW*0.019,lineHeight:1.4}} rows={Math.max(1,(t.text.match(/\n/g)?.length??0)+1)}/>
                          </div>
                        );})}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-2 text-center">텍스트는 이미지로, 형광펜은 도형으로 PDF에 저장됩니다 · 모든 처리는 브라우저에서 수행됩니다</p>
              </>
            )}
          </div>
        )}

        {/* ===== Features ===== */}
        <section className="mt-16 pt-10 border-t border-slate-200">
          <h2 className="text-center text-xl font-bold tracking-tight text-slate-900 mb-2">강의 준비에 필요한 모든 것</h2>
          <p className="text-center text-sm text-slate-500 mb-9">군더더기 없이, 꼭 필요한 기능만 담았습니다.</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {([
              ["안전한 파일 처리","업로드한 파일은 서버로 전송되지 않고 사용자의 브라우저 안에서만 처리됩니다. 작업이 끝나면 어떤 데이터도 남지 않아 민감한 강의 자료도 안심하고 다룰 수 있습니다.","M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"],
              ["자유로운 페이지 편집","원하는 페이지를 자르고, 붙이고, 삭제하고, 다른 PDF의 페이지를 끼워 넣을 수 있습니다. 여러 자료를 합치거나 순서를 바꿔 강의 흐름에 맞게 재구성하세요.","M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"],
              ["직관적인 사용법","드래그 한 번이면 충분합니다. 복잡한 설정도, 프로그램 설치도, 회원가입도 없이 누구나 열어서 바로 사용할 수 있습니다.","M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"],
            ] as const).map(([title,desc,icon])=>(
              <div key={title} className="bg-white border border-slate-200 rounded-2xl p-6 transition-shadow hover:shadow-md">
                <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={icon}/></svg>
                </div>
                <h3 className="font-semibold text-slate-800 mb-1.5">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-12 pb-2 text-center">
          {views !== null && (
            <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 text-slate-500 text-xs font-medium px-3 py-1.5 rounded-full shadow-sm mb-3">
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
              지금까지 <span className="font-bold text-slate-700">{views.toLocaleString("ko-KR")}</span>명이 방문했어요
            </div>
          )}
          <p className="text-xs text-slate-400">강의용 PDF 편집기 · 모든 작업은 사용자의 브라우저에서 안전하게 처리됩니다.</p>
        </footer>

      </div>
    </main>
  );
}

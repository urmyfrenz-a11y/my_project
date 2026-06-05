"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { PDFDocument } from "pdf-lib";

type Tab = "split" | "merge" | "edit";
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
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-indigo-700 mb-2">PDF 도구</h1>
          <p className="text-gray-500">PDF를 쉽게 분할하거나 여러 PDF를 하나로 합치세요</p>
        </div>

        <div className="flex bg-white rounded-2xl shadow-sm p-1.5 mb-6 gap-1.5">
          {([  ["split","✂️ PDF 분할","indigo"],["merge","🔗 PDF 합치기","emerald"],["edit","✏️ 페이지 편집","violet"] ] as const).map(([key,label,color])=>(
            <button key={key} onClick={()=>setTab(key)} className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${tab===key ? color==="indigo"?"bg-indigo-600 text-white shadow-sm":color==="emerald"?"bg-emerald-600 text-white shadow-sm":"bg-violet-600 text-white shadow-sm" : color==="indigo"?"text-gray-500 hover:text-indigo-600":color==="emerald"?"text-gray-500 hover:text-emerald-600":"text-gray-500 hover:text-violet-600"}`}>{label}</button>
          ))}
        </div>

        {tab==="split" && (
          <div className="max-w-2xl mx-auto">
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
          <div className="max-w-2xl mx-auto">
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

                    {/* Thumbnail grid — each thumb is a drag target; cursor X decides insert position */}
                    {editThumbs.length>0&&(
                      <div className="overflow-y-auto flex-1" style={{maxHeight:440}}>
                        {/*
                          Each thumbnail handles onDragOver and uses e.clientX vs its rect
                          to decide whether to insert BEFORE (left half) or AFTER (right half).
                          dropZoneIndex 0 = before page 1, N = after page N.
                          The line is rendered as an absolutely-positioned bar on the
                          left or right edge of the thumb it straddles.
                        */}
                        <div
                          className="flex flex-wrap p-1"
                          style={{gap:"10px 10px"}}
                          onDragLeave={e=>{
                            // Only clear when truly leaving the container
                            if(!e.currentTarget.contains(e.relatedTarget as Node))setDropZoneIndex(null);
                          }}
                        >
                          {editThumbs.map((t,idx)=>{
                            const showLeft  = dropZoneIndex===idx;          // line on left edge
                            const showRight = dropZoneIndex===editThumbs.length && idx===editThumbs.length-1; // line on right edge of last
                            return (
                              <div
                                key={t.pageNum}
                                className="relative group"
                                style={{width:80}}
                                onDragEnter={e=>{e.preventDefault();e.stopPropagation();if(!e.dataTransfer.types.includes("Files"))setDropZoneIndex(getDropIdx(e,idx));}}
                                onDragOver={e=>{e.preventDefault();e.stopPropagation();if(!e.dataTransfer.types.includes("Files"))setDropZoneIndex(getDropIdx(e,idx));}}
                                onDrop={e=>{e.preventDefault();e.stopPropagation();const pos=dropZoneIndex??idx;setDropZoneIndex(null);applyInsert(pos,dragPayloadRef.current);}}
                              >
                                {/* Left insertion line */}
                                {showLeft&&(
                                  <div className="absolute inset-y-0 -left-1.5 z-20 flex items-center pointer-events-none">
                                    <div className="w-0.5 rounded-full bg-violet-500" style={{height:"100%",minHeight:90,boxShadow:"0 0 6px rgba(139,92,246,0.7)"}} />
                                  </div>
                                )}
                                {/* Right insertion line (after last page) */}
                                {showRight&&(
                                  <div className="absolute inset-y-0 -right-1.5 z-20 flex items-center pointer-events-none">
                                    <div className="w-0.5 rounded-full bg-violet-500" style={{height:"100%",minHeight:90,boxShadow:"0 0 6px rgba(139,92,246,0.7)"}} />
                                  </div>
                                )}
                                <div className="rounded-xl overflow-hidden border-2 border-gray-200 hover:border-gray-300 transition-colors">
                                  <img src={t.dataUrl} className="w-full block" alt={`p${t.pageNum}`}/>
                                  <div className="text-center text-xs py-1 bg-gray-50 text-gray-500">{t.pageNum}</div>
                                </div>
                                {/* Per-page delete button */}
                                <button
                                  onClick={e=>{e.stopPropagation();deleteBasePage(t.pageNum);}}
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 rounded-full text-white text-xs hidden group-hover:flex items-center justify-center shadow z-10 transition-colors"
                                  title="이 페이지 삭제"
                                >×</button>
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

      </div>
    </main>
  );
}

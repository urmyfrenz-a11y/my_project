"use client";

import { useState, useCallback, useRef } from "react";
import { PDFDocument } from "pdf-lib";

type Tab = "split" | "merge";
type SplitMode = "count" | "size" | "range";

interface PageRange { from: number; to: number; }
interface SplitResult { name: string; blob: Blob; pages: string; sizeMB: number; }
interface MergeFile { file: File; pages: number | null; }

export default function Home() {
  const [tab, setTab] = useState<Tab>("split");

  // ── split state ──────────────────────────────────────────────────────────
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

  // ── merge state ──────────────────────────────────────────────────────────
  const [mergeFiles, setMergeFiles] = useState<MergeFile[]>([]);
  const [mergeResult, setMergeResult] = useState<{ blob: Blob; sizeMB: number } | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [mergeDragging, setMergeDragging] = useState(false);

  // ── split handlers ───────────────────────────────────────────────────────
  const loadSplitFile = async (f: File) => {
    setSplitFile(f);
    setSplitResults([]);
    setSplitError("");
    try {
      const buf = await f.arrayBuffer();
      splitBufRef.current = buf;
      const pdf = await PDFDocument.load(buf);
      const n = pdf.getPageCount();
      setTotalPages(n);
      setRanges([{ from: 1, to: n }]);
    } catch {
      setSplitError("PDF 파일을 읽을 수 없습니다.");
      setTotalPages(null);
    }
  };

  const onSplitDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setSplitDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f?.type === "application/pdf") loadSplitFile(f);
    else setSplitError("PDF 파일만 업로드할 수 있습니다.");
  }, []);

  const split = async () => {
    if (!splitFile || !totalPages) return;
    setSplitLoading(true);
    setSplitError("");
    setSplitResults([]);
    try {
      const buf = splitBufRef.current ?? (await splitFile.arrayBuffer());
      const src = await PDFDocument.load(buf);
      const pageCount = src.getPageCount();
      let chunks: { pages: number[]; label: string }[] = [];

      if (splitMode === "count") {
        if (splitCount < 2 || splitCount > pageCount) {
          setSplitError(`분할 개수는 2 이상 ${pageCount} 이하여야 합니다.`);
          return;
        }
        const base = Math.floor(pageCount / splitCount);
        const extra = pageCount % splitCount;
        let cur = 0;
        for (let i = 0; i < splitCount; i++) {
          const len = base + (i < extra ? 1 : 0);
          if (len > 0) { chunks.push({ pages: Array.from({ length: len }, (_, j) => cur + j), label: `part${i + 1}` }); cur += len; }
        }
      } else if (splitMode === "size") {
        const maxBytes = maxSizeMB * 1024 * 1024;
        let cur: number[] = [], idx = 1;
        for (let i = 0; i < pageCount; i++) {
          cur.push(i);
          const tmp = await PDFDocument.create();
          const pp = await tmp.copyPages(src, cur);
          pp.forEach(p => tmp.addPage(p));
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
        const copied = await doc.copyPages(src, pp);
        copied.forEach(p => doc.addPage(p));
        const bytes = await doc.save();
        results.push({
          name: `${splitFile.name.replace(/\.pdf$/i, "")}_${label}.pdf`,
          blob: new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
          pages: pp[0] + 1 === pp[pp.length - 1] + 1 ? `${pp[0] + 1}` : `${pp[0] + 1}–${pp[pp.length - 1] + 1}`,
          sizeMB: bytes.length / 1024 / 1024,
        });
      }
      setSplitResults(results);
    } catch (e) {
      setSplitError("PDF 분할 중 오류: " + (e as Error).message);
    } finally {
      setSplitLoading(false);
    }
  };

  const downloadAllSplit = () => {
    splitResults.forEach(r => {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement("a"); a.href = url; a.download = r.name; a.click();
      URL.revokeObjectURL(url);
    });
  };

  // ── merge handlers ───────────────────────────────────────────────────────
  const addMergeFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type === "application/pdf");
    if (!arr.length) { setMergeError("PDF 파일만 추가할 수 있습니다."); return; }
    setMergeError("");
    setMergeResult(null);
    const loaded: MergeFile[] = await Promise.all(
      arr.map(async (file) => {
        try {
          const buf = await file.arrayBuffer();
          const pdf = await PDFDocument.load(buf);
          return { file, pages: pdf.getPageCount() };
        } catch {
          return { file, pages: null };
        }
      })
    );
    setMergeFiles(prev => [...prev, ...loaded]);
  };

  const onMergeDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setMergeDragging(false);
    addMergeFiles(e.dataTransfer.files);
  }, []);

  const removeMergeFile = (i: number) => setMergeFiles(prev => prev.filter((_, j) => j !== i));
  const moveMergeFile = (i: number, dir: -1 | 1) => {
    setMergeFiles(prev => {
      const arr = [...prev];
      const tmp = arr[i]; arr[i] = arr[i + dir]; arr[i + dir] = tmp;
      return arr;
    });
  };

  const merge = async () => {
    if (mergeFiles.length < 2) { setMergeError("2개 이상의 PDF 파일을 추가하세요."); return; }
    setMergeLoading(true);
    setMergeError("");
    setMergeResult(null);
    try {
      const merged = await PDFDocument.create();
      for (const { file } of mergeFiles) {
        const buf = await file.arrayBuffer();
        const src = await PDFDocument.load(buf);
        const indices = Array.from({ length: src.getPageCount() }, (_, i) => i);
        const copied = await merged.copyPages(src, indices);
        copied.forEach(p => merged.addPage(p));
      }
      const bytes = await merged.save();
      setMergeResult({ blob: new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }), sizeMB: bytes.length / 1024 / 1024 });
    } catch (e) {
      setMergeError("PDF 합치기 중 오류: " + (e as Error).message);
    } finally {
      setMergeLoading(false);
    }
  };

  const downloadMerged = () => {
    if (!mergeResult) return;
    const firstName = mergeFiles[0]?.file.name.replace(/\.pdf$/i, "") ?? "merged";
    const url = URL.createObjectURL(mergeResult.blob);
    const a = document.createElement("a"); a.href = url; a.download = `${firstName}_합본.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-indigo-700 mb-2">PDF 도구</h1>
          <p className="text-gray-500">PDF를 쉽게 분할하거나 여러 PDF를 하나로 합치세요</p>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-white rounded-2xl shadow-sm p-1.5 mb-6 gap-1.5">
          <button
            onClick={() => setTab("split")}
            className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${
              tab === "split" ? "bg-indigo-600 text-white shadow-sm" : "text-gray-500 hover:text-indigo-600"
            }`}
          >
            ✂️ PDF 분할하기
          </button>
          <button
            onClick={() => setTab("merge")}
            className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors ${
              tab === "merge" ? "bg-emerald-600 text-white shadow-sm" : "text-gray-500 hover:text-emerald-600"
            }`}
          >
            🔗 PDF 합치기
          </button>
        </div>

        {/* ── SPLIT TAB ─────────────────────────────────────────────────── */}
        {tab === "split" && (
          <>
            {/* Upload */}
            <div
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors mb-6 ${
                splitDragging ? "border-indigo-500 bg-indigo-50" : "border-indigo-300 bg-white hover:border-indigo-500"
              }`}
              onDragOver={(e) => { e.preventDefault(); setSplitDragging(true); }}
              onDragLeave={() => setSplitDragging(false)}
              onDrop={onSplitDrop}
              onClick={() => document.getElementById("splitInput")?.click()}
            >
              <input id="splitInput" type="file" accept="application/pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) loadSplitFile(f); }} />
              {splitFile ? (
                <div>
                  <p className="text-indigo-700 font-semibold text-lg">{splitFile.name}</p>
                  <p className="text-gray-400 text-sm mt-1">
                    {totalPages !== null ? `총 ${totalPages}페이지` : ""} · {(splitFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <p className="text-gray-400 text-xs mt-2">클릭하여 다른 파일 선택</p>
                </div>
              ) : (
                <div>
                  <svg className="mx-auto mb-3 w-12 h-12 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-gray-500">PDF 파일을 드래그하거나 클릭하여 업로드</p>
                </div>
              )}
            </div>

            {splitFile && totalPages && (
              <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
                <p className="font-semibold text-gray-700 mb-4">분할 방식 선택</p>
                <div className="flex gap-2 mb-4">
                  {(["count", "size", "range"] as SplitMode[]).map(m => (
                    <button key={m} onClick={() => setSplitMode(m)}
                      className={`flex-1 py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                        splitMode === m
                          ? m === "range" ? "border-violet-500 bg-violet-50 text-violet-700" : "border-indigo-500 bg-indigo-50 text-indigo-700"
                          : "border-gray-200 text-gray-500 hover:border-indigo-300"
                      }`}
                    >
                      {m === "count" ? "분할 개수" : m === "size" ? "최대 파일 크기" : "페이지 범위"}
                    </button>
                  ))}
                </div>

                {splitMode === "count" && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-2">
                      몇 개의 파일로 나눌까요? <span className="text-gray-400">(최대 {totalPages}개)</span>
                    </label>
                    <input type="number" min={2} max={totalPages} value={splitCount}
                      onChange={e => setSplitCount(Number(e.target.value))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    <p className="text-xs text-gray-400 mt-2">페이지를 최대한 균등하게 나눕니다.</p>
                  </div>
                )}
                {splitMode === "size" && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-2">파일당 최대 크기 (MB)</label>
                    <input type="number" min={0.1} step={0.1} value={maxSizeMB}
                      onChange={e => setMaxSizeMB(Number(e.target.value))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    <p className="text-xs text-gray-400 mt-2">각 파일이 지정한 크기를 초과하지 않도록 분할합니다.</p>
                  </div>
                )}
                {splitMode === "range" && (
                  <div>
                    <p className="text-sm text-gray-600 mb-3">분할할 페이지 범위 입력 <span className="text-gray-400">(총 {totalPages}페이지)</span></p>
                    <div className="space-y-2">
                      {ranges.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-gray-400 text-sm w-14 shrink-0">파일 {i + 1}</span>
                          <input type="number" min={1} max={totalPages} value={r.from}
                            onChange={e => setRanges(prev => prev.map((x, j) => j === i ? { ...x, from: Number(e.target.value) } : x))}
                            className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300" />
                          <span className="text-gray-400">–</span>
                          <input type="number" min={1} max={totalPages} value={r.to}
                            onChange={e => setRanges(prev => prev.map((x, j) => j === i ? { ...x, to: Number(e.target.value) } : x))}
                            className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300" />
                          <span className="text-gray-400 text-xs">페이지</span>
                          {ranges.length > 1 && (
                            <button onClick={() => setRanges(prev => prev.filter((_, j) => j !== i))}
                              className="ml-auto text-gray-300 hover:text-red-400 text-xl px-1">×</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setRanges(prev => [...prev, { from: 1, to: totalPages ?? 1 }])}
                      className="mt-3 w-full py-2 border-2 border-dashed border-violet-200 text-violet-500 hover:border-violet-400 hover:text-violet-600 rounded-xl text-sm font-medium transition-colors">
                      + 범위 추가
                    </button>
                  </div>
                )}

                <button onClick={split} disabled={splitLoading}
                  className={`mt-5 w-full disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors ${
                    splitMode === "range" ? "bg-violet-600 hover:bg-violet-700" : "bg-indigo-600 hover:bg-indigo-700"
                  }`}>
                  {splitLoading ? "분할 중…" : "PDF 분할하기"}
                </button>
              </div>
            )}

            {splitError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">{splitError}</div>}

            {splitResults.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <p className="font-semibold text-gray-700">분할 결과 ({splitResults.length}개)</p>
                  <button onClick={downloadAllSplit} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg transition-colors">전체 다운로드</button>
                </div>
                <ul className="space-y-2">
                  {splitResults.map((r, i) => (
                    <li key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                      <div className="min-w-0 flex-1 mr-4">
                        <p className="text-sm font-medium text-gray-700 truncate" title={r.name}>{r.name}</p>
                        <p className="text-xs text-gray-400">페이지 {r.pages} · {r.sizeMB.toFixed(2)} MB</p>
                      </div>
                      <a href={URL.createObjectURL(r.blob)} download={r.name}
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium shrink-0">다운로드</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* ── MERGE TAB ─────────────────────────────────────────────────── */}
        {tab === "merge" && (
          <>
            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors mb-4 ${
                mergeDragging ? "border-emerald-500 bg-emerald-50" : "border-emerald-300 bg-white hover:border-emerald-500"
              }`}
              onDragOver={(e) => { e.preventDefault(); setMergeDragging(true); }}
              onDragLeave={() => setMergeDragging(false)}
              onDrop={onMergeDrop}
              onClick={() => document.getElementById("mergeInput")?.click()}
            >
              <input id="mergeInput" type="file" accept="application/pdf" multiple className="hidden"
                onChange={e => { if (e.target.files) addMergeFiles(e.target.files); e.target.value = ""; }} />
              <svg className="mx-auto mb-3 w-10 h-10 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <p className="text-gray-500 text-sm">PDF 파일을 드래그하거나 클릭하여 추가</p>
              <p className="text-gray-400 text-xs mt-1">여러 파일을 한 번에 선택할 수 있습니다</p>
            </div>

            {/* File list */}
            {mergeFiles.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-gray-700">합칠 파일 목록 ({mergeFiles.length}개)</p>
                  <button onClick={() => { setMergeFiles([]); setMergeResult(null); }}
                    className="text-xs text-gray-400 hover:text-red-400 transition-colors">전체 삭제</button>
                </div>
                <ul className="space-y-2 mb-4">
                  {mergeFiles.map((mf, i) => (
                    <li key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => i > 0 && moveMergeFile(i, -1)} disabled={i === 0}
                          className="text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none text-sm">▲</button>
                        <button onClick={() => i < mergeFiles.length - 1 && moveMergeFile(i, 1)} disabled={i === mergeFiles.length - 1}
                          className="text-gray-300 hover:text-gray-500 disabled:opacity-20 leading-none text-sm">▼</button>
                      </div>
                      <span className="text-emerald-500 font-bold text-sm w-6 text-center shrink-0">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-700 truncate">{mf.file.name}</p>
                        <p className="text-xs text-gray-400">
                          {mf.pages !== null ? `${mf.pages}페이지` : "읽기 실패"} · {(mf.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button onClick={() => removeMergeFile(i)}
                        className="text-gray-300 hover:text-red-400 text-xl leading-none px-1 shrink-0">×</button>
                    </li>
                  ))}
                </ul>
                {mergeFiles.length >= 2 && (
                  <div className="bg-emerald-50 rounded-xl p-3 mb-4">
                    <p className="text-xs text-emerald-700 font-semibold mb-2">합쳐지는 순서</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {mergeFiles.map((mf, i) => (
                        <span key={i} className="contents">
                          <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-lg px-2 py-1 text-xs text-gray-700 max-w-[140px]">
                            <span className="text-emerald-500 font-bold shrink-0">{i + 1}</span>
                            <span className="truncate">{mf.file.name.replace(/\.pdf$/i, "")}</span>
                            {mf.pages !== null && <span className="text-emerald-400 shrink-0">({mf.pages}p)</span>}
                          </span>
                          {i < mergeFiles.length - 1 && <span className="text-emerald-400 font-bold text-sm">→</span>}
                        </span>
                      ))}
                      <span className="text-emerald-400 font-bold text-sm">→</span>
                      <span className="inline-flex items-center gap-1 bg-emerald-600 rounded-lg px-2 py-1 text-xs text-white font-semibold">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-3-3v6" /></svg>
                        합쳐진 PDF
                      </span>
                    </div>
                  </div>
                )}
                <button onClick={merge} disabled={mergeLoading || mergeFiles.length < 2}
                  className="w-full disabled:opacity-50 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors">
                  {mergeLoading ? "합치는 중…" : `PDF ${mergeFiles.length}개 합치기`}
                </button>
              </div>
            )}

            {mergeError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">{mergeError}</div>}

            {mergeResult && (
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-700">합치기 완료</p>
                    <p className="text-xs text-gray-400">{mergeResult.sizeMB.toFixed(2)} MB</p>
                  </div>
                  <button onClick={downloadMerged}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors shrink-0">
                    다운로드
                  </button>
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </main>
  );
}

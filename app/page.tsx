"use client";

import { useState, useCallback, useRef } from "react";
import { PDFDocument } from "pdf-lib";

type SplitMode = "count" | "size" | "range";

interface PageRange {
  from: number;
  to: number;
}

interface SplitResult {
  name: string;
  blob: Blob;
  pages: string;
  sizeMB: number;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SplitMode>("count");
  const [splitCount, setSplitCount] = useState<number>(2);
  const [maxSizeMB, setMaxSizeMB] = useState<number>(5);
  const [results, setResults] = useState<SplitResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ranges, setRanges] = useState<PageRange[]>([{ from: 1, to: 1 }]);
  const rawBufRef = useRef<ArrayBuffer | null>(null);

  const loadFile = async (f: File) => {
    setFile(f);
    setResults([]);
    setError("");
    setRanges([{ from: 1, to: 1 }]);
    try {
      const buf = await f.arrayBuffer();
      rawBufRef.current = buf;
      const pdf = await PDFDocument.load(buf);
      const pages = pdf.getPageCount();
      setTotalPages(pages);
      setRanges([{ from: 1, to: pages }]);
    } catch {
      setError("PDF 파일을 읽을 수 없습니다.");
      setTotalPages(null);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === "application/pdf") loadFile(f);
    else setError("PDF 파일만 업로드할 수 있습니다.");
  }, []);

  const split = async () => {
    if (!file || !totalPages) return;
    setLoading(true);
    setError("");
    setResults([]);

    try {
      const buf = rawBufRef.current ?? (await file.arrayBuffer());
      const srcPdf = await PDFDocument.load(buf);
      const pageCount = srcPdf.getPageCount();
      let chunks: { pages: number[]; label: string }[] = [];

      if (mode === "count") {
        if (splitCount < 2 || splitCount > pageCount) {
          setError(`분할 개수는 2 이상 ${pageCount} 이하여야 합니다.`);
          setLoading(false);
          return;
        }
        const base = Math.floor(pageCount / splitCount);
        const extra = pageCount % splitCount;
        let cur = 0;
        for (let i = 0; i < splitCount; i++) {
          const len = base + (i < extra ? 1 : 0);
          if (len > 0) {
            chunks.push({
              pages: Array.from({ length: len }, (_, j) => cur + j),
              label: `part${i + 1}`,
            });
            cur += len;
          }
        }
      } else if (mode === "size") {
        const maxBytes = maxSizeMB * 1024 * 1024;
        let currentPages: number[] = [];
        let partIndex = 1;
        for (let i = 0; i < pageCount; i++) {
          currentPages.push(i);
          const testDoc = await PDFDocument.create();
          const pages = await testDoc.copyPages(srcPdf, currentPages);
          pages.forEach((p) => testDoc.addPage(p));
          const testBytes = await testDoc.save();
          if (testBytes.length > maxBytes && currentPages.length > 1) {
            chunks.push({ pages: currentPages.slice(0, -1), label: `part${partIndex++}` });
            currentPages = [i];
          }
        }
        if (currentPages.length > 0)
          chunks.push({ pages: currentPages, label: `part${partIndex}` });
      } else {
        for (let i = 0; i < ranges.length; i++) {
          const from = ranges[i].from - 1;
          const to = ranges[i].to - 1;
          if (from < 0 || to >= pageCount || from > to) {
            setError(`범위 ${i + 1}: 유효하지 않은 페이지 범위입니다. (1–${pageCount})`);
            setLoading(false);
            return;
          }
          chunks.push({
            pages: Array.from({ length: to - from + 1 }, (_, j) => from + j),
            label: `part${i + 1}`,
          });
        }
      }

      const newResults: SplitResult[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const { pages: chunkPages, label } = chunks[i];
        const newDoc = await PDFDocument.create();
        const copied = await newDoc.copyPages(srcPdf, chunkPages);
        copied.forEach((p) => newDoc.addPage(p));
        const bytes = await newDoc.save();
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const start = chunkPages[0] + 1;
        const end = chunkPages[chunkPages.length - 1] + 1;
        newResults.push({
          name: `${file.name.replace(/\.pdf$/i, "")}_${label}.pdf`,
          blob,
          pages: start === end ? `${start}` : `${start}–${end}`,
          sizeMB: bytes.length / 1024 / 1024,
        });
      }

      if (mode !== "range") {
        const totalSplit = newResults.reduce((sum, r) => {
          const [a, b] = r.pages.includes("–")
            ? r.pages.split("–").map(Number)
            : [Number(r.pages), Number(r.pages)];
          return sum + (b - a + 1);
        }, 0);
        if (totalSplit !== pageCount) {
          setError("분할 중 오류가 발생했습니다. 페이지 수가 맞지 않습니다.");
          setLoading(false);
          return;
        }
      }
      setResults(newResults);
    } catch (e) {
      setError("PDF 분할 중 오류가 발생했습니다: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const downloadAll = () => {
    results.forEach((r) => {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-indigo-700 mb-2">PDF 분할기</h1>
          <p className="text-gray-500">PDF 파일을 페이지 기준으로 손쉽게 분할하세요</p>
        </div>

        {/* Upload */}
        <div
          className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors mb-6 ${
            dragging
              ? "border-indigo-500 bg-indigo-50"
              : "border-indigo-300 bg-white hover:border-indigo-500"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById("fileInput")?.click()}
        >
          <input
            id="fileInput"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={onFileChange}
          />
          {file ? (
            <div>
              <p className="text-indigo-700 font-semibold text-lg">{file.name}</p>
              <p className="text-gray-400 text-sm mt-1">
                {totalPages !== null ? `총 ${totalPages}페이지` : ""} ·{" "}
                {(file.size / 1024 / 1024).toFixed(2)} MB
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

        {/* Options */}
        {file && totalPages && (
          <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
            <p className="font-semibold text-gray-700 mb-4">분할 방식 선택</p>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setMode("count")}
                className={`flex-1 py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                  mode === "count"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-500 hover:border-indigo-300"
                }`}
              >
                분할 개수
              </button>
              <button
                onClick={() => setMode("size")}
                className={`flex-1 py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                  mode === "size"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-500 hover:border-indigo-300"
                }`}
              >
                최대 파일 크기
              </button>
              <button
                onClick={() => setMode("range")}
                className={`flex-1 py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                  mode === "range"
                    ? "border-violet-500 bg-violet-50 text-violet-700"
                    : "border-gray-200 text-gray-500 hover:border-violet-300"
                }`}
              >
                페이지 범위
              </button>
            </div>

            {mode === "count" && (
              <div>
                <label className="block text-sm text-gray-600 mb-2">
                  몇 개의 파일로 나눌까요?{" "}
                  <span className="text-gray-400">(최대 {totalPages}개)</span>
                </label>
                <input
                  type="number"
                  min={2}
                  max={totalPages}
                  value={splitCount}
                  onChange={(e) => setSplitCount(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <p className="text-xs text-gray-400 mt-2">
                  페이지를 최대한 균등하게 나눕니다.
                </p>
              </div>
            )}

            {mode === "size" && (
              <div>
                <label className="block text-sm text-gray-600 mb-2">파일당 최대 크기 (MB)</label>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={maxSizeMB}
                  onChange={(e) => setMaxSizeMB(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <p className="text-xs text-gray-400 mt-2">
                  각 파일이 지정한 크기를 초과하지 않도록 페이지 단위로 분할합니다.
                </p>
              </div>
            )}

            {mode === "range" && (
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  분할할 페이지 범위를 입력하세요{" "}
                  <span className="text-gray-400">(총 {totalPages}페이지)</span>
                </p>
                <div className="space-y-2">
                  {ranges.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm w-14 shrink-0">파일 {i + 1}</span>
                      <input
                        type="number"
                        min={1}
                        max={totalPages ?? 1}
                        value={r.from}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRanges((prev) => prev.map((x, j) => j === i ? { ...x, from: v } : x));
                        }}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300"
                      />
                      <span className="text-gray-400 text-sm">–</span>
                      <input
                        type="number"
                        min={1}
                        max={totalPages ?? 1}
                        value={r.to}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setRanges((prev) => prev.map((x, j) => j === i ? { ...x, to: v } : x));
                        }}
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300"
                      />
                      <span className="text-gray-400 text-xs">페이지</span>
                      {ranges.length > 1 && (
                        <button
                          onClick={() => setRanges((prev) => prev.filter((_, j) => j !== i))}
                          className="ml-auto text-gray-300 hover:text-red-400 transition-colors text-xl leading-none px-1"
                          title="삭제"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setRanges((prev) => [...prev, { from: 1, to: totalPages ?? 1 }])}
                  className="mt-3 w-full py-2 border-2 border-dashed border-violet-200 text-violet-500 hover:border-violet-400 hover:text-violet-600 rounded-xl text-sm font-medium transition-colors"
                >
                  + 범위 추가
                </button>
              </div>
            )}

            <button
              onClick={split}
              disabled={loading}
              className={`mt-5 w-full disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors ${
                mode === "range"
                  ? "bg-violet-600 hover:bg-violet-700"
                  : "bg-indigo-600 hover:bg-indigo-700"
              }`}
            >
              {loading ? "분할 중…" : "PDF 분할하기"}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold text-gray-700">분할 결과 ({results.length}개)</p>
              <button
                onClick={downloadAll}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                전체 다운로드
              </button>
            </div>
            <ul className="space-y-2">
              {results.map((r, i) => (
                <li key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                  <div className="min-w-0 flex-1 mr-4">
                    <p className="text-sm font-medium text-gray-700 truncate" title={r.name}>
                      {r.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      페이지 {r.pages} · {r.sizeMB.toFixed(2)} MB
                    </p>
                  </div>
                  <a
                    href={URL.createObjectURL(r.blob)}
                    download={r.name}
                    className="text-indigo-600 hover:text-indigo-800 text-sm font-medium shrink-0"
                  >
                    다운로드
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

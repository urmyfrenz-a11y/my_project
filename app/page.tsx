"use client";

import { useState, useCallback, useRef } from "react";
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFObject,
} from "pdf-lib";

type SplitMode = "count" | "size" | "chapter" | "range";

interface PageRange {
  from: number;
  to: number;
}

interface Chapter {
  title: string;
  startPage: number; // 0-indexed
}

interface SplitResult {
  name: string;
  blob: Blob;
  pages: string;
  sizeMB: number;
}

// ── pdf-lib outline parser ──────────────────────────────────────────────────

function decodeTitle(obj: PDFObject | undefined): string {
  if (!obj) return "";
  if (obj instanceof PDFString) return obj.decodeText();
  if (obj instanceof PDFHexString) return obj.decodeText();
  return "";
}

function searchNameTree(
  doc: PDFDocument,
  node: PDFObject | undefined,
  name: string,
  pageRefMap: Map<string, number>
): number {
  if (!(node instanceof PDFDict)) return -1;
  const namesArr = node.get(PDFName.of("Names"));
  if (namesArr) {
    const arr = doc.context.lookup(namesArr);
    if (arr instanceof PDFArray) {
      for (let i = 0; i < arr.size() - 1; i += 2) {
        const key = arr.get(i);
        const keyStr =
          key instanceof PDFString || key instanceof PDFHexString
            ? key.decodeText()
            : "";
        if (keyStr === name) {
          const val = doc.context.lookup(arr.get(i + 1));
          if (val instanceof PDFArray && val.size() > 0) {
            const first = val.get(0);
            if (first instanceof PDFRef)
              return pageRefMap.get(first.toString()) ?? -1;
          }
        }
      }
    }
  }
  const kidsArr = node.get(PDFName.of("Kids"));
  if (kidsArr) {
    const kids = doc.context.lookup(kidsArr);
    if (kids instanceof PDFArray) {
      for (let i = 0; i < kids.size(); i++) {
        const result = searchNameTree(
          doc,
          doc.context.lookup(kids.get(i)),
          name,
          pageRefMap
        );
        if (result >= 0) return result;
      }
    }
  }
  return -1;
}

function parseOutlineChapters(doc: PDFDocument): Chapter[] {
  try {
    const pageRefMap = new Map<string, number>();
    doc.getPages().forEach((p, i) => pageRefMap.set(p.ref.toString(), i));

    function lookupNamedDest(name: string): number {
      const oldDests = doc.catalog.get(PDFName.of("Dests"));
      if (oldDests) {
        const resolved = doc.context.lookup(oldDests);
        if (resolved instanceof PDFDict) {
          const entry = resolved.get(PDFName.of(name));
          if (entry) {
            const arr = doc.context.lookup(entry);
            if (arr instanceof PDFArray) return resolveDestToPage(arr);
            if (arr instanceof PDFDict) {
              const d = arr.get(PDFName.of("D"));
              if (d) return resolveDestToPage(doc.context.lookup(d) ?? d);
            }
          }
        }
      }
      const namesDict = doc.catalog.get(PDFName.of("Names"));
      if (namesDict) {
        const names = doc.context.lookup(namesDict);
        if (names instanceof PDFDict) {
          const destsTree = names.get(PDFName.of("Dests"));
          if (destsTree) {
            const page = searchNameTree(
              doc,
              doc.context.lookup(destsTree),
              name,
              pageRefMap
            );
            if (page >= 0) return page;
          }
        }
      }
      return -1;
    }

    function resolveDestToPage(dest: PDFObject): number {
      if (dest instanceof PDFString || dest instanceof PDFHexString)
        return lookupNamedDest(dest.decodeText());
      if (dest instanceof PDFName) return lookupNamedDest(dest.decodeText());
      if (dest instanceof PDFArray && dest.size() > 0) {
        const first = dest.get(0);
        if (first instanceof PDFRef)
          return pageRefMap.get(first.toString()) ?? -1;
        const maybeNum = first as unknown as { asNumber?: () => number };
        if (typeof maybeNum.asNumber === "function") return maybeNum.asNumber();
      }
      return -1;
    }

    const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
    if (!outlinesRef) return [];
    const outlines = doc.context.lookup(outlinesRef);
    if (!(outlines instanceof PDFDict)) return [];
    const firstRef = outlines.get(PDFName.of("First"));
    if (!firstRef) return [];

    const chapters: Chapter[] = [];
    let current = doc.context.lookup(firstRef);
    while (current instanceof PDFDict) {
      const title = decodeTitle(current.get(PDFName.of("Title")));
      let pageIndex = -1;
      const destObj = current.get(PDFName.of("Dest"));
      if (destObj) {
        pageIndex = resolveDestToPage(doc.context.lookup(destObj) ?? destObj);
      } else {
        const actionObj = current.get(PDFName.of("A"));
        if (actionObj) {
          const action = doc.context.lookup(actionObj);
          if (action instanceof PDFDict) {
            const s = action.get(PDFName.of("S"));
            if (s?.toString() === "/GoTo") {
              const d = action.get(PDFName.of("D"));
              if (d)
                pageIndex = resolveDestToPage(doc.context.lookup(d) ?? d);
            }
          }
        }
      }
      if (title && pageIndex >= 0) chapters.push({ title, startPage: pageIndex });
      const nextRef = current.get(PDFName.of("Next"));
      if (!nextRef) break;
      current = doc.context.lookup(nextRef);
    }
    chapters.sort((a, b) => a.startPage - b.startPage);
    return chapters.filter(
      (c, i) => i === 0 || c.startPage !== chapters[i - 1].startPage
    );
  } catch {
    return [];
  }
}

// ── pdfjs text-based chapter scanner ───────────────────────────────────────

const CHAPTER_PATTERNS = [
  /^제?\s*0*(\d+)\s*장\b/,
  /^chapter\s+(\d+)\b/i,
  /^(\d+)\.\s+(?!\d)[^\s]/,
  /^part\s+([IVXLCDM]+|\d+)\b/i,
];

async function scanChaptersByText(
  arrayBuffer: ArrayBuffer,
  onProgress: (cur: number, total: number) => void
): Promise<Chapter[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib = await (Function('return import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs")')() as Promise<any>);
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

  const data = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const total = pdf.numPages;

  const chapterByKey = new Map<string, { title: string; startPage: number }>();

  for (let pageNum = 1; pageNum <= total; pageNum++) {
    onProgress(pageNum, total);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    type TextItem = { str: string; transform: number[] };
    const items = (content.items as TextItem[]).filter((it) => it.str?.trim());
    if (items.length === 0) continue;

    const chapterKeysOnPage = new Set<string>();
    for (const item of items) {
      for (const pat of CHAPTER_PATTERNS) {
        const m = pat.exec(item.str.trim());
        if (m) { chapterKeysOnPage.add(m[1].toLowerCase()); break; }
      }
    }
    if (chapterKeysOnPage.size >= 2) continue;

    for (const item of items) {
      const text = item.str.trim();
      if (!text || text.length > 120) continue;

      for (const pat of CHAPTER_PATTERNS) {
        const m = pat.exec(text);
        if (!m) continue;
        const key = m[1].toLowerCase();
        if (!chapterByKey.has(key)) {
          chapterByKey.set(key, { title: text.slice(0, 80), startPage: pageNum - 1 });
        }
        break;
      }
    }
  }

  const candidates = Array.from(chapterByKey.values()).sort((a, b) => a.startPage - b.startPage);

  if (candidates.length >= 2) {
    const span = candidates[candidates.length - 1].startPage - candidates[0].startPage;
    if (span < Math.max(5, total * 0.05)) return [];
  }

  return candidates;
}

// ── React component ─────────────────────────────────────────────────────────

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
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ cur: number; total: number } | null>(null);
  const [textScanDone, setTextScanDone] = useState(false);
  const [ranges, setRanges] = useState<PageRange[]>([{ from: 1, to: 1 }]);
  const rawBufRef = useRef<ArrayBuffer | null>(null);

  const loadFile = async (f: File) => {
    setFile(f);
    setResults([]);
    setError("");
    setChapters([]);
    setTextScanDone(false);
    setScanProgress(null);
    setRanges([{ from: 1, to: 1 }]);
    try {
      const buf = await f.arrayBuffer();
      rawBufRef.current = buf;
      const pdf = await PDFDocument.load(buf);
      const pages = pdf.getPageCount();
      setTotalPages(pages);
      setRanges([{ from: 1, to: pages }]);
      const detected = parseOutlineChapters(pdf);
      setChapters(detected);
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

  const startTextScan = async () => {
    if (!rawBufRef.current) return;
    setScanning(true);
    setScanProgress({ cur: 0, total: totalPages ?? 0 });
    setError("");
    try {
      const found = await scanChaptersByText(rawBufRef.current, (cur, total) => {
        setScanProgress({ cur, total });
      });
      if (found.length === 0) {
        setError(
          "텍스트 스캔으로도 챕터를 찾지 못했습니다. 이 PDF는 챕터 제목이 이미지로 삽입되어 있거나 지원하지 않는 형식일 수 있습니다."
        );
      } else {
        setChapters(found);
        setMode("chapter");
      }
      setTextScanDone(true);
    } catch (e) {
      setError("텍스트 스캔 중 오류: " + (e as Error).message);
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  };

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
      } else if (mode === "range") {
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
      } else {
        if (chapters.length === 0) {
          setError("챕터 정보가 없습니다.");
          setLoading(false);
          return;
        }
        for (let i = 0; i < chapters.length; i++) {
          const start = chapters[i].startPage;
          const end =
            i + 1 < chapters.length ? chapters[i + 1].startPage - 1 : pageCount - 1;
          chunks.push({
            pages: Array.from({ length: end - start + 1 }, (_, j) => start + j),
            label: `ch${i + 1}`,
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
          name:
            mode === "chapter"
              ? `${file.name.replace(/\.pdf$/i, "")}_${label}_${chapters[i].title
                  .replace(/[\\/:*?"<>|]/g, "_")
                  .slice(0, 40)}.pdf`
              : `${file.name.replace(/\.pdf$/i, "")}_${label}.pdf`,
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

  const noBookmarks = file && totalPages && chapters.length === 0 && !textScanDone;

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
                {chapters.length > 0 && (
                  <span className="ml-2 text-emerald-500 font-medium">
                    · 챕터 {chapters.length}개 감지됨
                  </span>
                )}
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

        {/* Text scan banner */}
        {noBookmarks && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-6">
            <p className="text-sm text-amber-700 font-medium mb-1">
              내장 북마크를 찾지 못했습니다
            </p>
            <p className="text-xs text-amber-600 mb-3">
              PDF의 각 페이지에서 &quot;1장&quot;, &quot;제2장&quot;, &quot;Chapter 3&quot; 같은 텍스트를 직접 스캔하여 챕터를 감지할 수 있습니다.
            </p>
            {scanning && scanProgress ? (
              <div>
                <div className="flex justify-between text-xs text-amber-600 mb-1">
                  <span>페이지 스캔 중…</span>
                  <span>{scanProgress.cur} / {scanProgress.total}</span>
                </div>
                <div className="h-2 bg-amber-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-all"
                    style={{ width: `${(scanProgress.cur / scanProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={startTextScan}
                className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
              >
                텍스트로 챕터 자동 감지
              </button>
            )}
          </div>
        )}

        {/* Options */}
        {file && totalPages && (
          <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
            <p className="font-semibold text-gray-700 mb-4">분할 방식 선택</p>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => setMode("count")}
                className={`py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                  mode === "count"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-500 hover:border-indigo-300"
                }`}
              >
                분할 개수
              </button>
              <button
                onClick={() => setMode("size")}
                className={`py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                  mode === "size"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-500 hover:border-indigo-300"
                }`}
              >
                최대 파일 크기
              </button>
              <button
                onClick={() => setMode("range")}
                className={`py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                  mode === "range"
                    ? "border-violet-500 bg-violet-50 text-violet-700"
                    : "border-gray-200 text-gray-500 hover:border-violet-300"
                }`}
              >
                페이지 범위 직접 지정
              </button>
              <button
                onClick={() => setMode("chapter")}
                disabled={chapters.length === 0}
                className={`py-2 rounded-xl border-2 font-medium text-sm transition-colors ${
                  mode === "chapter"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : chapters.length > 0
                    ? "border-gray-200 text-gray-500 hover:border-emerald-300"
                    : "border-gray-100 text-gray-300 cursor-not-allowed"
                }`}
              >
                챕터별
                {chapters.length > 0 && (
                  <span className="ml-1 text-xs opacity-70">({chapters.length})</span>
                )}
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

            {mode === "chapter" && chapters.length > 0 && (
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  감지된 챕터 — 각 챕터가 별도 파일로 분할됩니다
                </p>
                <ul className="max-h-52 overflow-y-auto space-y-1 border border-gray-100 rounded-xl p-3 bg-gray-50">
                  {chapters.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-emerald-500 font-semibold w-6 shrink-0 text-right">
                        {i + 1}.
                      </span>
                      <span className="text-gray-700 flex-1 truncate" title={c.title}>
                        {c.title}
                      </span>
                      <span className="text-gray-400 text-xs shrink-0">p.{c.startPage + 1}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-400 mt-2">
                  {textScanDone
                    ? "페이지 텍스트 스캔으로 감지된 챕터 기준으로 분할합니다."
                    : "PDF 내장 북마크 기준으로 분할합니다."}
                </p>
              </div>
            )}

            <button
              onClick={split}
              disabled={loading}
              className={`mt-5 w-full disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors ${
                mode === "chapter"
                  ? "bg-emerald-600 hover:bg-emerald-700"
                  : mode === "range"
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

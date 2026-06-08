"use client";
// 블록체인 강의 실습 — 공통 UI 조각

import { ReactNode } from "react";

export function SectionCard({
  id,
  step,
  title,
  subtitle,
  children,
}: {
  id: string;
  step: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 py-10 border-t border-slate-200 first:border-t-0">
      <div className="flex items-start gap-3 mb-1">
        <span className="shrink-0 mt-1 inline-flex items-center justify-center w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold">
          {step}
        </span>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="text-slate-500 mt-1">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-5 sm:pl-11">{children}</div>
    </section>
  );
}

// 개념 설명 박스
export function Explain({ children }: { children: ReactNode }) {
  return (
    <div className="prose-tight text-slate-700 leading-relaxed space-y-3 mb-5">{children}</div>
  );
}

// 실습 카드(직접 조작하는 영역)
export function Lab({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
      {title && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold tracking-wide text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
            실습
          </span>
          <span className="font-semibold text-slate-800">{title}</span>
        </div>
      )}
      {children}
    </div>
  );
}

// 핵심 메모(노란 강조)
export function KeyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm">
      <span className="text-lg leading-none">💡</span>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function Hash({ value, className = "" }: { value: string; className?: string }) {
  return (
    <code className={`font-mono text-[12px] break-all ${className}`}>{value || "—"}</code>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger" | "amber";
  className?: string;
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300",
    ghost: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300",
    amber: "bg-amber-500 text-white hover:bg-amber-600 disabled:bg-slate-300",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";

// 상태 배지
export function Badge({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
        ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      {ok ? "✓" : "✕"} {ok ? okText : badText}
    </span>
  );
}

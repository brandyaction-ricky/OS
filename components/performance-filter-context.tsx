"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type PerformanceBrand = "all" | "myin" | "brandyedu";

const STORAGE_KEY = "brandy-performance-filters";

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

interface PerformanceFilterContextValue {
  brand: PerformanceBrand;
  month: string;
  setBrand: (brand: PerformanceBrand) => void;
  setMonth: (month: string) => void;
}

const PerformanceFilterContext = createContext<PerformanceFilterContextValue | null>(null);

export function PerformanceFilterProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<PerformanceBrand>("all");
  const [month, setMonth] = useState(currentMonth);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { brand?: PerformanceBrand; month?: string };
      if (["all", "myin", "brandyedu"].includes(saved.brand ?? "")) setBrand(saved.brand as PerformanceBrand);
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(saved.month ?? "")) setMonth(saved.month as string);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ brand, month }));
  }, [brand, month]);

  const value = useMemo(() => ({ brand, month, setBrand, setMonth }), [brand, month]);
  return <PerformanceFilterContext.Provider value={value}>{children}</PerformanceFilterContext.Provider>;
}

export function usePerformanceFilters() {
  const context = useContext(PerformanceFilterContext);
  if (!context) throw new Error("PerformanceFilterProvider가 필요합니다.");
  return context;
}

export function performanceBrandLabel(brand: PerformanceBrand) {
  if (brand === "myin") return "마이인";
  if (brand === "brandyedu") return "브랜디액션 에듀";
  return "통합";
}

export function matchesPerformanceBrand(recordBrand: string, selected: PerformanceBrand) {
  return selected === "all" || recordBrand === performanceBrandLabel(selected);
}

export function PerformanceFilterBar() {
  const { brand, month, setBrand, setMonth } = usePerformanceFilters();
  return (
    <section className="performance-filter-bar" aria-label="성과관리 공통 조건">
      <div>
        <strong>공통 조회 조건</strong>
        <span>한 번 고르면 성과관리 전체 페이지에 유지됩니다.</span>
      </div>
      <div className="brand-switch" role="group" aria-label="브랜드">
        {(["all", "myin", "brandyedu"] as const).map((item) => (
          <button type="button" className={brand === item ? "active" : ""} onClick={() => setBrand(item)} key={item}>
            {performanceBrandLabel(item)}
          </button>
        ))}
      </div>
      <label className="month-control">
        <span>기준월</span>
        <input aria-label="성과관리 기준월" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
      </label>
    </section>
  );
}

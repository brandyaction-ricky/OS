import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PerformanceFilterProvider } from "@/components/performance-filter-context";
import { SessionProvider } from "@/components/session-provider";

export default function OsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PerformanceFilterProvider>
        <Suspense fallback={<div className="boot-screen">화면을 여는 중입니다…</div>}><AppShell>{children}</AppShell></Suspense>
      </PerformanceFilterProvider>
    </SessionProvider>
  );
}

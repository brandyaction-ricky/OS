import { HrFeatureProvider } from "@/components/hr/feature-context";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { PerformanceFilterProvider } from "@/components/performance-filter-context";
import { SessionProvider } from "@/components/session-provider";

export default function OsLayout({ children }: { children: React.ReactNode }) {
  const hrEnabled = hrWorkspaceEnabled();
  return (
    <SessionProvider>
      <PerformanceFilterProvider>
        <HrFeatureProvider enabled={hrEnabled}><Suspense fallback={<div className="boot-screen">화면을 여는 중입니다…</div>}><AppShell hrEnabled={hrEnabled}>{children}</AppShell></Suspense></HrFeatureProvider>
      </PerformanceFilterProvider>
    </SessionProvider>
  );
}

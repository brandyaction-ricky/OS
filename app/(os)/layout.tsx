import { AppShell } from "@/components/app-shell";
import { PerformanceFilterProvider } from "@/components/performance-filter-context";
import { SessionProvider } from "@/components/session-provider";

export default function OsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PerformanceFilterProvider>
        <AppShell>{children}</AppShell>
      </PerformanceFilterProvider>
    </SessionProvider>
  );
}

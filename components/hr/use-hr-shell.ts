"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useSession } from "../session-provider";
export function useHrShell(enabled: boolean) {
  const { accessToken, profile, demo, loading } = useSession();
  const [blocked, setBlocked] = useState(false),
    [badges, setBadges] = useState<Record<string, number>>({});
  const operator = profile?.role === "admin" || profile?.financeAccess;
  useEffect(() => {
    if (!enabled || !demo) return;
    const listener = (event: Event) =>
      setBadges((event as CustomEvent<Record<string, number>>).detail);
    window.addEventListener("hr-demo-badges", listener);
    return () => window.removeEventListener("hr-demo-badges", listener);
  }, [enabled, demo]);
  useEffect(() => {
    if (
      !enabled ||
      demo ||
      loading ||
      !accessToken ||
      profile?.mustChangePassword
    )
      return;
    let active = true,
      running = false;
    async function check() {
      if (running) return;
      running = true;
      try {
        const response = await fetch("/api/v1/hr/session", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const body = await response.json();
        if (!active) return;
        setBlocked(
          response.status === 403 && body.error?.code === "ACCOUNT_DISABLED",
        );
        if (response.ok && operator) {
          const result = await apiRequest<{ badges: Record<string, number> }>(
            "/api/v1/hr/badges",
            { token: accessToken },
          );
          if (active) setBadges(result.badges);
        }
      } catch {
        /* Do not block unrelated navigation on a transient status-check failure. */
      } finally {
        running = false;
      }
    }
    void check();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, 60000);
    const listener = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("hr-data-changed", listener);
    document.addEventListener("visibilitychange", listener);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("hr-data-changed", listener);
      document.removeEventListener("visibilitychange", listener);
    };
  }, [
    enabled,
    demo,
    loading,
    accessToken,
    operator,
    profile?.mustChangePassword,
  ]);
  return {
    blocked: enabled && !demo && blocked,
    badges: enabled ? badges : {},
  };
}

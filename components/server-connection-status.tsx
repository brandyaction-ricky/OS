"use client";
import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api-client";
export function ServerConnectionStatus({ demo }: { demo: boolean }) {
  const [state, setState] = useState<{ ok: boolean; at: string } | null>(null);
  useEffect(() => {
    if (demo) return;
    let active = true;
    const check = async () => {
      try { const result = await getHealth(); if (active) setState({ ok: result.checks?.some(check => check.id === "database" && check.status === "verified") ?? false, at: result.checkedAt }); }
      catch { if (active) setState({ ok: false, at: new Date().toISOString() }); }
    };
    void check(); const timer = window.setInterval(check, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [demo]);
  return <div className="system-state" title={state ? `API·DB 조회 확인: ${new Date(state.at).toLocaleString("ko-KR")}` : undefined} role="status">
    <span className={`state-dot ${demo ? "demo" : state?.ok ? "ready" : "waiting"}`} />
    <span>{demo ? "데모 데이터" : !state ? "서버 확인 중" : state.ok ? "API·DB 응답 확인" : "서버 확인 실패"}</span>
  </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./session-provider";

const messages: Record<string, string> = {
  setup_required: "DEV 기준 문서 연결 설정이 필요합니다. 아직 확인하지 않았습니다.",
  unsupported_context: "현재는 브랜디액션 기획 자료만 확인할 수 있습니다.",
  authentication_failed: "로그인을 다시 확인해 주세요.",
  unavailable: "자료나 기준 문서를 읽을 수 없습니다. 본인 자료와 문서 접근 권한을 확인해 주세요.",
  stale: "자료 또는 기준이 바뀌었습니다. 최신 자료를 불러온 뒤 다시 확인해 주세요.",
  approval_required: "승인 상태를 확인해야 하는 기준 문서가 있습니다. 자동으로 적용하지 않습니다.",
};

export function SystemOnePlanningCheck({ id, version }: { id: string; version: number }) {
  const { accessToken, demo } = useSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setMessage(""); setBusy(false);
    return () => { active.current?.abort(); active.current = null; };
  }, [id, version, accessToken]);
  async function check() {
    if (busy || demo || !accessToken) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 55_000);
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/system-one/planning?${new URLSearchParams({ id, version: String(version) })}`, {
        cache: "no-store", signal: controller.signal, headers: { authorization: `Bearer ${accessToken}` },
      });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok && body.status === "ready" && body.policyStatus === "unverified" && body.executionAllowed === false &&
        body.judgment === null && body.source?.id === id && body.source?.version === version &&
        Number.isSafeInteger(body.referenceCount) && body.referenceCount > 0 && body.referenceCount <= 10) {
        setMessage(`기획 진입 참조 ${body.referenceCount}개의 연결·버전을 확인했습니다. 조건부 적용 범위와 내용 판단은 아직 확인하지 않았습니다.`);
      } else setMessage(!response.ok && body?.status === "stopped" && Object.hasOwn(messages, body.code) ? messages[body.code] : "기준 연결을 확인하지 못했습니다. 완료로 처리하지 않습니다.");
    } catch {
      if (active.current === controller) setMessage("연결 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { setBusy(false); active.current = null; }
    }
  }
  return <section className="panel" aria-label="기획 기준 연결 확인">
    <div className="panel-header"><div><h3>기획 기준 연결 확인</h3><p>DEV 검수용 · 자료와 참조 문서만 읽습니다. 기획 채택·내용 판단·저장은 하지 않습니다.</p></div>
      <button className="secondary-button" disabled={busy || demo || !accessToken} onClick={() => void check()}>{busy ? "확인 중…" : "기준 연결 확인"}</button></div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

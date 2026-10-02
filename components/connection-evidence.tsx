"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONNECTIONS, CONNECTION_STATE_LABELS, type ConnectionCheck } from "@/lib/connection-status";
import { getConnectionChecks, listMembers, saveConnectionOwners, testConnection, type OsMember } from "@/lib/api-client";
import { useSession } from "./session-provider";
import { WorkspaceLoadState } from "./workspace-load-state";

function time(value: string | null) { return value ? new Date(value).toLocaleString("ko-KR") : "확인 기록 없음"; }
function ConnectionCard({ check, members, disabled, onTest, onSave }: { check: ConnectionCheck; members: OsMember[]; disabled: boolean; onTest: () => void; onSave: (primaryOwner: string | null, backupOwner: string | null) => void }) {
  const definition = CONNECTIONS.find(item => item.id === check.id)!;
  const [primary, setPrimary] = useState(check.primaryOwner ?? "");
  const [backup, setBackup] = useState(check.backupOwner ?? "");
  return <article className="panel connection-evidence">
    <header><h2>{definition.label}</h2><span className={`status-pill status-${check.status === "error" ? "blocked" : check.status === "verified" ? "ready" : "waiting"}`}>{CONNECTION_STATE_LABELS[check.status]}</span></header>
    <p>{definition.scope}</p>
    <dl><div><dt>마지막 성공 호출</dt><dd>{time(check.lastOkAt)}</dd></div><div><dt>최근 24시간 실패</dt><dd>{check.failures24h === null ? "— 이력 확인 불가" : `${check.failures24h}건`}</dd></div><div><dt>막힌 작업</dt><dd>{check.blockedJobs === null ? "— 집계 미확인" : `${check.blockedJobs}건`}</dd></div></dl>
    {!check.historyAvailable ? <p className="field-hint">확인 이력을 불러오지 못했습니다. 저장소 적용·접근 상태를 확인해 주세요.</p> : null}
    {check.status === "error" ? <p className="field-hint">오류 이력이 있습니다. 재테스트 성공 후에도 최근 24시간 실패와 막힌 작업은 유지됩니다.</p> : null}
    <form onSubmit={event => { event.preventDefault(); onSave(primary || null, backup || null); }}>
      <div className="connection-owners">{(["정", "부"] as const).map((label, index) => <label key={label}>{label} 담당<select aria-label={`${definition.label} ${label} 담당`} disabled={disabled} value={index ? backup : primary} onChange={event => index ? setBackup(event.target.value) : setPrimary(event.target.value)}><option value="">미지정</option>{members.filter(member => member.is_active || member.id === (index ? backup : primary)).map(member => <option key={member.id} value={member.id} disabled={!member.is_active}>{member.display_name || "구성원"}{!member.is_active ? " (비활성)" : ""}</option>)}</select></label>)}</div>
      <div className="connection-evidence-actions"><button className="secondary-button" disabled={disabled || (primary === (check.primaryOwner ?? "") && backup === (check.backupOwner ?? ""))}>담당 저장</button><button type="button" className="secondary-button" disabled={disabled || !check.configured || !check.historyAvailable} onClick={onTest}>{check.status === "error" ? "연결 테스트 재시도" : "연결 테스트"}</button><Link className="ghost-button" href={definition.href}>{check.id === "embeddings" && (check.blockedJobs ?? 0) > 0 ? "막힌 작업 재시도" : "관련 화면"}</Link></div>
    </form>
  </article>;
}
export function ConnectionEvidence() {
  const { accessToken, demo, profile } = useSession();
  const [checks, setChecks] = useState<ConnectionCheck[]>([]);
  const [members, setMembers] = useState<OsMember[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (demo || profile?.role !== "admin") { setLoading(false); return; }
    const request = ++generation.current; setLoading(true); setError("");
    try {
      const [result, people] = await Promise.all([getConnectionChecks(accessToken), listMembers(accessToken)]);
      if (request !== generation.current) return;
      setChecks(result.checks); setMembers(people.members);
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : "작동 상태를 불러오지 못했습니다."); }
    finally { if (request === generation.current) setLoading(false); }
  }, [accessToken, demo, profile?.role]);
  useEffect(() => { const requests = generation; void load(); return () => { requests.current++; }; }, [load]);
  const perform = async (work: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : "요청을 완료하지 못했습니다."); }
    finally { setBusy(false); }
  };
  if (!demo && profile?.role !== "admin") return <p className="panel load-error">작동 상태 상세·연결 테스트·담당 지정은 관리자에게 요청해 주세요.</p>;
  const displayed = demo ? CONNECTIONS.map(({ id }): ConnectionCheck => ({ id, configured: false, lastOkAt: null, lastCheckedAt: null, failures24h: null, blockedJobs: null, latestFailed: false, historyAvailable: false, status: "missing", primaryOwner: null, backupOwner: null, ownerVersion: 0 })) : checks;
  return <>
    <div className="p2-toolbar"><p>API 응답 확인 범위만 표시합니다. 최근 24시간 실패 = 연결 테스트 + 기록 시작 이후 색인 시도·광고 수집 실패.</p><button className="secondary-button" disabled={loading || busy || demo} onClick={load}>상태 새로고침</button></div>
    {demo ? <p className="field-hint">데모 모드 · 실제 연결·이력·담당자는 확인하지 않습니다.</p> : null}
    {error && checks.length ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    {notice ? <p role="status" className="inline-alert">{notice}</p> : null}
    <WorkspaceLoadState loading={loading} error={!checks.length && !demo ? error : undefined} retry={load}>
      <section className="connection-evidence-grid">{displayed.map(check => <ConnectionCard key={`${check.id}-${check.ownerVersion}`} check={check} members={members} disabled={busy || demo} onTest={() => void perform(async () => { const result = await testConnection(accessToken, check.id); setChecks(result.checks); setNotice(result.ok ? "호출을 확인했습니다. 확인 범위와 남아 있는 실패 이력을 함께 확인하세요." : "호출에 실패했습니다. 관련 화면에서 설정과 작업을 확인해 주세요."); })} onSave={(primaryOwner, backupOwner) => void perform(async () => { await saveConnectionOwners(accessToken, { service: check.id, primaryOwner, backupOwner, expectedVersion: check.ownerVersion }); await load(); setNotice("담당자를 저장했습니다."); })} />)}</section>
    </WorkspaceLoadState>
  </>;
}

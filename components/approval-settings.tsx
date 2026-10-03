"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, type OsMember } from "@/lib/api-client";

interface Assignment {
  id: string;
  user_id: string;
  kind: "approver" | "delegate";
  delegated_by: string | null;
  starts_on: string | null;
  ends_on: string | null;
  revoked_at: string | null;
}

export function ApprovalSettings({ token, members, actorId, isAdmin, demo }: {
  token: string | null;
  members: OsMember[];
  actorId?: string;
  isAdmin: boolean;
  demo: boolean;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [target, setTarget] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const active = useMemo(() => members.filter((member) => member.is_active && !member.id.startsWith("directory:")), [members]);
  const nameFor = (id: string | null) => active.find((member) => member.id === id)?.display_name || "구성원";
  const approvers = assignments.filter((item) => item.kind === "approver");
  const today = new Date().toISOString().slice(0, 10);
  const currentApprovers = approvers.filter((item) => active.some((member) => member.id === item.user_id)
    && (!item.starts_on || item.starts_on <= today) && (!item.ends_on || item.ends_on >= today));
  const canDelegate = currentApprovers.some((item) => item.user_id === actorId) || (currentApprovers.length === 0 && isAdmin);

  const load = useCallback(async () => {
    if (demo) return;
    setReady(false);
    try {
      const result = await apiRequest<{ assignments: Assignment[] }>("/api/v1/approvals", { token });
      setAssignments(result.assignments);
      setError("");
      setReady(true);
    } catch { setReady(false); setError("승인 설정을 확인할 수 없습니다. 개발 DB의 승인 규칙 적용 여부를 확인해 주세요."); }
  }, [demo, token]);
  useEffect(() => { void load(); }, [load]);

  const submit = async (action: "add_approver" | "delegate" | "revoke", assignmentId?: string) => {
    if (!assignmentId && !target) { setError("구성원을 선택해 주세요."); return; }
    if (action === "delegate" && (!startsOn || !endsOn)) { setError("위임 시작일과 종료일을 선택해 주세요."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await apiRequest("/api/v1/approvals", { method: "POST", token,
        body: JSON.stringify(action === "revoke" ? { action, assignmentId } : action === "delegate"
          ? { action, userId: target, startsOn, endsOn } : { action, userId: target }) });
      await load();
      setMessage(action === "revoke" ? "설정을 해제했습니다." : action === "delegate" ? "기간 위임을 저장했습니다." : "승인자를 지정했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "승인자 설정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <section className="panel company-block" aria-label="승인자 설정">
    <div className="panel-header"><div><h2>승인자</h2><p>문서 작성자는 자신의 문서를 승인할 수 없습니다. 승인자 부재 기간에는 유효한 위임자가 검토합니다.</p></div></div>
    {demo ? <p>실제 승인자 지정은 연결된 개발 환경에서 확인합니다.</p> : null}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    {message ? <p className="inline-alert" role="status">{message}</p> : null}
    {ready && !currentApprovers.length ? <p>지정 승인자가 없으면 활성 관리자에게 승인 권한이 있습니다.</p> : null}
    {assignments.map((item) => <div className="company-list-row" key={item.id}>
      <span><strong>{nameFor(item.user_id)}</strong><small>{item.kind === "approver" ? "승인자" : `${nameFor(item.delegated_by)}의 위임 · ${item.starts_on} ~ ${item.ends_on}`}</small></span>
      {(isAdmin || (item.kind === "delegate" && item.delegated_by === actorId))
        ? <button type="button" className="secondary-button" disabled={busy || demo} onClick={() => void submit("revoke", item.id)} aria-label={`${nameFor(item.user_id)} ${item.kind === "delegate" ? "위임" : "승인자"} 해제`}>해제</button> : null}
    </div>)}
    {ready && (isAdmin || canDelegate) && !demo ? <div className="company-list-row">
      <label>지정할 구성원 <select value={target} onChange={(event) => setTarget(event.target.value)}><option value="">선택</option>{active.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}</select></label>
      {isAdmin ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void submit("add_approver")}>승인자 지정</button> : null}
      {canDelegate ? <><label>시작일 <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label>
        <label>종료일 <input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void submit("delegate")}>기간 위임</button></> : null}
    </div> : null}
  </section>;
}

"use client";

import { useState } from "react";
import { decideTelegramUser, type OsMember, type TelegramConnectionStatus } from "@/lib/api-client";

const timestamp = (value?: string | number | null) => value ? new Date(typeof value === "number" ? value * 1000 : value).toLocaleString("ko-KR") : "확인된 이력 없음";

export function TelegramAccessPanel({ status, token, admin, members, onRefresh }: { status: TelegramConnectionStatus | null; token: string | null; admin: boolean; members: OsMember[]; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const decide = async (id: string, name: string, action: "approve" | "reject") => {
    if (!window.confirm(`${name} 사용자를 ${action === "approve" ? "승인" : "거절"}할까요? OS 계정의 관리자 권한을 부여하는 작업은 아닙니다.`)) return;
    setBusy(true); setError("");
    try { await decideTelegramUser(token, id, action, action === "approve" ? links[id] || null : null); await onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "승인 상태를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const link = async (id: string, profileId: string) => {
    setLinks((current) => ({ ...current, [id]: profileId })); setBusy(true); setError("");
    try { await decideTelegramUser(token, id, "link", profileId || null); await onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "OS 구성원 연결을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const memberOptions = members.filter((member) => member.is_active);
  if (!admin) return <section className="panel company-block"><h2>접근 승인</h2><p>사용자 승인과 연결 진단은 관리자가 확인할 수 있습니다.</p></section>;
  return <section className="panel company-block">
    <div className="panel-header"><div><h2>접근 승인·수신 상태</h2><p>Telegram 승인과 OS 계정 권한은 별도로 관리합니다.</p></div><button className="secondary-button" disabled={busy} onClick={() => void onRefresh()}>다시 확인</button></div>
    {!status ? <p role="alert">연결 상태를 읽지 못했습니다. 다시 확인해 주세요.</p> : <>
      <p>승인 대기 {status.pendingCount ?? status.pendingUsers?.length ?? 0}명 · 승인 {status.approvedCount ?? status.approvedUsers?.length ?? 0}명</p>
      <p>마지막 수신: {timestamp(status.lastReceivedAt)}</p>
      <p>웹훅: {status.webhook?.url ? "등록됨" : status.configured ? "상태 확인 필요" : "연결 대기"} · 전송 대기: {status.webhook?.pendingUpdates ?? "미확인"}</p>
      {status.lastProcessingError ? <p className="inline-alert warning">마지막 처리 오류 ({timestamp(status.lastProcessingError.at)}): {status.lastProcessingError.message}</p> : null}
      {status.diagnosticError ? <p role="alert">{status.diagnosticError}</p> : null}
      {status.webhook?.lastError ? <p className="inline-alert warning">마지막 오류 ({timestamp(status.webhook.lastErrorAt)}): {status.webhook.lastError}</p> : null}
      {status.webhook?.lastSynchronizationErrorAt ? <p>마지막 동기화 오류: {timestamp(status.webhook.lastSynchronizationErrorAt)}</p> : null}
      <h3>승인 대기</h3>
      {(status.pendingUsers ?? []).map((user) => <div className="company-list-row" key={user.external_user_id}><span><strong>{user.display_name || user.username || "이름 미입력"}</strong><small>접수 {timestamp(user.requested_at)}</small></span><select aria-label={`${user.display_name} OS 구성원 연결`} value={links[user.external_user_id] ?? ""} onChange={(event) => setLinks((current) => ({ ...current, [user.external_user_id]: event.target.value }))}><option value="">조회만 승인</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}</select><button className="secondary-button" disabled={busy} onClick={() => void decide(user.external_user_id, user.display_name, "approve")}>승인</button><button className="ghost-button" disabled={busy} onClick={() => void decide(user.external_user_id, user.display_name, "reject")}>거절</button></div>)}
      {!status.pendingUsers?.length ? <p>승인 대기 사용자가 없습니다. 봇에 첫 메시지를 보내면 여기에 접수됩니다.</p> : null}
      <h3>승인된 사용자</h3>
      {(status.approvedUsers ?? []).map((user) => <div className="company-list-row" key={user.external_user_id}><span><strong>{user.display_name || user.username || "이름 미입력"}</strong><small>최근 수신: {timestamp(user.last_received_at)}</small></span><select aria-label={`${user.display_name} OS 구성원 연결`} disabled={busy} value={user.profile_id ?? ""} onChange={(event) => void link(user.external_user_id, event.target.value)}><option value="">OS 계정 미연결</option>{memberOptions.map((member) => <option key={member.id} value={member.id}>{member.display_name || member.email}</option>)}</select></div>)}
      <p className="field-hint">각 목록은 최근 100명까지, 사용자별 수신은 최근 1,000건 이력 기준입니다. 수신 이력이 없다고 연결 실패로 단정하지 않습니다.</p>
    </>}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </section>;
}

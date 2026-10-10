"use client";

import { useState } from "react";
import { useKnowledge } from "./provider";
import { Modal } from "./ui";

type Key = { id: string; name: string; ownerUserId: string };
type Grant = { agent_key_id: string; expires_at: string | null; created_at: string };

export function AgentDocumentReadAccess({ documentId }: { documentId: string }) {
  const { token, demo, state } = useKnowledge();
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<Key[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [keyId, setKeyId] = useState("");
  const [duration, setDuration] = useState<"24h" | "7d" | "ongoing">("24h");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (demo) { setError("데모에서는 실제 문서 접근 권한을 변경하지 않습니다."); return; }
    const response = await fetch(`/api/v1/agent-document-read-grants?documentId=${encodeURIComponent(documentId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error?.message ?? "AI 연결 목록을 불러오지 못했습니다.");
    setKeys(result.keys ?? []);
    setGrants(result.grants ?? []);
  }

  async function openDialog() {
    setOpen(true); setError("");
    try { await load(); } catch (cause) { setError((cause as Error).message); }
  }

  async function change(method: "POST" | "DELETE", agentKeyId: string) {
    setBusy(true); setError("");
    try {
      if (demo) throw Error("데모에서는 실제 문서 접근 권한을 변경하지 않습니다.");
      const response = await fetch("/api/v1/agent-document-read-grants", {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ documentId, agentKeyId, ...(method === "POST" ? { duration, reason } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error?.message ?? "AI 연결 권한을 저장하지 못했습니다.");
      await load();
      if (method === "POST") { setKeyId(""); setReason(""); }
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const active = new Set(grants.map(grant => grant.agent_key_id));
  return <>
    <button type="button" onClick={() => void openDialog()}>AI 연결 읽기 권한</button>
    {open && <Modal title="개인 문서 AI 읽기 권한" busy={busy} onClose={() => setOpen(false)}>
      <div className="kw-modal-body">
        <p>선택한 AI 연결 하나만 이 문서의 주소로 원문을 읽을 수 있습니다. 검색·첨부·쓰기 권한과 팀 공유 상태는 바뀌지 않습니다.</p>
        <label>AI 연결
          <select value={keyId} onChange={event => setKeyId(event.target.value)}>
            <option value="">연결 선택</option>
            {keys.filter(key => !active.has(key.id)).map(key => <option key={key.id} value={key.id}>
              {key.name} · {state.people.find(person => person.id === key.ownerUserId)?.display_name ?? "사용자"}
            </option>)}
          </select>
        </label>
        <label>허용 기간
          <select value={duration} onChange={event => setDuration(event.target.value as typeof duration)}>
            <option value="24h">24시간</option><option value="7d">7일</option><option value="ongoing">취소할 때까지</option>
          </select>
        </label>
        <label>허용 사유<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        <button type="button" className="kw-primary" disabled={busy || !keyId || !reason.trim()} onClick={() => void change("POST", keyId)}>이 연결에만 읽기 허용</button>
        {grants.length > 0 && <section><h3>현재 허용된 연결</h3>{grants.map(grant => <div className="kw-actions" key={`${grant.agent_key_id}:${grant.created_at}`}>
          <span>{keys.find(key => key.id === grant.agent_key_id)?.name ?? "현재 목록에 없는 연결"} · {grant.expires_at ? new Date(grant.expires_at).toLocaleString("ko-KR") + "까지" : "취소할 때까지"}</span>
          <button type="button" disabled={busy} onClick={() => void change("DELETE", grant.agent_key_id)}>읽기 취소</button>
        </div>)}</section>}
        {error && <p role="alert" className="kw-error">{error}</p>}
        <footer><button type="button" onClick={() => setOpen(false)}>닫기</button></footer>
      </div>
    </Modal>}
  </>;
}

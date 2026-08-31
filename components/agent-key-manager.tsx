"use client";

import { Bot, Check, Copy, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  type AgentAccessKey,
  type AgentAccessResponse,
  type OsMember,
} from "@/lib/api-client";

interface Props {
  accessToken: string | null;
  demo: boolean;
  isAdmin: boolean;
  members: OsMember[];
  defaultOwnerId?: string;
}

function dateLabel(value: string | null) {
  if (!value) return "사용 기록 없음";
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function AgentKeyManager({ accessToken, demo, isAdmin, members, defaultOwnerId }: Props) {
  const [result, setResult] = useState<AgentAccessResponse | null>(null);
  const [loading, setLoading] = useState(isAdmin && !demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const [issued, setIssued] = useState<{ token: string; organizationId: string } | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"organization" | "token" | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin || demo) { setLoading(false); return; }
    setLoading(true);
    try { setResult(await listAgentKeys(accessToken)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "AI 접근 키를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [accessToken, demo, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const copy = async (kind: "organization" | "token", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await createAgentKey(accessToken, {
        name: String(form.get("name") || ""),
        ownerUserId: String(form.get("ownerUserId") || ""),
        access: String(form.get("access")) === "write" ? "write" : "read",
        team: String(form.get("team") || ""),
      });
      setIssued({ token: response.token, organizationId: response.organization.id });
      setCreateOpen(false);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI 접근 키를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  const revoke = async (key: AgentAccessKey) => {
    setBusy(true); setError("");
    try { await revokeAgentKey(accessToken, key.id); setRevokeId(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "AI 접근 키를 폐기하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const testConnection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const pat = String(form.get("pat") || "");
    const organizationId = result?.organization.id;
    setBusy(true); setError(""); setTestStatus("");
    try {
      if (!organizationId) throw new Error("조직 UUID를 불러온 뒤 다시 시도해 주세요.");
      if (!/^bos_pat_[A-Za-z0-9_-]{20,}$/.test(pat)) throw new Error("복사한 AI 접근 키를 확인해 주세요.");
      const endpoint = `/api/mcp?organizationId=${encodeURIComponent(organizationId)}`;
      const call = async (id: number, name: string, args: Record<string, unknown>) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${pat}` },
          body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
        });
        const payload = await response.json();
        if (!response.ok || payload.error || payload.result?.isError) {
          throw new Error(payload.error?.message || payload.result?.content?.[0]?.text || "MCP 연결 검증에 실패했습니다.");
        }
        return JSON.parse(payload.result.content[0].text);
      };
      const stamp = new Date().toISOString();
      const created = await call(1, "create_document", {
        title: "[E2E] AI 접근 키 연결 검증",
        content_md: `# MCP 연결 검증\n\n생성 단계 ${stamp}`,
        folder: "AI 저장/연결 검증",
        tags: ["mcp-e2e"],
        reason: "설정 화면 MCP 생성 검증",
      });
      const documentId = String(created.documentId);
      const version = Number(created.document?.current_version || 1);
      await call(2, "edit_document", {
        document_id: documentId,
        expected_version: version,
        content_md: `# MCP 연결 검증\n\n생성·수정 단계 ${stamp}`,
        reason: "설정 화면 MCP 수정 검증",
      });
      const readBack = await call(3, "get_document", { document_id: documentId });
      const archived = await call(4, "delete_document", {
        document_id: documentId,
        confirm: true,
        reason: "설정 화면 MCP 휴지통 이동 검증",
      });
      if (!String(readBack.document?.content_md || "").includes("생성·수정 단계") || archived.document?.status !== "archived" || archived.permanent !== false) {
        throw new Error("문서 버전 또는 휴지통 상태가 예상과 다릅니다.");
      }
      setTestStatus(`연결 정상 · 문서 ${documentId.slice(0, 8)}… · 버전 ${readBack.document.current_version} · 휴지통 이동 확인`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MCP 연결 검증에 실패했습니다.");
    } finally {
      formElement.reset();
      setBusy(false);
    }
  };

  if (!isAdmin) return (
    <section className="panel agent-key-manager">
      <div className="panel-header"><div><h2>AI 접근 키</h2><p>Claude Code·Codex용 MCP 연결</p></div><ShieldCheck size={18} /></div>
      <div className="quiet-state"><KeyRound /><strong>관리자만 발급할 수 있습니다.</strong><span>발급된 키의 원문은 관리자에게도 다시 표시되지 않습니다.</span></div>
    </section>
  );

  return (
    <section className="panel agent-key-manager">
      <div className="panel-header">
        <div><h2>AI 접근 키</h2><p>Claude Code·Codex가 OS 지식을 읽고 개인 초안을 관리하는 MCP 권한</p></div>
        <div className="header-actions"><button className="secondary-button" type="button" onClick={() => { setTestStatus(""); setTestOpen(true); }}><ShieldCheck size={14} />연결 검증</button><button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={14} />키 발급</button></div>
      </div>
      {error ? <div className="inline-alert danger">{error}</div> : null}
      {result ? (
        <div className="agent-organization-row">
          <span><strong>조직 UUID</strong><code>{result.organization.id}</code></span>
          <button className="icon-button" type="button" aria-label="조직 UUID 복사" onClick={() => copy("organization", result.organization.id)}>{copied === "organization" ? <Check size={14} /> : <Copy size={14} />}</button>
        </div>
      ) : null}
      {issued ? (
        <div className="agent-token-once" role="status">
          <div><KeyRound size={17} /><span><strong>한 번만 표시되는 PAT</strong><small>지금 복사해 AI 클라이언트의 비밀 환경변수에 저장하세요.</small></span></div>
          <code>{issued.token}</code>
          <div className="agent-token-actions">
            <button className="secondary-button" type="button" onClick={() => copy("token", issued.token)}>{copied === "token" ? <Check size={14} /> : <Copy size={14} />}{copied === "token" ? "복사됨" : "PAT 복사"}</button>
            <button className="icon-button" type="button" aria-label="PAT 표시 닫기" onClick={() => setIssued(null)}><X size={14} /></button>
          </div>
        </div>
      ) : null}
      {loading ? <div className="settings-loading-state"><LoaderCircle className="spin" /><strong>AI 접근 키 확인 중</strong></div> : (
        <div className="agent-key-list">
          {(result?.keys ?? []).map((key) => (
            <div key={key.id}>
              <span className="document-symbol"><Bot size={15} /></span>
              <span className="agent-key-main"><strong>{key.name}</strong><small>{key.owner?.display_name || key.owner?.email || "소유자 미확인"} · {key.key_prefix}… · 최근 사용 {dateLabel(key.last_used_at)}</small></span>
              <em className={`status-pill status-${key.active ? "ready" : "waiting"}`}>{key.active ? (key.scopes.includes("knowledge.write") ? "읽기·쓰기" : "읽기 전용") : "폐기됨"}</em>
              {key.active ? (revokeId === key.id ? (
                <span className="agent-revoke-actions"><button type="button" onClick={() => revoke(key)} disabled={busy}>폐기 확정</button><button type="button" onClick={() => setRevokeId(null)}>취소</button></span>
              ) : <button className="icon-button" type="button" aria-label={`${key.name} 키 폐기`} onClick={() => setRevokeId(key.id)}><Trash2 size={14} /></button>) : null}
            </div>
          ))}
          {!result?.keys.length ? <div className="quiet-state"><Bot /><strong>발급된 AI 접근 키 없음</strong><span>Claude Code 또는 Codex별로 별도 키를 발급하세요.</span></div> : null}
        </div>
      )}
      {createOpen ? (
        <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
          <form className="side-drawer" onSubmit={submit}>
            <div className="drawer-header"><div><span className="eyebrow">MCP 권한</span><h2>AI 접근 키 발급</h2></div><button className="icon-button" type="button" aria-label="닫기" onClick={() => setCreateOpen(false)}><X /></button></div>
            <label>키 이름<input name="name" required maxLength={80} placeholder="예: 정호 Claude Code" /></label>
            <label>귀속 구성원<select name="ownerUserId" required defaultValue={members.find((member) => member.is_active && member.id === defaultOwnerId)?.id ?? members.find((member) => member.is_active)?.id}>{members.filter((member) => member.is_active).map((member) => <option value={member.id} key={member.id}>{member.display_name || member.email}</option>)}</select></label>
            <label>권한 범위<select name="access" defaultValue="write"><option value="write">읽기·쓰기</option><option value="read">읽기 전용</option></select></label>
            <label>팀 범위<input name="team" maxLength={120} placeholder="비워두면 귀속 계정 기준" /></label>
            <div className="inline-alert"><ShieldCheck size={15} />새 문서는 개인 초안으로만 생성되고, 삭제는 휴지통 이동이며, 모든 쓰기는 감사 로그와 버전으로 남습니다.</div>
            <div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>취소</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />}발급</button></div>
          </form>
        </div>
      ) : null}
      {testOpen ? (
        <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setTestOpen(false); }}>
          <form className="side-drawer" onSubmit={testConnection}>
            <div className="drawer-header"><div><span className="eyebrow">MCP 실제 검증</span><h2>AI 접근 키 연결 검증</h2></div><button className="icon-button" type="button" aria-label="닫기" disabled={busy} onClick={() => setTestOpen(false)}><X /></button></div>
            <label>AI 접근 키<input name="pat" type="password" autoComplete="off" required placeholder="복사한 bos_pat_… 키 붙여넣기" /></label>
            <div className="inline-alert"><ShieldCheck size={15} />키는 저장하지 않습니다. 개인 초안 생성 → 수정 → 읽기 → 휴지통 이동을 실행하고 버전·감사 기록을 확인합니다.</div>
            {testStatus ? <div className="inline-alert success"><Check size={15} />{testStatus}</div> : null}
            <div className="drawer-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setTestOpen(false)}>닫기</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}실제 연결 검증</button></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

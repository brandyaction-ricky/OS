"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { CATEGORY_COLORS } from "@/lib/knowledge/model";
import type { SessionProfile } from "@/lib/types";
import { KnowledgeModal } from "./knowledge-modal";

type Category = {
  id: string;
  space: "mine" | "team";
  owner_id: string | null;
  name: string;
  color: string;
  sort_order: number;
};

export function KnowledgeCategoryManager({ token, profile, onClose }: {
  token: string | null;
  profile: SessionProfile | null;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { name: string; color: string }>>({});
  const [space, setSpace] = useState<"mine" | "team">("mine");
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function refresh() {
    const result = await apiRequest<{ categories: Category[] }>("/api/v1/knowledge/categories", { token });
    setCategories(result.categories);
    setDrafts(Object.fromEntries(result.categories.map(item => [item.id, { name: item.name, color: item.color }])));
  }

  useEffect(() => {
    let active = true;
    apiRequest<{ categories: Category[] }>("/api/v1/knowledge/categories", { token })
      .then(result => { if (!active) return; setCategories(result.categories); setDrafts(Object.fromEntries(result.categories.map(item => [item.id, { name: item.name, color: item.color }]))); })
      .catch(cause => { if (active) setError((cause as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await action(); await refresh(); setConfirmDelete(null); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  const canManage = space === "mine" || profile?.role === "admin" || profile?.memberKind === "staff";
  const visible = categories.filter(item => item.space === space);
  return <KnowledgeModal title="문서 카테고리 관리" onClose={onClose} busy={busy} className="vault-category-modal">
    <div className="vault-category-manager">
      <header><h2>문서 카테고리 관리</h2><button type="button" onClick={onClose} disabled={busy} aria-label="닫기">닫기</button></header>
      <p>카테고리는 폴더와 별개의 문서 분류입니다. 이름과 색상을 바꿔도 문서와 폴더는 그대로 유지됩니다. 문서에 사용 중인 카테고리는 삭제할 수 없습니다.</p>
      <div className="vault-category-tabs" role="tablist" aria-label="카테고리 범위">
        <button role="tab" aria-selected={space === "mine"} onClick={() => { setSpace("mine"); setConfirmDelete(null); }}>내 카테고리</button>
        <button role="tab" aria-selected={space === "team"} onClick={() => { setSpace("team"); setConfirmDelete(null); }}>팀 카테고리</button>
      </div>
      {loading ? <p role="status">카테고리를 불러오는 중입니다…</p> : null}
      {!loading && visible.length === 0 ? <p>등록된 카테고리가 없습니다.</p> : null}
      {!loading && visible.length > 0 ? <ul className="vault-category-list">
        {visible.map(item => {
          const draft = drafts[item.id] ?? { name: item.name, color: item.color };
          const editable = space === "mine" ? item.owner_id === profile?.id : canManage;
          const deletable = editable && (space === "mine" || profile?.role === "admin");
          const changed = draft.name.trim() !== item.name || draft.color !== item.color;
          return <li key={item.id}>
            <label><span>이름</span><input aria-label={`${item.name} 이름`} value={draft.name} maxLength={20} disabled={!editable || busy} onChange={event => setDrafts(rows => ({ ...rows, [item.id]: { ...draft, name: event.target.value } }))} /></label>
            <label><span>색상</span><select aria-label={`${item.name} 색상`} value={draft.color} disabled={!editable || busy} onChange={event => setDrafts(rows => ({ ...rows, [item.id]: { ...draft, color: event.target.value } }))}>{CATEGORY_COLORS.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
            <div className="vault-category-row-actions">
              {editable ? <button disabled={!changed || !draft.name.trim() || busy} onClick={() => void run(() => apiRequest("/api/v1/knowledge/categories", { method: "PATCH", token, body: JSON.stringify({ id: item.id, ...draft }) }))}>수정 저장</button> : null}
              {deletable && confirmDelete !== item.id ? <button className="danger" disabled={busy} onClick={() => setConfirmDelete(item.id)}>삭제</button> : null}
              {deletable && confirmDelete === item.id ? <><span>빈 카테고리만 삭제됩니다.</span><button className="danger" disabled={busy} onClick={() => void run(() => apiRequest("/api/v1/knowledge/categories", { method: "DELETE", token, body: JSON.stringify({ id: item.id }) }))}>삭제 확인</button><button disabled={busy} onClick={() => setConfirmDelete(null)}>취소</button></> : null}
            </div>
          </li>;
        })}
      </ul> : null}
      {canManage ? <form className="vault-category-create" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; void run(async () => { await apiRequest("/api/v1/knowledge/categories", { method: "POST", token, body: JSON.stringify({ space, name: name.trim(), color }) }); setName(""); }); }}>
        <strong>{space === "mine" ? "내" : "팀"} 카테고리 추가</strong>
        <input aria-label="새 카테고리 이름" placeholder="이름 (최대 20자)" maxLength={20} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        <select aria-label="새 카테고리 색상" value={color} disabled={busy} onChange={event => setColor(event.target.value)}>{CATEGORY_COLORS.map(option => <option key={option} value={option}>{option}</option>)}</select>
        <button disabled={busy || !name.trim()}>추가</button>
      </form> : null}
      {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
    </div>
  </KnowledgeModal>;
}

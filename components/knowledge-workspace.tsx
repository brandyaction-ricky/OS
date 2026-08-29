"use client";

import {
  Archive,
  BookCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  Eye,
  File,
  FilePenLine,
  FilePlus2,
  Folder,
  FolderOpen,
  Hash,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Send,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { changeDocumentStatus, createDocument, listDocuments, updateDocument } from "@/lib/api-client";
import { DEMO_DOCUMENTS } from "@/lib/demo-data";
import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";
import { useSession } from "./session-provider";

const STATUS_FLOW: DocumentStatus[] = ["draft", "team", "review", "reviewed", "canonical"];

const OWNER_FILTERS = [
  { id: "all", label: "전체" },
  { id: "canonical", label: "브랜디액션 wiki" },
  { id: "mine", label: "내 문서" },
  { id: "review", label: "검토 중" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function nextStatus(status: DocumentStatus): DocumentStatus | null {
  const index = STATUS_FLOW.indexOf(status);
  return index >= 0 && index < STATUS_FLOW.length - 1 ? STATUS_FLOW[index + 1] : null;
}

function statusActionLabel(status: DocumentStatus) {
  return ({ draft: "팀에 공유", team: "검토 요청", review: "검토 완료", reviewed: "회사 정본으로", canonical: "", archived: "" })[status];
}

function MarkdownView({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="markdown-view">
      {blocks.map((block, index) => {
        const heading = block.match(/^(#{1,4})\s+(.+)/);
        if (heading) {
          const level = heading[1].length;
          const text = heading[2].split("\n")[0];
          const rest = block.split("\n").slice(1).join("\n");
          return (
            <div key={index}>
              {level === 1 ? <h1>{text}</h1> : level === 2 ? <h2>{text}</h2> : <h3>{text}</h3>}
              {rest ? <p>{rest}</p> : null}
            </div>
          );
        }
        if (block.split("\n").every((line) => /^[-*]\s+/.test(line))) {
          return <ul key={index}>{block.split("\n").map((line, itemIndex) => <li key={itemIndex}>{line.replace(/^[-*]\s+/, "")}</li>)}</ul>;
        }
        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}

interface DraftState {
  title: string;
  content: string;
  folder: string;
  brand: string;
  team: string;
  tags: string;
}

function toDraft(document: KnowledgeDocument): DraftState {
  return {
    title: document.title,
    content: document.content_md,
    folder: document.folder,
    brand: document.brand,
    team: document.team,
    tags: document.tags.join(", "),
  };
}

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const { demo, accessToken, profile } = useSession();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(demo ? DEMO_DOCUMENTS : []);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("document"));
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [folderFilter, setFolderFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"read" | "edit" | "info">("read");
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const reload = useCallback(async () => {
    if (demo) return;
    try {
      const result = await listDocuments(accessToken, "limit=100");
      setDocuments(result.documents);
      setSelectedId((current) => current ?? result.documents[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "문서를 불러오지 못했습니다.");
    }
  }, [accessToken, demo]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!selectedId && documents[0]) setSelectedId(documents[0].id);
  }, [documents, selectedId]);

  const selected = documents.find((document) => document.id === selectedId) ?? null;
  useEffect(() => {
    if (selected) setDraft(toDraft(selected));
  }, [selected]);

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    documents.forEach((document) => {
      const folder = document.folder || "분류 없음";
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [documents]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return documents.filter((document) => {
      if (ownerFilter === "canonical" && document.status !== "canonical") return false;
      if (ownerFilter === "mine" && document.owner_id !== profile?.id) return false;
      if (ownerFilter === "review" && !["review", "reviewed"].includes(document.status)) return false;
      if (folderFilter !== "all" && (document.folder || "분류 없음") !== folderFilter) return false;
      if (normalized && !`${document.title} ${document.content_md} ${document.tags.join(" ")}`.toLocaleLowerCase("ko-KR").includes(normalized)) return false;
      return true;
    });
  }, [documents, folderFilter, ownerFilter, profile?.id, query]);

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true); setError("");
    try {
      if (demo) {
        const updated: KnowledgeDocument = {
          ...selected,
          title: draft.title,
          content_md: draft.content,
          folder: draft.folder,
          brand: draft.brand,
          team: draft.team,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          current_version: selected.current_version + 1,
          updated_at: new Date().toISOString(),
        };
        setDocuments((current) => current.map((document) => document.id === updated.id ? updated : document));
      } else {
        const { document } = await updateDocument(accessToken, {
          id: selected.id,
          expectedVersion: selected.current_version,
          title: draft.title,
          content: draft.content,
          folder: draft.folder,
          brand: draft.brand,
          team: draft.team,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          reason: "OS 문서 작업공간에서 수정",
        });
        setDocuments((current) => current.map((item) => item.id === document.id ? document : item));
      }
      setMode("read"); setToast("새 버전으로 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const moveStatus = async (target: DocumentStatus) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      let updated: KnowledgeDocument;
      if (demo) updated = { ...selected, status: target, updated_at: new Date().toISOString() };
      else ({ document: updated } = await changeDocumentStatus(accessToken, selected.id, target));
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setToast(`${statusLabel(target)} 상태로 변경했습니다.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      title: String(data.get("title") ?? ""),
      content: String(data.get("content") ?? ""),
      folder: String(data.get("folder") ?? ""),
      brand: String(data.get("brand") ?? ""),
      team: String(data.get("team") ?? ""),
      tags: String(data.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      source: "wiki",
    };
    setBusy(true); setError("");
    try {
      let document: KnowledgeDocument;
      if (demo) {
        const now = new Date().toISOString();
        document = { id: `demo-${Date.now()}`, ...input, content_md: input.content, status: "draft", source_ref: null, owner_id: profile?.id ?? "demo-ricky", created_by: profile?.id ?? "demo-ricky", current_version: 1, created_at: now, updated_at: now };
      } else ({ document } = await createDocument(accessToken, input));
      setDocuments((current) => [document, ...current]);
      setSelectedId(document.id); setNewOpen(false); setMode("read"); setToast("개인 초안으로 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="page-header workspace-page-header">
        <div className="page-title-group"><span className="eyebrow">KNOWLEDGE WORKSPACE</span><h1>문서 작업공간</h1><p>개인의 경험을 쌓고, 검토를 거쳐 회사가 함께 쓰는 정본으로 만듭니다.</p></div>
        <div className="header-actions"><button className="secondary-button"><Folder size={16} /> 폴더 만들기</button><button className="primary-button" onClick={() => setNewOpen(true)}><FilePlus2 size={16} /> 새 문서</button></div>
      </header>

      <div className="owner-chips">
        {OWNER_FILTERS.map((item) => <button key={item.id} className={ownerFilter === item.id ? "active" : ""} onClick={() => setOwnerFilter(item.id)}>{item.label}</button>)}
      </div>
      {error ? <div className="inline-alert danger">{error}<button onClick={() => setError("")}><X size={14} /></button></div> : null}

      <section className="knowledge-workspace">
        <aside className="folder-pane">
          <div className="pane-title"><strong>폴더</strong><button><MoreHorizontal size={16} /></button></div>
          <button className={`folder-row${folderFilter === "all" ? " active" : ""}`} onClick={() => setFolderFilter("all")}><FolderOpen size={16} /><span>모든 문서</span><small>{documents.length}</small></button>
          {folders.map(([folder, count]) => (
            <button className={`folder-row${folderFilter === folder ? " active" : ""}`} key={folder} onClick={() => setFolderFilter(folder)}><ChevronRight size={13} /><Folder size={15} /><span>{folder}</span><small>{count}</small></button>
          ))}
          <div className="folder-divider" />
          <button className="folder-row"><Archive size={15} /><span>보관함</span></button>
        </aside>

        <aside className="document-pane">
          <div className="document-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="현재 문서에서 찾기" /></div>
          <div className="document-list-head"><span>{filtered.length}개 문서</span><button>최근 수정순 <ChevronDown size={12} /></button></div>
          <div className="document-list">
            {filtered.map((document) => (
              <button key={document.id} className={document.id === selectedId ? "active" : ""} onClick={() => { setSelectedId(document.id); setMode("read"); }}>
                <span className={`mini-status status-${document.status}`} />
                <span className="doc-list-copy"><strong>{document.title}</strong><small>{document.folder || "분류 없음"}</small><span>{document.tags.slice(0, 2).map((tag) => <em key={tag}>#{tag}</em>)}</span></span>
                <time>{formatDate(document.updated_at)}</time>
              </button>
            ))}
            {!filtered.length ? <div className="list-empty"><File size={22} /><span>조건에 맞는 문서가 없습니다.</span></div> : null}
          </div>
        </aside>

        <article className="editor-pane">
          {selected && draft ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-tabs">
                  <button className={mode === "read" ? "active" : ""} onClick={() => setMode("read")}><Eye size={15} /> 읽기</button>
                  <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}><Pencil size={15} /> 편집</button>
                  <button className={mode === "info" ? "active" : ""} onClick={() => setMode("info")}><Clock3 size={15} /> 정보</button>
                </div>
                <div className="editor-actions">
                  {mode === "edit" ? <button className="primary-button compact" onClick={save} disabled={busy}><Save size={14} /> 저장</button> : null}
                  {nextStatus(selected.status) ? <button className="secondary-button compact" onClick={() => moveStatus(nextStatus(selected.status)!)} disabled={busy}><Send size={14} /> {statusActionLabel(selected.status)}</button> : null}
                  <button className="icon-button"><MoreHorizontal size={17} /></button>
                </div>
              </div>
              <div className="document-meta-line"><span className={`status-pill status-${selected.status}`}>{statusLabel(selected.status)}</span><span>v{selected.current_version}</span><span>마지막 수정 {formatDate(selected.updated_at)}</span></div>
              {mode === "edit" ? (
                <div className="document-editor">
                  <input className="title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="문서 제목" />
                  <div className="meta-input-grid">
                    <label><span><Folder size={13} /> 폴더</span><input value={draft.folder} onChange={(event) => setDraft({ ...draft, folder: event.target.value })} /></label>
                    <label><span><UserRound size={13} /> 팀</span><input value={draft.team} onChange={(event) => setDraft({ ...draft, team: event.target.value })} /></label>
                    <label><span><BookCheck size={13} /> 브랜드</span><input value={draft.brand} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
                    <label><span><Tag size={13} /> 태그</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="쉼표로 구분" /></label>
                  </div>
                  <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} aria-label="문서 본문" spellCheck="false" />
                </div>
              ) : mode === "info" ? (
                <div className="document-info">
                  <h2>문서 정보</h2>
                  <dl><div><dt>상태</dt><dd>{statusLabel(selected.status)}</dd></div><div><dt>현재 버전</dt><dd>v{selected.current_version}</dd></div><div><dt>폴더</dt><dd>{selected.folder || "분류 없음"}</dd></div><div><dt>브랜드</dt><dd>{selected.brand || "전체"}</dd></div><div><dt>담당 팀</dt><dd>{selected.team || "전체"}</dd></div><div><dt>원본</dt><dd>{selected.source}</dd></div></dl>
                  <h3>정본 승격 단계</h3><div className="status-flow">{STATUS_FLOW.map((status, index) => <div key={status} className={STATUS_FLOW.indexOf(selected.status) >= index ? "done" : ""}><span>{index + 1}</span><small>{statusLabel(status)}</small></div>)}</div>
                  {selected.status !== "archived" ? <button className="ghost-button archive-action" onClick={() => moveStatus("archived")}><Archive size={15} /> 문서 보관</button> : <button className="ghost-button archive-action" onClick={() => moveStatus("draft")}><RotateCcw size={15} /> 초안으로 복원</button>}
                </div>
              ) : (
                <div className="document-reader"><h1>{selected.title}</h1><div className="reader-tags">{selected.tags.map((tag) => <span key={tag}><Hash size={11} />{tag}</span>)}</div><MarkdownView content={selected.content_md} /></div>
              )}
            </>
          ) : (
            <div className="empty-state"><div><span><FilePenLine /></span><h3>문서를 선택하세요</h3><p>왼쪽 문서 목록에서 열거나 새 문서를 만들어 시작할 수 있습니다.</p><button className="primary-button" onClick={() => setNewOpen(true)}>새 문서</button></div></div>
          )}
        </article>
      </section>

      {newOpen ? (
        <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setNewOpen(false)}>
          <form className="form-modal new-document-modal" onSubmit={create}>
            <header><div><span className="eyebrow">NEW KNOWLEDGE</span><h2>새 문서 만들기</h2></div><button type="button" onClick={() => setNewOpen(false)}><X size={18} /></button></header>
            <div className="form-fields">
              <label className="wide"><span>문서 제목</span><input name="title" required autoFocus placeholder="무엇을 남길지 명확하게 적어주세요" /></label>
              <label><span>폴더</span><input name="folder" placeholder="리키/작업 중" /></label>
              <label><span>담당 팀</span><input name="team" placeholder="콘텐츠" /></label>
              <label><span>브랜드</span><input name="brand" placeholder="브랜디액션" /></label>
              <label><span>태그</span><input name="tags" placeholder="지식, 운영, 자동화" /></label>
              <label className="wide"><span>본문</span><textarea name="content" required placeholder="# 핵심 내용\n\n문서의 맥락과 실행 기준을 적어주세요." /></label>
            </div>
            <footer><span>처음에는 개인 초안으로 안전하게 저장됩니다.</span><div><button type="button" className="ghost-button" onClick={() => setNewOpen(false)}>취소</button><button className="primary-button" disabled={busy}>{busy ? "저장 중…" : "초안 저장"}</button></div></footer>
          </form>
        </div>
      ) : null}
      {toast ? <button className="toast" onClick={() => setToast("")}><CircleCheck size={16} /> {toast}</button> : null}
    </>
  );
}

export function KnowledgeWorkspace() {
  return <Suspense><WorkspaceContent /></Suspense>;
}

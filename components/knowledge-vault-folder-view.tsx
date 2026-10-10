"use client";

import { File, FilePlus2, Folder, FolderOpen, FolderPlus, Images, List, MoreHorizontal, MoveRight } from "lucide-react";
import { type MouseEvent, type ReactNode } from "react";
import { vaultFolderKey } from "@/lib/knowledge-vault-interactions";
import type { KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";


type RowTarget = { type: "folder"; path: string } | { type: "document"; document: KnowledgeDocument };
type FolderEntry = { name: string; path: string; count: number };
type SortOrder = "recent" | "name" | "old";
const modifiedDate = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function KnowledgeVaultFolderView({ folder, folders, documents, scopeLabel, ownerNames, sort, onSort, view, gallery, loading, busy, checkedIds, onSelectDocuments, onClearSelection, onMoveSelection, onOpenFolder, onOpenDocument, onCreatePage, onContextMenu, onViewChange, onCreateFolder, onRename, renameInput, onSelectRow, pendingFolders }: {
  folder: string; folders: FolderEntry[]; documents: KnowledgeDocument[]; scopeLabel: string; ownerNames: Map<string, string>; folderOptions: string[];
  sort: SortOrder; onSort: (sort: SortOrder) => void; view: "folder" | "gallery"; gallery?: ReactNode; loading: boolean; busy: boolean;
  checkedIds: Set<string>; onSelectDocuments: (ids: string[], selected: boolean) => void; onClearSelection: () => void; onMoveSelection: () => void;
  onOpenFolder: (path: string) => void; onOpenDocument: (id: string) => void; onCreatePage: (folder: string) => void;
  onCreateFolder: (parent: string) => void; onRename: (key: string) => void; renameInput: (key: string) => ReactNode; pendingFolders: string[]; onSelectRow: (event: MouseEvent, key: string, ordered: string[]) => boolean;
  onContextMenu: (event: MouseEvent, target: RowTarget) => void; onViewChange: (view: "folder" | "gallery") => void;
}) {
  const keys = [...folders.map(item => vaultFolderKey(item.path)), ...documents.map(item => item.id)];
  const allSelected = keys.length > 0 && keys.every(key => checkedIds.has(key));
  const title = folder.split("/").at(-1) || "문서 보관함";
  return <div className="vault-folder-view">
    <header><span className="vault-folder-icon"><FolderOpen size={25} /></span><div><h1>{folder ? <button onClick={() => onRename(vaultFolderKey(folder))}>{title}</button> : title}{renameInput(vaultFolderKey(folder))}</h1><p>{folder || "전체 폴더"} · 하위 폴더 {folders.length} · 문서 {documents.length} ({scopeLabel})</p></div></header>
    <div className="vault-folder-tools">
      <button className="primary-button compact" onClick={() => onCreatePage(folder)}><FilePlus2 size={15} /> 새 페이지</button>
      <button className="secondary-button compact" onClick={() => onCreateFolder(folder)}><FolderPlus size={15} /> 새 폴더</button>
      <div className="vault-view-switch" role="group" aria-label="폴더 보기 방식"><button aria-pressed={view === "folder"} onClick={() => onViewChange("folder")}><List size={15} /> 목록</button><button aria-pressed={view === "gallery"} onClick={() => onViewChange("gallery")}><Images size={15} /> 갤러리</button></div>
      <label className="sr-only" htmlFor="vault-folder-sort">폴더 안 정렬</label><select id="vault-folder-sort" aria-label="폴더 안 정렬" value={sort} onChange={event => onSort(event.target.value as SortOrder)}><option value="recent">최근 수정순</option><option value="name">이름순</option><option value="old">오래된 순</option></select>
    </div>
    {checkedIds.size === 1 ? <div className="vault-folder-selection" role="region" aria-label="선택한 문서 작업"><span>1개 선택</span><button className="secondary-button compact" disabled={busy} onClick={onMoveSelection}><MoveRight size={14} /> 이동</button><button className="ghost-button" onClick={onClearSelection}>선택 해제</button></div> : null}
    {view === "gallery" ? gallery : <div className="vault-folder-table-wrap"><table className="vault-folder-table" aria-label="폴더 내용" aria-busy={loading}>
      <colgroup><col className="vault-select-col" /><col /><col className="vault-status-col" /><col className="vault-owner-col" /><col className="vault-modified-col" /><col className="vault-actions-col" /></colgroup>
      <thead><tr><th><input type="checkbox" aria-label="이 폴더 문서 전체 선택" disabled={!keys.length} checked={allSelected} ref={input => { if (input) input.indeterminate = !allSelected && documents.some(document => checkedIds.has(document.id)); }} onChange={event => onSelectDocuments(keys, event.target.checked)} /></th><th scope="col">이름</th><th scope="col">상태</th><th scope="col">소유자</th><th scope="col">수정</th><th><span className="sr-only">추가 작업</span></th></tr></thead>
      <tbody>{folders.map(item => <tr key={item.path} data-selected={checkedIds.has(vaultFolderKey(item.path))} onContextMenu={event => onContextMenu(event, { type: "folder", path: item.path })}><td><input type="checkbox" aria-label={`${item.name} 폴더 선택`} checked={checkedIds.has(vaultFolderKey(item.path))} onChange={event => onSelectDocuments([vaultFolderKey(item.path)], event.target.checked)}/></td><td>{renameInput(vaultFolderKey(item.path))}<button className="vault-item-name" aria-label={`${item.name} 폴더 열기`} onClick={event => { if (!onSelectRow(event, vaultFolderKey(item.path), keys)) onOpenFolder(item.path); }}><Folder size={16} /><strong>{item.name}</strong></button></td><td><span className="vault-folder-kind">{pendingFolders.includes(item.path) && !item.count ? "빈 폴더" : "폴더"}</span></td><td /><td className="vault-item-muted">문서 {item.count}개</td><td><button className="vault-row-more" aria-label={`${item.name} 폴더 추가 작업`} onClick={event => onContextMenu(event, { type: "folder", path: item.path })}><MoreHorizontal size={17} /></button></td></tr>)}
        {documents.map(document => <tr key={document.id} data-selected={checkedIds.has(document.id)} onContextMenu={event => onContextMenu(event, { type: "document", document })}><td><input type="checkbox" aria-label={`${document.title} 선택`} checked={checkedIds.has(document.id)} onChange={event => onSelectDocuments([document.id], event.target.checked)} /></td><td>{renameInput(document.id)}<button className="vault-item-name" onClick={event => { if (!onSelectRow(event, document.id, keys)) onOpenDocument(document.id); }}><File size={16} /><strong>{document.title}</strong></button></td><td><span className={`status-pill status-${document.status}`}>{statusLabel(document.status)}</span></td><td className="vault-item-muted" title={ownerNames.get(document.owner_id) || "소유자 미지정"}>{ownerNames.get(document.owner_id) || "소유자 미지정"}</td><td className="vault-item-muted"><time dateTime={document.updated_at}>{modifiedDate.format(new Date(document.updated_at))}</time></td><td><button className="vault-row-more" aria-label={`${document.title} 문서 추가 작업`} onClick={event => onContextMenu(event, { type: "document", document })}><MoreHorizontal size={17} /></button></td></tr>)}
        {!folders.length && !documents.length ? <tr><td colSpan={6} className="vault-folder-empty">{loading ? "문서를 불러오는 중입니다…" : "이 폴더에 표시할 문서가 없습니다."}</td></tr> : null}
      </tbody></table></div>}

  </div>;
}

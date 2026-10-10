"use client";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus } from "lucide-react";
import { knowledgeFolderOptions } from "@/lib/knowledge-folders";
import { isStringArray, matchesVaultName, readVaultStorage, writeVaultStorage } from "@/lib/knowledge-vault-interactions";

export function KnowledgeVaultFolderChooser({ options, value, onChange, label = "이동할 폴더", disabled, excluded = [], onConfirm, onCreate }: {
  options: string[]; value: string; onChange: (path: string) => void; label?: string; disabled?: boolean;
  excluded?: string[]; onConfirm?: (path: string) => void; onCreate?: (parent: string, name: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(knowledgeFolderOptions([value])));
  const [recent, setRecent] = useState<string[]>([]);
  const [creating, setCreating] = useState(false), [name, setName] = useState(""), [error, setError] = useState("");
  useEffect(() => { setRecent(readVaultStorage("brandy-vault-v2-recent-destinations", [], isStringArray).slice(0, 4)); }, []);
  const blocked = (path: string) => excluded.some(root => path === root || path.startsWith(`${root}/`));
  const choose = (path: string, confirm = false) => {
    if (disabled || blocked(path)) return;
    onChange(path);
    const next = [path, ...recent.filter(item => item !== path)].slice(0, 4);
    setRecent(next); writeVaultStorage("brandy-vault-v2-recent-destinations", next);
    if (confirm) onConfirm?.(path);
  };
  const paths = knowledgeFolderOptions(options);
  return <section className="vault-folder-chooser" aria-label={label}>
    <label>{label}<input aria-label={`${label} 검색`} placeholder="폴더 이름·초성으로 찾기" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></label>
    <div className="vault-recent-folders"><small>최근</small>{recent.filter(path => !blocked(path) && (!path || paths.includes(path))).map(path => <button type="button" key={path} disabled={disabled} onClick={() => choose(path)}>{path.split("/").at(-1) || "최상위"}</button>)}</div>
    <div role="tree" aria-label="이동 위치" className="vault-chooser-tree">
      <button type="button" role="treeitem" aria-level={1} aria-selected={value === ""} disabled={disabled} onClick={() => choose("")} onDoubleClick={() => choose("", true)}><Folder size={15} /> 최상위</button>
      {paths.filter(path => query ? matchesVaultName(path, query) : path.split("/").slice(0, -1).every((_, index, parts) => expanded.has(parts.slice(0, index + 1).join("/")))).map(path => {
        const depth = path.split("/").length, hasChildren = paths.some(item => item.startsWith(`${path}/`));
        return <div key={path} style={{ paddingLeft: (depth - 1) * 16 }}>
          <button type="button" className="vault-chooser-chevron" aria-label={`${path} ${expanded.has(path) ? "접기" : "펼치기"}`} disabled={disabled || !hasChildren} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; })}>{expanded.has(path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
          <button type="button" role="treeitem" aria-level={depth} aria-selected={value === path} disabled={disabled || blocked(path)} onClick={() => choose(path)} onDoubleClick={() => choose(path, true)}><Folder size={15} /><span>{query ? path : path.split("/").at(-1)}</span></button>
        </div>;
      })}
      {query && !paths.some(path => matchesVaultName(path, query)) ? <p>일치하는 폴더가 없습니다.</p> : null}
    </div>
    <footer><span title={value}>{value || "최상위"}</span>{onCreate ? <button type="button" disabled={disabled} onClick={() => { setCreating(true); setError(""); }}><FolderPlus size={14} /> 새 폴더</button> : null}</footer>
    {creating ? <div><input autoFocus aria-label="새 폴더 이름" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setCreating(false); } if (event.key === "Enter") { event.preventDefault(); try { const path = onCreate!(value, name); choose(path); setName(""); setCreating(false); } catch (reason) { setError((reason as Error).message); } } }} /><small>Enter 생성 · Esc 취소 · 첫 페이지를 저장하면 모두에게 보입니다</small>{error ? <p role="alert">{error}</p> : null}</div> : null}
  </section>;
}

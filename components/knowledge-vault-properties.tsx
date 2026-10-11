"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { KnowledgeVaultFolderChooser } from "./knowledge-vault-folder-chooser";
import type { KnowledgeDraft } from "@/lib/knowledge-workspace-state";

export function KnowledgeVaultProperties({ value, onChange, folders, teams, brands, disabled, folderDisabled, onCreateFolder }: {
  value: KnowledgeDraft; onChange: (value: KnowledgeDraft) => void; folders: string[]; teams: string[]; brands: string[]; disabled?: boolean; folderDisabled?: boolean;
  onCreateFolder: (parent: string, name: string) => string;
}) {
  const [tag, setTag] = useState("");
  const tags = value.tags.split(",").map(item => item.trim()).filter(Boolean);
  return <div className="vault-property-chips">
    <details><summary>폴더 · {value.folder || "미분류"}</summary><KnowledgeVaultFolderChooser options={folders} value={value.folder} onChange={folder => onChange({ ...value, folder })} disabled={disabled || folderDisabled} onCreate={onCreateFolder} label="저장 위치" /></details>
    {([ ["team", "팀", teams], ["brand", "브랜드", brands] ] as const).map(([key, label, options]) => <details key={key}><summary>{label} · {value[key] || "미지정"}</summary><div className="vault-property-menu"><label>{label}<input aria-label={label} maxLength={120} disabled={disabled} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })}/></label>{[...new Set(options)].filter(Boolean).map(item => <button type="button" key={item} disabled={disabled} onClick={event => { onChange({ ...value, [key]: item }); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{item}</button>)}</div></details>)}
    {tags.map(item => <span className="vault-tag" key={item}>#{item}<button type="button" disabled={disabled} aria-label={`${item} 태그 제거`} onClick={() => onChange({ ...value, tags: tags.filter(tag => tag !== item).join(", ") })}><X size={11}/></button></span>)}
    <details><summary>+ 태그</summary><div className="vault-property-menu"><input aria-label="태그 추가" placeholder="Enter로 추가" value={tag} maxLength={60} disabled={disabled} onChange={event => setTag(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (tag.trim() && tags.length < 30) { onChange({ ...value, tags: [...new Set([...tags, tag.trim()])].join(", ") }); setTag(""); } } }}/></div></details>
  </div>;
}

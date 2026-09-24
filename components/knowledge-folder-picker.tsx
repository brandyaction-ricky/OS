"use client";
import { useId, useState } from "react";

export function KnowledgeFolderPicker({ options, value, onChange, name = "folder", label = "저장 위치", disabled = false }: {
  options: string[]; value: string; onChange: (value: string) => void; name?: string; label?: string; disabled?: boolean;
}) {
  const id = useId();
  const [custom, setCustom] = useState(Boolean(value && !options.includes(value)));
  return <div className="knowledge-folder-picker">
    <label htmlFor={id}>{label}</label>
    <input type="hidden" name={name} value={value} />
    <div className="folder-choice">
      <select id={id} value={custom ? "__new__" : value} disabled={disabled} onChange={event => { if (event.target.value === "__new__") { setCustom(true); } else { setCustom(false); onChange(event.target.value); } }}>
        <option value="">분류 없음</option>
        {[...new Set([...options, ...(value ? [value] : [])])].map(path => <option key={path} value={path}>{path}</option>)}
        <option value="__new__">새 폴더 경로 입력…</option>
      </select>
    </div>
    {custom ? <label><span>새 폴더 경로</span><input disabled={disabled} maxLength={160} value={value} onChange={event => onChange(event.target.value)} placeholder="예: 기존 폴더/새 하위 폴더" /></label> : null}
    <small>저장 위치 · {value || "분류 없음"}{custom ? " (첫 문서 저장 시 생성)" : ""}</small>
  </div>;
}

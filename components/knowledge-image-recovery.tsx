"use client";

import { ImageUp, Link2, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  finalizeKnowledgeAssetUpload,
  knowledgeAssetSha256,
  listMissingKnowledgeAssets,
  prepareKnowledgeAssetUpload,
  uploadKnowledgeAttachment,
} from "@/lib/api-client";
import { knowledgeAssetRecoveryCandidates, normalizeKnowledgeAssetReference, type MissingKnowledgeAssetReference } from "@/lib/knowledge-assets";
import { KnowledgeModal } from "./knowledge-modal";

type Match = { reference: MissingKnowledgeAssetReference; file: File };
type Candidate = { reference: MissingKnowledgeAssetReference; options: Array<{ file: File; index: number }>; selectedIndex: number | null };

function imageMimeType(file: File) {
  if (file.type.startsWith("image/")) return file.type;
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

function matchFiles(references: MissingKnowledgeAssetReference[], files: File[], selections: Record<string, number>) {
  const candidates = files.map((file, index) => ({
    file,
    index,
    id: String(index),
    path: normalizeKnowledgeAssetReference(file.webkitRelativePath || file.name),
    name: normalizeKnowledgeAssetReference(file.name),
  }));
  const matches: Match[] = [];
  let automatic = 0;
  const choices: Candidate[] = [];
  const unmatched: MissingKnowledgeAssetReference[] = [];
  for (const reference of references) {
    const options = knowledgeAssetRecoveryCandidates(reference, candidates);
    if (!options.length) { unmatched.push(reference); continue; }
    if (options.length === 1) {
      matches.push({ reference, file: options[0].file });
      automatic += 1;
    }
    else if (options.length > 1) {
      const selected = options.find((option) => option.index === selections[`${reference.documentId}:${reference.referenceKey}`]);
      if (selected) matches.push({ reference, file: selected.file });
      choices.push({ reference, options: options.map(({ file, index }) => ({ file, index })), selectedIndex: selected?.index ?? null });
    }
  }
  return { matches, automatic, choices, unmatched };
}

export function KnowledgeImageRecovery({ token, folder, onClose, onChanged }: { token: string | null; folder: string; onClose: () => void; onChanged: () => void }) {
  const [references, setReferences] = useState<MissingKnowledgeAssetReference[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const result = useMemo(() => matchFiles(references, files, selections), [references, files, selections]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listMissingKnowledgeAssets(token, folder)
      .then((response) => { if (active) setReferences(response.references); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "복원할 이미지 목록을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [folder, token]);

  const selectFiles = (selected: FileList | null) => {
    if (!selected || busy) return;
    const images = Array.from(selected).filter((file) => imageMimeType(file));
    setFiles(images);
    setSelections({});
    setError(images.length ? "" : "JPG·PNG·WebP·GIF 이미지가 없습니다.");
  };

  const restore = async () => {
    if (!result.matches.length || busy) return;
    setBusy(true); setError("");
    const hashes = new Map<File, string>();
    const completed = new Set<string>();
    const failures: string[] = [];
    for (let index = 0; index < result.matches.length; index += 1) {
      const { reference, file } = result.matches[index];
      setProgress(`${index + 1}/${result.matches.length} · ${reference.documentTitle} · ${file.name}`);
      try {
        let sha256 = hashes.get(file);
        if (!sha256) { sha256 = await knowledgeAssetSha256(file); hashes.set(file, sha256); }
        const input = {
          documentId: reference.documentId, reference: reference.reference, fileName: file.name,
          fileSize: file.size, mimeType: imageMimeType(file), sha256,
          sourceDocument: reference.sourceDocument, fileCreatedAt: null,
        };
        const prepared = await prepareKnowledgeAssetUpload(token, input);
        if (!prepared.duplicate) {
          if (!prepared.upload) throw new Error("업로드 경로가 없습니다.");
          await uploadKnowledgeAttachment(prepared.upload.path, prepared.upload.token, file, prepared.upload.type);
          await finalizeKnowledgeAssetUpload(token, { ...input, path: prepared.upload.path });
        }
        completed.add(`${reference.documentId}:${reference.referenceKey}`);
      } catch (reason) {
        failures.push(`${reference.documentTitle}/${reference.fileName}: ${reason instanceof Error ? reason.message : "복원 실패"}`);
      }
    }
    if (completed.size) {
      setReferences((current) => current.filter((reference) => !completed.has(`${reference.documentId}:${reference.referenceKey}`)));
      onChanged();
    }
    setProgress(""); setBusy(false);
    setError(failures.length ? `${completed.size}개 연결, ${failures.length}개 실패 · ${failures.slice(0, 3).join(" · ")}` : `${completed.size}개 이미지를 연결했습니다.`);
  };

  return <KnowledgeModal title="원본 이미지 복원" onClose={onClose} busy={busy}>
    <div className="form-modal knowledge-image-recovery">
      <header><h2>원본 이미지 복원</h2></header>
      <div className="knowledge-image-recovery-body">
        <p><strong>{folder || "전체 활성 문서"}</strong>의 본문은 수정하지 않고, <code>![[파일명]]</code>과 Markdown 이미지 경로를 실제 파일에 연결합니다.</p>
        {loading ? <p className="quiet-state"><LoaderCircle className="spin" size={18} /> 복원할 이미지 경로를 확인하는 중입니다.</p> : <dl className="knowledge-recovery-summary"><div><dt>연결 필요</dt><dd>{references.length}개</dd></div><div><dt>선택한 이미지</dt><dd>{files.length}개</dd></div><div><dt>자동 일치</dt><dd>{result.automatic}개</dd></div><div><dt>후보 선택 필요</dt><dd>{result.choices.filter((choice) => choice.selectedIndex === null).length}개</dd></div></dl>}
        <div className="knowledge-recovery-pickers">
          <label><ImageUp size={20} /><strong>이미지 파일 선택</strong><span>여러 파일을 한 번에 선택할 수 있습니다.</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={busy} onChange={(event) => selectFiles(event.target.files)} /></label>
          <label><Link2 size={20} /><strong>이미지 폴더 선택</strong><span>하위 경로까지 비교해 같은 이름의 오연결을 줄입니다.</span><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple {...{ webkitdirectory: "" }} disabled={busy} onChange={(event) => selectFiles(event.target.files)} /></label>
        </div>
        {result.choices.length ? <div className="knowledge-recovery-choices" aria-label="중복 이미지 후보 선택">{result.choices.map(({ reference, options, selectedIndex }) => {
          const selectionKey = `${reference.documentId}:${reference.referenceKey}`;
          return <label key={selectionKey}><span><strong>{reference.documentTitle}</strong><small>{reference.reference}</small></span><select aria-label={`${reference.documentTitle} ${reference.reference} 이미지 후보`} value={selectedIndex === null ? "" : String(selectedIndex)} onChange={(event) => setSelections((current) => {
            const next = { ...current };
            if (!event.target.value) delete next[selectionKey];
            else next[selectionKey] = Number(event.target.value);
            return next;
          })}><option value="">올바른 파일 선택</option>{options.map(({ file, index }) => <option key={index} value={index}>{file.webkitRelativePath || file.name} · {(file.size / 1024).toFixed(0)}KB</option>)}</select></label>;
        })}</div> : null}
        {files.length && result.unmatched.length ? <div className="knowledge-recovery-unmatched"><strong>선택한 파일에서 찾지 못한 이미지 {result.unmatched.length}개</strong><ul>{result.unmatched.map((reference) => <li key={`${reference.documentId}:${reference.referenceKey}`}><span>{reference.reference}</span><small>{reference.documentTitle}</small></li>)}</ul></div> : null}
        {progress ? <p className="knowledge-attachment-progress" role="status">{progress}</p> : null}
        {error ? <p className="inline-alert" role="status">{error}</p> : null}
        {references.length === 0 && !loading ? <p className="quiet-state">현재 범위에 연결이 필요한 로컬 이미지가 없습니다.</p> : null}
      </div>
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>닫기</button><button type="button" className="primary-button" disabled={busy || !result.matches.length} onClick={() => void restore()}>{busy ? "연결 중…" : `${result.matches.length}개 이미지 연결`}</button></footer>
    </div>
  </KnowledgeModal>;
}

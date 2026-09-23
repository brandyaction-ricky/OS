"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { getDocument, updateDocument } from "@/lib/api-client";
import { executeFolderMoves, normalizeKnowledgeFolder, type FolderMove } from "@/lib/knowledge-folders";
import type { KnowledgeDocument } from "@/lib/types";
import { KnowledgeFolderPicker } from "./knowledge-folder-picker";
import { KnowledgeModal } from "./knowledge-modal";

export function KnowledgeDocumentMover({ documents, options, token, demo, onSaved, onBusy, onClose }: {
  documents: KnowledgeDocument[]; options: string[]; token: string | null; demo: boolean;
  onSaved: (document: KnowledgeDocument, previous?: KnowledgeDocument) => void; onBusy: (busy: boolean) => void; onClose: () => void;
}) {
  const [folder, setFolder] = useState(documents[0]?.folder ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<Array<{move: FolderMove; message: string}>>([]);
  const [progress, setProgress] = useState({done: 0, total: 0});
  const [completed, setCompleted] = useState(0);
  const move = async (retry = false) => {
    if (busy) return;
    let destination: string;
    try { destination = folder.trim() ? normalizeKnowledgeFolder(folder) : ""; } catch (reason) { setError((reason as Error).message); return; }
    const plan = retry ? failed.map(item => item.move) : documents.filter(item => item.folder !== destination).map(item => ({id: item.id, title: item.title, from: item.folder, to: destination, version: item.current_version}));
    if (!plan.length) { setError("현재 위치와 다른 폴더를 선택해 주세요."); return; }
    setBusy(true); onBusy(true); setError(""); setProgress({done: 0, total: plan.length});
    const result = await executeFolderMoves(plan, async item => {
      const previous = documents.find(document => document.id === item.id)!;
      const current = !demo && retry ? (await getDocument(token, item.id)).document : previous;
      if (retry && current.folder === item.to) { onSaved(current, previous); return current; }
      if (current.folder !== item.from) throw new Error("문서의 위치가 다른 작업에서 바뀌었습니다. 위치를 확인해 주세요.");
      const updated = demo ? { ...current, folder: item.to, current_version: current.current_version + 1, updated_at: new Date().toISOString() } : (await updateDocument(token, { id: item.id, expectedVersion: current.current_version, folder: item.to, reason: "선택 문서 위치 이동" })).document;
      onSaved(updated, current); return updated;
    }, done => setProgress({done, total: plan.length}));
    setCompleted(count => count + result.succeeded.length); setFailed(result.failed); setBusy(false); onBusy(false);
  };
  return <KnowledgeModal title="문서 위치 이동" onClose={onClose} busy={busy}><div className="form-modal folder-action-modal">
    <header><h2>문서 위치 이동</h2><button disabled={busy} aria-label="문서 이동 닫기" onClick={onClose}><X size={18} /></button></header>
    <div className="form-fields"><p className="wide">선택한 문서 {documents.length}개</p><div className="folder-move-preview wide">{documents.map(item => <div key={item.id}><strong>{item.title}</strong><small>{item.folder || "분류 없음"}</small></div>)}</div>
      <div className="wide"><KnowledgeFolderPicker options={options} label="이동할 폴더" value={folder} onChange={setFolder} disabled={busy || completed > 0 || failed.length > 0} /></div>
      {error ? <p className="inline-alert danger wide" role="alert">{error}</p> : null}
      {busy || completed || failed.length ? <p role="status" className="wide">{busy ? `${progress.done} / ${progress.total}개 처리 중` : `${completed}개 완료 · ${failed.length}개 실패`}</p> : null}
      {failed.map(item => <p className="inline-alert danger wide" key={item.move.id}>{item.move.title} · {item.message}</p>)}
    </div><footer><button className="ghost-button" disabled={busy} onClick={onClose}>닫기</button>{failed.length ? <button className="primary-button" disabled={busy} onClick={() => move(true)}>실패 {failed.length}개 재시도</button> : !completed ? <button className="primary-button" disabled={busy} onClick={() => move()}>선택 문서 이동</button> : null}</footer>
  </div></KnowledgeModal>;
}

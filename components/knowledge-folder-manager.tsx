"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { getDocument, listDocuments, updateDocument } from "@/lib/api-client";
import { executeFolderMoves, knowledgeFolderOptions, normalizeKnowledgeFolder, planFolderMove, type FolderMove } from "@/lib/knowledge-folders";
import type { KnowledgeDocument } from "@/lib/types";
import { KnowledgeModal } from "./knowledge-modal";

export function KnowledgeFolderManager({ source: initialSource, options, documents, token, demo, onClose, onSaved, onNew, onBusy }: {
  source: string; options: string[]; documents: KnowledgeDocument[]; token: string | null; demo: boolean;
  onClose: () => void; onSaved: (document: KnowledgeDocument, previous?: KnowledgeDocument) => void; onNew: (folder: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [source, setSource] = useState(initialSource);
  const [name, setName] = useState(initialSource.split("/").at(-1) ?? "");
  const [parent, setParent] = useState(initialSource.split("/").slice(0, -1).join("/"));
  const [snapshot, setSnapshot] = useState(documents);
  const [plan, setPlan] = useState<FolderMove[] | null>(null);
  const [failed, setFailed] = useState<Array<{move: FolderMove; message: string}>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [executed, setExecuted] = useState(false);
  const target = parent ? `${parent}/${name}` : name;
  const setWorking = (value: boolean) => { setBusy(value); onBusy(value); };
  const preview = async () => {
    setWorking(true); setError(""); setFailed([]); setCompleted(0); setExecuted(false);
    try {
      const destination = normalizeKnowledgeFolder(target);
      if (name.includes("/") || name.includes("\\")) throw new Error("폴더 이름에는 경로 구분자를 넣지 말고 상위 폴더를 선택해 주세요.");
      if (options.includes(destination)) throw new Error("같은 위치에 폴더가 있습니다. 다른 이름이나 상위 폴더를 선택해 주세요.");
      let affected = documents;
      if (!demo) {
        affected = [];
        // Exact paths avoid treating punctuation in folder names as filter syntax.
        for (const path of options.filter(path => path === source || path.startsWith(`${source}/`))) {
          for (let offset = 0; ; offset += 200) {
            const query = new URLSearchParams({view: "summary", folder: path, exactFolder: "true", limit: "200", offset: String(offset)});
            const page = await listDocuments(token, query.toString());
            affected.push(...page.documents);
            if (offset + page.documents.length >= page.total || !page.documents.length) break;
          }
        }
      }
      const next = planFolderMove(affected, source, destination);
      if (!next.length) throw new Error("이동할 문서가 없습니다. 폴더 목록을 새로고침해 주세요.");
      setSnapshot(affected); setPlan(next);
    } catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  };
  const execute = async (retry: boolean) => {
    if (!plan || busy) return;
    setWorking(true); setError(""); setDone(0);
    const pending = retry ? failed.map(item => item.move) : plan;
    const result = await executeFolderMoves(pending, async move => {
      let current = snapshot.find(item => item.id === move.id);
      if (!demo && retry) current = (await getDocument(token, move.id)).document;
      if (retry && current?.folder === move.to) { onSaved(current); return current; }
      if (retry && current?.folder !== move.from) throw new Error("다른 작업에서 위치가 변경됐습니다. 현재 위치를 확인해 주세요.");
      const document = demo ? { ...current!, folder: move.to, current_version: current!.current_version + 1, updated_at: new Date().toISOString() } : (await updateDocument(token, { id: move.id, expectedVersion: retry ? current!.current_version : move.version, folder: move.to, reason: "폴더 이름 및 위치 변경" })).document;
      onSaved(document, current); return document;
    }, setDone);
    setFailed(result.failed); setCompleted(count => count + result.succeeded.length); setExecuted(true); setWorking(false);
  };
  return <KnowledgeModal title="폴더 관리" busy={busy} onClose={onClose}>
    <div className="form-modal folder-action-modal">
      <header><h2>폴더 관리</h2><button aria-label="폴더 관리 닫기" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="form-fields">
        {error ? <p className="inline-alert danger wide" role="alert">{error}</p> : null}
        {!plan ? <>
          <label className="wide"><span>관리할 폴더</span><select value={source} onChange={event => { const path = event.target.value; setSource(path); setName(path.split("/").at(-1) ?? ""); setParent(path.split("/").slice(0, -1).join("/")); }} disabled={busy}><option value="">폴더를 선택하세요</option>{options.map(path => <option key={path} value={path}>{path}</option>)}</select></label>
          <label><span>폴더 이름 변경</span><input maxLength={160} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
          <label><span>이동할 상위 폴더</span><select value={parent} onChange={event => setParent(event.target.value)} disabled={busy}><option value="">최상위</option>{knowledgeFolderOptions(options).filter(path => path !== source && !path.startsWith(`${source}/`)).map(path => <option key={path} value={path}>{path}</option>)}</select></label>
          <p className="wide">변경 후 위치 · {target || "폴더 이름을 입력하세요"}</p>
          <button className="secondary-button wide" disabled={!source || busy} onClick={() => onNew(source)}>이 폴더에 새 문서 만들기</button>
          <button className="secondary-button wide" disabled={!source || busy} onClick={() => onNew(`${source}/새 하위 폴더`)}>하위 폴더에 새 문서</button>
          <small className="wide">폴더는 첫 문서를 저장할 때 만들어집니다. 하위 폴더를 포함해 문서 위치만 변경하며, 권한 없는 문서는 실패 목록에 남습니다.</small>
        </> : <>
          <p className="wide"><strong>{plan.length}개 문서</strong> · {source} → {plan[0]?.to.slice(0, target.length) || target}<br />보관 문서도 포함됩니다. 문서 ID·본문·소유자·상태는 유지됩니다.</p>
          <div className="folder-move-preview wide">{plan.map(move => <div key={move.id}><strong>{move.title}</strong><small>{move.from} → {move.to}</small></div>)}</div>
          {busy ? <p role="status" className="wide">{done} / {executed ? failed.length : plan.length}개 처리 중</p> : null}
          {executed ? <p role="status" className="wide">{completed}개 완료 · {failed.length}개 실패{failed.length ? " — 완료된 문서는 다시 처리하지 않습니다." : ""}</p> : null}
          {failed.map(item => <div className="inline-alert danger wide" key={item.move.id}><strong>{item.move.title}</strong><span>{item.message}</span></div>)}
        </>}
      </div>
      <footer><button className="ghost-button" disabled={busy} onClick={onClose}>닫기</button>{plan && !executed ? <button className="secondary-button" disabled={busy} onClick={() => setPlan(null)}>이전</button> : null}
        {!plan ? <button className="primary-button" disabled={busy || !source} onClick={preview}>영향 문서 확인</button> : !executed ? <button className="primary-button" disabled={busy} onClick={() => execute(false)}>확인한 {plan.length}개 이동</button> : failed.length ? <button className="primary-button" disabled={busy} onClick={() => execute(true)}>실패 {failed.length}개 재시도</button> : null}
      </footer>
    </div>
  </KnowledgeModal>;
}

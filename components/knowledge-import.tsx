"use client";
import { useState, type FormEvent } from "react";
import { apiRequest, createDocument, getDocument, updateDocument } from "@/lib/api-client";
import { getDemoKnowledgeDocuments } from "@/lib/demo-knowledge-store";
import { executeImports, defaultImportAction, importContentHash, importTitle, normalizeImportPath, IMPORT_BYTE_LIMIT, IMPORT_FILE_LIMIT, type ImportCandidate, type ImportProbe } from "@/lib/knowledge-import";
import { normalizeKnowledgeFolder } from "@/lib/knowledge-folders";
import { documentCreateSchema } from "@/lib/validation";
import type { KnowledgeDocument } from "@/lib/types";
import { useDialogLeaveGuard } from "@/hooks/use-dialog-leave-guard";
import { KnowledgeModal } from "./knowledge-modal";
import { KnowledgeFolderPicker } from "./knowledge-folder-picker";

type Item = ImportProbe & { content: string; candidates: ImportCandidate[]; action: "skip" | "create" | "update"; target: string; sourceRef: string; done?: boolean; error?: string };
export function KnowledgeImport({ token, demo, ownerId, team, options, onSaved, onBusy, onClose }: { token: string | null; demo: boolean; ownerId: string; team: string; options: string[]; onSaved: (document: KnowledgeDocument) => void; onBusy: (busy: boolean) => void; onClose: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [processed, setProcessed] = useState(false);
  const setWorking = (value: boolean) => {setBusy(value);onBusy(value);};
  const close = () => {if (!busy) {if (items.some(item => !item.done && item.action !== "skip")) setConfirmClose(true); else onClose();}};
  const {cancelLeave, confirmLeave} = useDialogLeaveGuard(busy || items.some(item => !item.done && item.action !== "skip"), close);
  const selectFiles = async (files: FileList | null) => {
    if (!files?.length || busy) return;
    setWorking(true);setError("");setProcessed(false);
    try {
      const markdownFiles = Array.from(files).filter(file => /\.md$/i.test(file.name));
      if (!markdownFiles.length) throw new Error("선택한 폴더에 Markdown 파일이 없습니다.");
      if (markdownFiles.length > IMPORT_FILE_LIMIT) throw new Error("한 번에 50개까지 선택해 주세요. 기존 선택은 유지됩니다.");
      const prepared: Array<ImportProbe & { content: string }> = [];
      for (const file of markdownFiles) {
        if (!/\.md$/i.test(file.name) || file.size > IMPORT_BYTE_LIMIT) throw new Error("내용이 있는 .md 파일만 지원합니다. 파일당 최대 1.5MB입니다.");
        const content = await file.text();
        if (!content.trim()) throw new Error("빈 파일이 포함되어 있습니다. 파일 내용을 확인해 주세요.");
        const path = normalizeImportPath(file.webkitRelativePath || file.name);
        prepared.push({id: crypto.randomUUID(), path, title: importTitle(path, content), hash: await importContentHash(content), content});
      }
      const candidates = demo ? await Promise.all(prepared.map(async file => ({id:file.id,candidates:await Promise.all(getDemoKnowledgeDocuments().filter(row => row.source_ref === file.path || row.title === file.title).map(async row => ({id:row.id,title:row.title,folder:row.folder,status:row.status,current_version:row.current_version,source_ref:row.source_ref,canUpdate:row.status === "draft" && row.owner_id === ownerId,sameContent:await importContentHash(row.content_md) === file.hash})))}))) : (await apiRequest<{files:Array<{id:string;candidates:ImportCandidate[]}>}>("/api/v1/documents/import-preview", {token,method:"POST",body:JSON.stringify({files:prepared.map(({id,path,title,hash}) => ({id,path,title,hash}))})})).files;
      const seen = new Set<string>(), paths = new Set<string>();
      const next = prepared.map(file => {
        const matches = candidates.find(row => row.id === file.id)?.candidates;
        if (!matches) throw new Error("중복 확인 결과가 누락되었습니다. 파일을 다시 선택해 주세요.");
        const action=defaultImportAction(file.hash,matches,seen);seen.add(file.hash);
        const copy=paths.has(file.path)||matches.some(row => row.source_ref === file.path);paths.add(file.path);
        return {...file,candidates:matches,action,target:matches.find(row => row.canUpdate)?.id ?? "",sourceRef:copy?`${file.path}#copy=${file.id}`:file.path};
      });
      setItems(next);
      if (files.length > markdownFiles.length) setError(`Markdown 이외의 파일 ${files.length - markdownFiles.length}개는 제외했습니다.`);
    } catch (reason) {setError(reason instanceof Error ? reason.message : "파일을 확인하지 못했습니다.");}
    finally {setWorking(false);}
  };
  const patch = (id: string, change: Partial<Item>) => setItems(current => current.map(item => item.id===id ? {...item,...change} : item));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();if(busy)return;
    const form=new FormData(event.currentTarget);setWorking(true);setError("");
    try {
      const metadata={folder: folder.trim() ? normalizeKnowledgeFolder(folder) : "",team:String(form.get("team")??""),brand:String(form.get("brand")??""),tags:String(form.get("tags")??"").split(",").map(tag=>tag.trim()).filter(Boolean)};
      documentCreateSchema.parse({...metadata,title:"검증",content:"검증"});
      await executeImports(items, async item => {
          let document:KnowledgeDocument;
          if(item.action==="update") {
            const target=item.candidates.find(row=>row.id===item.target);
            if(!target)throw new Error("갱신할 기존 문서를 선택해 주세요.");
            if(!target.canUpdate || target.status!=="draft")throw new Error("공유 중이거나 휴지통에 있는 문서는 여기서 갱신할 수 없습니다. 문서 편집에서 변경해 주세요.");
            const current=demo?getDemoKnowledgeDocuments().find(row=>row.id===target.id):(await getDocument(token,target.id)).document;
            if(!current || current.current_version!==target.current_version || current.status!=="draft")throw new Error("기존 문서가 변경되었습니다. 파일을 다시 선택해 최신 버전을 확인해 주세요.");
            document=demo?{...current,title:item.title,content_md:item.content,current_version:current.current_version+1,updated_at:new Date().toISOString()}:(await updateDocument(token,{id:target.id,expectedVersion:target.current_version,title:item.title,content:item.content,reason:"Markdown 가져오기에서 갱신"})).document;
          } else {
            const now=new Date().toISOString();
            document=demo?{...metadata,id:crypto.randomUUID(),title:item.title,content_md:item.content,status:"draft",source:"markdown",source_ref:item.sourceRef,owner_id:ownerId,created_by:ownerId,current_version:1,created_at:now,updated_at:now}:(await createDocument(token,{...metadata,title:item.title,content:item.content,source:"markdown",sourceRef:item.sourceRef})).document;
          }
          return document;
      }, (item, result) => {
        if ("value" in result) {onSaved(result.value);patch(item.id,{done:true,error:""});}
        else patch(item.id,{error:result.error});
      });
      setProcessed(true);
    }catch{setError("폴더·팀·브랜드·태그 입력값을 확인해 주세요. 태그는 30개, 각 60자까지 가능합니다.");}
    finally{setWorking(false);}
  };
  const ready=items.filter(item=>!item.done&&item.action!=="skip").length;
  return <KnowledgeModal title="Markdown 가져오기" onClose={close} busy={busy}><form className="form-modal import-modal" onSubmit={submit}><header><h2>Markdown 가져오기</h2><button type="button" disabled={busy} onClick={close} aria-label="가져오기 닫기">×</button></header><div className="import-body">
    {error?<p role="alert" className="inline-alert danger">{error}</p>:null}
    {confirmClose?<div className="inline-alert"><p>처리하지 않은 파일 선택을 버리고 닫을까요?</p><button type="button" onClick={()=>{cancelLeave();setConfirmClose(false);}}>계속 가져오기</button><button type="button" onClick={()=>confirmLeave(onClose)}>선택 버리고 닫기</button></div>:null}
    <p>원본 경로·제목으로 서버의 기존 문서를 확인하고, 본문까지 같을 때만 건너뛰기를 제안합니다. 같은 이름이어도 내용이 다르면 새 문서로 가져올 수 있습니다.</p>
    <div className="p2-toolbar"><label>Markdown 파일 선택<input type="file" accept=".md,text/markdown" multiple disabled={busy} onChange={event=>void selectFiles(event.target.files)}/></label><label>폴더 선택 (하위 경로 보존)<input type="file" multiple {...{webkitdirectory:""}} disabled={busy} onChange={event=>void selectFiles(event.target.files)}/></label></div>
    <p aria-live="polite">{busy?"확인·저장 중…":`${items.length}개 선택 · 완료 ${items.filter(item=>item.done).length} · 건너뛰기 ${items.filter(item=>item.action==="skip").length} · 남은 파일 ${ready}`}</p>
    <div className="p2-import-list">{items.map(item=><section key={item.id}><strong>{item.title}</strong><small>{item.path}</small><details><summary>가져올 내용 미리보기</summary><pre className="p2-import-preview">{item.content.slice(0,4000)}{item.content.length > 4000 ? "\n… (미리보기는 4,000자까지 표시합니다.)" : ""}</pre></details>{item.done?<span>저장 완료</span>:<><select aria-label={`${item.path} 처리 방법`} disabled={busy} value={item.action} onChange={event=>patch(item.id,{action:event.target.value as Item["action"]})}><option value="skip">건너뛰기</option><option value="create">새 문서로 가져오기</option>{item.candidates.some(row=>row.canUpdate)?<option value="update">기존 초안 갱신</option>:null}</select>{item.candidates.length?<small>기존 후보: {item.candidates.map(row=>`${row.folder}/${row.title} v${row.current_version}${row.sameContent?" (내용 같음)":" (내용 다름)"}`).join(" · ")}</small>:<small>경로·제목이 일치하는 기존 문서 없음</small>}{item.action==="update"?<><select aria-label={`${item.path} 갱신 대상`} disabled={busy} value={item.target} onChange={event=>patch(item.id,{target:event.target.value})}><option value="">갱신 대상 선택</option>{item.candidates.filter(row=>row.canUpdate).map(row=><option key={row.id} value={row.id}>{row.folder}/{row.title} v{row.current_version}</option>)}</select><small>제목·본문을 새 버전으로 갱신합니다. 기존 폴더와 분류는 유지합니다.</small></>:null}</>}{item.error?<p role="alert" className="inline-alert danger">{item.error}</p>:null}</section>)}</div>
    <div className="form-fields import-meta"><KnowledgeFolderPicker options={options} value={folder} onChange={setFolder} disabled={busy}/><label>담당 팀<input name="team" maxLength={120} defaultValue={team} disabled={busy}/></label><label>브랜드<input name="brand" maxLength={120} disabled={busy}/></label><label>공통 태그<input name="tags" disabled={busy}/></label></div><p>새 문서는 개인 초안으로 저장됩니다. 이미 완료된 파일은 다시 처리하지 않습니다.</p>
  </div><footer><button type="button" className="secondary-button" disabled={busy} onClick={close}>닫기</button><button className="primary-button" disabled={busy||!ready}>{busy?"처리 중…":processed?`남은 ${ready}개 재시도`:`${ready}개 가져오기`}</button></footer></form></KnowledgeModal>;
}

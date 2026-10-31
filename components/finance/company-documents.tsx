"use client";

import { FileText, FolderClosed, LockKeyhole, Plus, Upload, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createRecord, getCompanyFileUrl, listRecords, uploadCompanyFile } from "@/lib/api-client";
import { COMPANY_FILE_TYPES, companyFileKey, companyFileViewable, subfoldersAt } from "@/lib/company-files";
import type { OsRecord } from "@/lib/record-types";
import { PageTitle } from "../page-title";

// 재무관리 › 서류함 (요청 4954c050, 대표 결정 2026-10-31): the retired 경영지원 screen's company documents, back in the finance menu,
// with whole folders (e.g. TIPS R&D) uploaded as they are and browsed by their own sub-folders.
type Category = "사업자" | "프로젝트" | "기타";
const CATEGORIES: Array<{ id: Category; description: string; sensitive: boolean }> = [
  { id: "사업자", description: "사업자등록증 같은 민감 서류", sensitive: true },
  { id: "프로젝트", description: "프로젝트별 계약·증빙·자료 폴더", sensitive: false },
  { id: "기타", description: "공통 운영 서류", sensitive: false },
];
const meta = (record: OsRecord, key: string) => (record.metadata as Record<string, unknown> | null)?.[key];
const text = (record: OsRecord, key: string) => String(meta(record, key) || "");
const categoryOf = (record: OsRecord) => text(record, "category") || "기타";
const folderOf = (record: OsRecord) => text(record, "folderPath");
const dirOf = (file: File) => file.webkitRelativePath.split("/").slice(0, -1).join("/");
type FolderUpload = { total: number; done: number; skipped: number; failed: string[]; running: boolean };

export function CompanyDocuments({ token, demo }: { token: string | null; demo: boolean }) {
  const [documents, setDocuments] = useState<OsRecord[]>([]);
  const [category, setCategory] = useState<"all" | Category>("all");
  const [folderPath, setFolderPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<FolderUpload | null>(null);
  const [error, setError] = useState("");
  // live: false once a newer load started (session switches), so an older answer cannot overwrite it.
  const load = useCallback(async (live: () => boolean = () => true) => {
    if (demo) return;
    try { const { records } = await listRecords(token, "company_document", "limit=1000"); if (live()) { setDocuments(records); setError(""); } }
    catch (reason) { if (live()) setError(reason instanceof Error ? reason.message : "서류를 불러오지 못했어요."); }
  }, [token, demo]);
  useEffect(() => { let live = true; void load(() => live); return () => { live = false; }; }, [load]);
  const uploading = Boolean(upload?.running);
  useEffect(() => {
    if (!uploading) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [uploading]);

  const save = (file: File, target: Category, fields: { title?: string; description?: string; dueDate?: string | null; folderPath?: string }) =>
    uploadCompanyFile(token, file).then(uploaded => createRecord(token, {
      recordType: "company_document", title: fields.title || file.name, description: fields.description ?? "", status: "active",
      dueDate: fields.dueDate || null, tags: [target],
      metadata: { category: target, sensitive: target === "사업자", filePath: uploaded.path, fileName: uploaded.name, fileSize: uploaded.size, folderPath: fields.folderPath ?? "" },
    }));
  const uploadFolder = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter(file => !file.name.startsWith("."));
    if (!files.length) return;
    const target = category === "all" ? "프로젝트" : category;
    const have = new Set(documents.map(item => companyFileKey(folderOf(item), text(item, "fileName"), meta(item, "fileSize"))));
    const queue = files.filter(file => !have.has(companyFileKey(dirOf(file), file.name, file.size)));
    const state: FolderUpload = { total: files.length, done: files.length - queue.length, skipped: files.length - queue.length, failed: [], running: true };
    setUpload({ ...state }); setError("");
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try { await save(file, target, { folderPath: dirOf(file) }); }
        catch (reason) { state.failed.push(`${dirOf(file)}/${file.name} — ${reason instanceof Error ? reason.message : "올리지 못했어요"}`); }
        state.done++; setUpload({ ...state });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setUpload({ ...state, running: false }); setFolderPath("");
    await load();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), value = (name: string) => String(form.get(name) || "").trim(), file = form.get("file");
    if (!(file instanceof File) || !file.size) { setError("파일을 골라 주세요."); return; }
    setBusy(true);
    try { await save(file, value("category") as Category, { title: value("title"), description: value("description"), dueDate: value("expiresOn") }); setAdding(false); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); }
    finally { setBusy(false); }
  };
  const open = async (record: OsRecord) => {
    try {
      const path = text(record, "filePath");
      const { url } = await getCompanyFileUrl(token, path, companyFileViewable(path) ? undefined : text(record, "fileName") || undefined);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "파일을 열지 못했어요."); }
  };

  const visible = documents.filter(item => category === "all" || categoryOf(item) === category);
  const inside = folderPath ? `${folderPath}/` : "";
  const subfolders = subfoldersAt(visible.map(folderOf), folderPath);
  const here = visible.filter(item => folderOf(item) === folderPath);
  const pick = (next: "all" | Category) => { setCategory(next); setFolderPath(""); };
  return (
    <>
      <header className="page-header">
        <div className="page-title-group"><PageTitle /><p>사업자·프로젝트·기타 서류를 비공개 저장소에 보관해요. 재무 권한이 있는 사람만 봐요.</p></div>
        <div className="page-actions">
          <label className={`secondary-button${uploading || demo ? " disabled" : ""}`} aria-disabled={uploading || demo}>
            <Upload size={15} />폴더 올리기
            <input type="file" multiple hidden disabled={uploading || demo} {...{ webkitdirectory: "" }} onChange={event => { const input = event.target; void uploadFolder(input.files).finally(() => { input.value = ""; }); }} />
          </label>
          <button className="primary-button" disabled={demo} onClick={() => setAdding(true)}><Plus size={15} />서류 추가</button>
        </div>
      </header>
      {error ? <p className="inline-alert" role="alert">{error}</p> : null}
      <section className="panel company-documents">
      <div className="document-folder-toolbar">
        <button className={category === "all" ? "active" : ""} onClick={() => pick("all")}>전체 서류 <b>{documents.length}</b></button>
      </div>
      <div className="document-folders">
        {CATEGORIES.map(item => (
          <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => pick(item.id)}>
            <span className="document-folder-icon">{item.sensitive ? <LockKeyhole size={17} /> : <FolderClosed size={17} />}</span>
            <span><strong>{item.id}</strong><small>{item.description}</small></span>
            <em>{documents.filter(document => categoryOf(document) === item.id).length}</em>
          </button>
        ))}
      </div>
      {upload ? (
        <p className="document-upload-status" role="status">
          {upload.running ? "폴더 올리는 중" : "폴더 올리기 끝"} {upload.done}/{upload.total}
          {upload.skipped ? ` · 이미 있어서 건너뜀 ${upload.skipped}` : ""}
          {upload.failed.length ? ` · 못 올림 ${upload.failed.length}` : ""}
          {upload.running ? " · 다 올릴 때까지 이 화면을 닫지 마세요" : upload.failed.length ? " · 같은 폴더를 다시 고르면 빠진 것만 올려요" : ""}
        </p>
      ) : null}
      {upload && !upload.running && upload.failed.length ? (
        <details className="document-upload-status"><summary>못 올린 파일 {upload.failed.length}개</summary><ul>{upload.failed.map(line => <li key={line}>{line}</li>)}</ul></details>
      ) : null}
      {folderPath ? (
        <nav className="document-path" aria-label="폴더 위치">
          <button type="button" onClick={() => setFolderPath("")}>처음</button>
          {folderPath.split("/").map((name, index, parts) => <button type="button" key={parts.slice(0, index + 1).join("/")} onClick={() => setFolderPath(parts.slice(0, index + 1).join("/"))}>{name}</button>)}
        </nav>
      ) : null}
      <div className="document-vault">
        {subfolders.map(name => (
          <button key={`folder:${name}`} onClick={() => setFolderPath(`${inside}${name}`)}>
            <FolderClosed size={18} />
            <span><strong>{name}</strong><small>폴더</small></span>
            <em>{visible.filter(document => `${folderOf(document)}/`.startsWith(`${inside}${name}/`)).length}개</em>
          </button>
        ))}
        {here.map(item => (
          <button key={item.id} onClick={() => void open(item)}>
            <FileText size={18} />
            <span><strong>{item.title}</strong><small>{categoryOf(item)} · {text(item, "fileName")}</small></span>
            <em>{item.due_date ? `만료 ${item.due_date}` : "만료 없음"}</em>
          </button>
        ))}
        {!here.length && !subfolders.length ? (
          <div className="quiet-state"><FileText /><strong>{demo ? "연습용 화면에는 서류가 없어요" : category === "all" ? "등록된 서류 없음" : `${category} 폴더에 등록된 서류 없음`}</strong></div>
        ) : null}
      </div>
      {adding ? (
        <div className="drawer-backdrop" onMouseDown={() => !busy && setAdding(false)}>
          <form className="record-drawer" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
            <div className="drawer-head">
              <div><span className="eyebrow">재무관리</span><h2>서류 등록</h2></div>
              <button type="button" className="icon-button" aria-label="닫기" onClick={() => setAdding(false)}><X size={18} /></button>
            </div>
            <label><span>이름</span><input name="title" placeholder="비우면 파일 이름" /></label>
            <label><span>분류</span><select name="category" defaultValue={category === "all" ? "기타" : category}>{CATEGORIES.map(item => <option key={item.id}>{item.id}</option>)}</select></label>
            <label><span>파일</span><input type="file" name="file" accept={Object.keys(COMPANY_FILE_TYPES).map(extension => `.${extension}`).join(",")} required /></label>
            <label><span>만료일</span><input type="date" name="expiresOn" /></label>
            <label><span>메모</span><textarea name="description" rows={4} /></label>
            <div className="drawer-actions">
              <button type="button" className="secondary-button" onClick={() => setAdding(false)}>취소</button>
              <button className="primary-button" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
            </div>
          </form>
        </div>
      ) : null}
      </section>
    </>
  );
}

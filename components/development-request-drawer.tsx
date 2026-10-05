"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, Loader2, X } from "lucide-react";
import type { OsRecord } from "@/lib/record-types";
import { createDevelopmentAttachmentUpload, deleteDevelopmentAttachment, developmentAttachmentMimeType, listAllRecordsOfType, uploadDevelopmentAttachment } from "@/lib/api-client";
import { useSession } from "./session-provider";

export function resolveRequestProject(projects: Array<Pick<OsRecord, "id" | "title" | "metadata">>, requested = "") {
  return projects.find(project => project.id === requested)?.id
    ?? projects.find(project => String(project.metadata.repository ?? "").replace(/^https:\/\/github.com\//, "").replace(/\.git$/, "").replace(/\/$/, "") === "brandyaction-ricky/OS")?.id
    ?? "";
}
export function DevelopmentRequestDrawer({ open, onClose, initialPageUrl = "", initialProjectId = "", onCreated }: {
  open: boolean; onClose: () => void; initialPageUrl?: string; initialProjectId?: string; onCreated?: (record: OsRecord) => void;
}) {
  const { accessToken, demo, profile } = useSession();
  const [projects, setProjects] = useState<Array<Pick<OsRecord, "id" | "title" | "metadata">>>([]);
  const [projectId, setProjectId] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [saved, setSaved] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const sessionRef = useRef(profile?.id); sessionRef.current = profile?.id;
  const tokenRef = useRef(accessToken); tokenRef.current = accessToken;
  useEffect(() => {
    if (!open) return;
    let active = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(""); setFile(null); setSaved(false); setDirty(false); setDiscard(false); setLoaded(false);
    setPageUrl(initialPageUrl || window.location.href);
    const load = async () => {
      try {
        const rows = demo ? [{ id:"demo-os",title:"브랜디액션 OS",metadata:{repository:"brandyaction-ricky/OS"} }] : await listAllRecordsOfType(tokenRef.current, "project");
        if (!active) return;
        setProjects(rows); setProjectId(resolveRequestProject(rows, initialProjectId)); setLoaded(true);
      } catch { if (active) { setLoaded(true); setError("프로젝트를 불러오지 못했습니다. 잠시 후 다시 열어 주세요."); } }
    };
    void load();
    panelRef.current?.focus();
    const bodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { active = false; document.body.style.overflow = bodyOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open, profile?.id, demo, initialPageUrl, initialProjectId]);
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setPreview(""); return; }
    const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [file]);
  const close = () => { if (busyRef.current || capturing) return; if (dirty && !saved) setDiscard(true); else onClose(); };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,[href]') ?? []).filter(item => item.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  });
  const attach = (next: File | null) => {
    if (!next) return;
    try { if (!next.size || next.size > 25 * 1024 * 1024) throw new Error("첨부는 0보다 크고 25MB 이하인 파일이어야 합니다."); developmentAttachmentMimeType(next); setFile(next); setDirty(true); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "파일을 확인해 주세요."); }
  };
  const capture = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { setError("이 브라우저는 화면 캡처를 지원하지 않습니다. 캡처 파일을 첨부해 주세요."); return; }
    let stream: MediaStream | null = null; setCapturing(true); setError("");
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video"); video.srcObject = stream; await video.play();
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      if (!canvas.width || !canvas.height) throw new Error("화면을 읽지 못했습니다. 캡처 파일을 직접 첨부해 주세요.");
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (blob) attach(new File([blob], "화면-캡처.png", { type: "image/png" }));
      video.pause(); video.srcObject = null;
    } catch { setError("화면 캡처를 완료하지 못했습니다. 다시 시도하거나 파일을 첨부해 주세요."); }
    finally { stream?.getTracks().forEach(track => track.stop()); setCapturing(false); }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busyRef.current || !projectId) return;
    busyRef.current = true; setBusy(true); setError("");
    const token = accessToken; const owner = profile?.id; const form = new FormData(event.currentTarget); let uploaded = "";
    try {
      let attachment = { attachmentPath:"", attachmentName:"", attachmentSize:"", attachmentType:"" };
      if (file && !demo) {
        const signed = await createDevelopmentAttachmentUpload(token, file); uploaded = signed.path;
        await uploadDevelopmentAttachment(signed.path, signed.token, file, signed.uploadType);
        attachment = { attachmentPath:signed.path, attachmentName:signed.name, attachmentSize:String(signed.size), attachmentType:signed.type };
      }
      if (sessionRef.current !== owner) throw new Error("로그인이 바뀌었습니다. 새 계정으로 다시 작성해 주세요.");
      const body = { title:String(form.get("title") || "").trim(), description:String(form.get("description") || "").trim(), category:String(form.get("category")), priority:String(form.get("priority")), expectedResult:String(form.get("expectedResult") || "").trim(), parentId:projectId, pageUrl, ...attachment };
      if (!demo) {
        const response = await fetch("/api/v1/development-requests", { method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || "요청을 저장하지 못했습니다.");
        uploaded = ""; onCreated?.(result.record); window.dispatchEvent(new Event("brandy-development-requests-changed"));
      }
      setSaved(true); setDirty(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "요청을 저장하지 못했습니다."); if (uploaded) await deleteDevelopmentAttachment(token, uploaded).catch(() => undefined); }
    finally { busyRef.current = false; setBusy(false); }
  };
  if (!open) return null;
  return <div className="drawer-backdrop request-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={panelRef} className="record-drawer request-drawer" role="dialog" aria-modal="true" aria-label="수정 요청" tabIndex={-1}>
      <header className="drawer-head"><div><h2>수정 요청</h2><p>지금 보고 있는 화면에서 불편한 점을 남겨 주세요.</p></div><button className="icon-button" aria-label="수정 요청 닫기" disabled={busy || capturing} onClick={close}><X size={18} /></button></header>
      {error && <p className="inline-alert danger" role="alert">{error}</p>}
      {saved ? <div role="status"><h3>{demo ? "데모 입력을 확인했습니다" : "수정 요청을 접수했습니다"}</h3><p>{demo ? "데모에서는 실제 요청을 저장하지 않습니다." : "요청한 일에서 처리 상황을 확인할 수 있습니다."}</p><button className="primary-button" onClick={onClose}>닫기</button></div> : <form onSubmit={submit} onChange={() => setDirty(true)}>
        <label>프로젝트<select required value={projectId} onChange={event => setProjectId(event.target.value)} disabled={busy || !loaded}><option value="">{loaded ? "프로젝트 선택" : "프로젝트 불러오는 중…"}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
        <label>화면 주소<input name="pageUrl" value={pageUrl} onChange={event => setPageUrl(event.target.value)} required type="url" maxLength={2000} /></label>
        <label>제목<input name="title" required maxLength={240} placeholder="어떤 점이 불편한가요?" /></label>
        <div className="form-grid"><label>요청 종류<select name="category"><option value="bug">오류 신고</option><option value="usability">사용성 개선</option><option value="feature">기능 제안</option><option value="question">사용 문의</option></select></label><label>업무 영향<select name="priority"><option value="normal">보통</option><option value="high">업무 지연</option><option value="urgent">업무 불가</option><option value="low">낮음</option></select></label></div>
        <label>현재 문제<textarea name="description" required maxLength={10000} rows={4} /></label><label>기대하는 결과<textarea name="expectedResult" maxLength={8000} rows={2} /></label>
        <div className="request-evidence"><button type="button" className="secondary-button" disabled={capturing || busy} onClick={() => void capture()}><Camera size={15} /> {capturing ? "화면 확인 중…" : "화면 캡처"}</button><label>자료 첨부<input type="file" disabled={busy} onChange={event => attach(event.target.files?.[0] ?? null)} /></label><small>캡처할 화면을 선택한 뒤 아래 미리보기를 확인하세요. 등록을 눌러야 첨부가 전송됩니다.</small>{file && <p>{file.name} · {Math.ceil(file.size / 1024)}KB <button type="button" onClick={() => setFile(null)}>첨부 해제</button></p>}{preview && <Image src={preview} alt="첨부할 화면 캡처 미리보기" width={560} height={360} unoptimized />}</div>
        <footer className="drawer-actions"><button className="secondary-button" type="button" disabled={busy} onClick={close}>취소</button><button className="primary-button" disabled={busy || capturing || !loaded || !projectId}>{busy ? <><Loader2 size={15} /> 저장 중…</> : "수정 요청 등록"}</button></footer>
      </form>}
      {discard && <section className="inline-alert request-discard" role="alert"><p>작성 중인 내용을 닫을까요?</p><button type="button" onClick={() => setDiscard(false)}>계속 작성</button><button type="button" onClick={() => { setDirty(false); onClose(); }}>내용 버리고 닫기</button></section>}
    </section>
  </div>;
}

"use client";
import { useEffect,useRef } from "react";
import type { ImageTrashProject } from "@/lib/image-creative/project-trash";

export function ImageProjectTrash({projects,busy,restore,close}:{projects:ImageTrashProject[];busy:boolean;restore:(project:ImageTrashProject)=>void;close:()=>void}) {
  return <section className="panel panel-pad-lg ic-panel" aria-label="이미지 광고 휴지통">
    <div className="ic-row"><h2>휴지통</h2><button className="secondary-button" disabled={busy} onClick={close}>작업으로 돌아가기</button></div>
    <p className="ic-muted">시안·원본 이미지·승인 기록을 보관합니다. 복구하면 이어서 확인할 수 있습니다. 중단한 AI·출력 작업은 자동으로 다시 시작하지 않습니다.</p>
    {projects.length ? <ul className="ic-experiment-list">{projects.map(project=><li key={project.id}><div className="ic-row">
      <strong>{project.title}</strong>{project.archivedAt && <time dateTime={project.archivedAt}>{new Date(project.archivedAt).toLocaleDateString("ko-KR")}</time>}
      <button className="secondary-button" disabled={busy} onClick={()=>restore(project)} aria-label={`${project.title} 복구`}>복구</button>
    </div></li>)}</ul> : <p>휴지통이 비어 있어요.</p>}
  </section>;
}
export function ImageProjectTrashConfirm({project,busy,confirm,cancel}:{project:ImageTrashProject;busy:boolean;confirm:()=>void;cancel:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();},[]);
  return <dialog ref={dialog} className="panel panel-pad-lg" aria-labelledby="image-trash-title" onCancel={event=>{event.preventDefault();if(!busy)cancel();}}>
    <h2 id="image-trash-title">프로젝트를 휴지통으로 옮길까요?</h2>
    <p><strong>{project.title}</strong></p>
    <p>시안·원본 이미지·승인 기록은 보관되며, 휴지통에서 복구할 수 있습니다.</p>
    <p>대기 작업을 취소하고 늦게 도착한 결과는 반영하지 않습니다. 이미 시작한 AI 호출은 즉시 멈추지 않을 수 있습니다.</p>
    <div className="ic-row"><button className="secondary-button" disabled={busy} onClick={cancel}>취소</button>
      <button className="primary-button" disabled={busy} onClick={confirm}>휴지통으로 이동</button></div>
  </dialog>;
}

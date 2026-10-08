"use client";
import {useState} from "react";
import type {DocumentVersion,KnowledgeDocument} from "@/lib/types";
import {apiRequest} from "@/lib/api-client";
import {documentMarkdown,safeExportName} from "@/lib/knowledge/export";
import {Modal} from "./ui";
import {useKnowledge} from "./provider";

export function DocumentExport({document:doc,close}:{document:KnowledgeDocument;close:()=>void}){
  const {state,demo,token,command,notify}=useKnowledge();
  const [format,setFormat]=useState("md"),[range,setRange]=useState("doc"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function download(){
    // Open synchronously from the user's click, before async audit/network work.
    const printWindow=format==="pdf"?window.open("","_blank","width=900,height=900"):null;
    if(format==="pdf"&&!printWindow){setError("인쇄 창을 열지 못했습니다. 팝업을 허용한 뒤 다시 시도해 주세요.");return;}
    if(printWindow){printWindow.opener=null;printWindow.document.title="문서 인쇄 준비";printWindow.document.body.textContent="내보내기를 준비하고 있습니다…";}
    setBusy(true);setError("");
    try{
      const versions:DocumentVersion[]=[];
      if(range==="doc_versions"){
        if(demo)versions.push(...(state.versions[doc.id]??[]));
        else for(let offset=0;;offset+=100){const page=await apiRequest<{versions:DocumentVersion[];hasMore:boolean}>(`/api/v1/documents/${doc.id}/versions?limit=100&offset=${offset}`,{token});versions.push(...page.versions);if(!page.hasMore)break;}
      }
      await command({action:"document.export",id:doc.id,format,range});
      const markdown=documentMarkdown(doc,versions);
      if(printWindow){
        const output=printWindow.document;
        output.title=doc.title;output.body.replaceChildren();
        const style=output.createElement("style");style.textContent="@page{size:A4;margin:18mm}body{font:13px/1.75 system-ui,sans-serif;color:#111;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}button{padding:8px 16px} @media print{button{display:none}}";
        const button=output.createElement("button");button.textContent="인쇄 · PDF로 저장";button.onclick=()=>printWindow.print();
        const pre=output.createElement("pre");pre.textContent=markdown;
        output.head.append(style);output.body.append(button,pre);printWindow.focus();
        notify("인쇄용 문서를 열었습니다. ‘인쇄 · PDF로 저장’을 선택하세요. 내보내기 요청은 활동 기록에 남았습니다.");
      }else{
        const url=URL.createObjectURL(new Blob([markdown],{type:"text/markdown;charset=utf-8"}));
        const link=window.document.createElement("a");link.href=url;link.download=safeExportName(doc.title);link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        notify("Markdown 파일을 만들었습니다. 활동 기록에 남겼습니다.");
      }
      close();
    }catch(e){printWindow?.close();setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Modal title="문서 내보내기" onClose={close} busy={busy}><div className="kw-modal-body"><label>형식<select value={format} onChange={e=>setFormat(e.target.value)}><option value="md">Markdown</option><option value="pdf">PDF로 저장 (인쇄)</option></select></label><label>범위<select value={range} onChange={e=>setRange(e.target.value)}><option value="doc">이 문서</option><option value="doc_versions">이 문서 + 버전 기록</option></select></label><p>내보내기 요청은 활동 기록에 남습니다. 폴더·기간 묶음은 지원하지 않습니다.</p>{format==="pdf"&&<p>인쇄용 문서를 연 뒤 브라우저의 PDF 저장을 사용합니다. 인쇄 취소 여부는 저장 완료로 기록하지 않습니다.</p>}{error&&<p role="alert" className="kw-error">{error}</p>}<footer><button disabled={busy} onClick={close}>취소</button><button className="kw-primary" disabled={busy} onClick={()=>void download()}>내보내기</button></footer></div></Modal>;
}

"use client";

import {useRef, useState} from "react";
import type {CreativeVariant} from "@/lib/image-creative/model";
import {isWarehouseFormat} from "@/lib/image-creative/formats";
import {LegacySavedPng} from "./legacy-saved-png";
import {WarehouseVariantPreview} from "./warehouse-variant-preview";
import {CostTag, useCostModels} from "./cost-notice";
import {imageEstimate} from "@/lib/cost";

export type ImageEditProposal = NonNullable<CreativeVariant["promptEdit"]> & {baseId:string;url:string;sizeNote?:string};
export type ImagePromptEditorProps = {
  projectId:string;base:CreativeVariant;assetUrl?:string;referenceUrl?:string;detailUrl?:string;promptEditUrl?:string;referenceArtworkUrl?:string;
  demo:boolean;examplePrompt?:string;
  propose:(baseId:string,prompt:string,png:Blob)=>Promise<ImageEditProposal>;
  apply:(id:string,proposal:ImageEditProposal)=>Promise<void>;close:()=>void;onBusy?:(busy:boolean)=>void;
};

export function ImagePromptEditor({projectId,base,assetUrl,referenceUrl,detailUrl,promptEditUrl,referenceArtworkUrl,demo,examplePrompt,propose,apply,close,onBusy}:ImagePromptEditorProps) {
  const [prompt,setPrompt]=useState("");
  const [proposal,setProposal]=useState<ImageEditProposal>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [ready,setReady]=useState(false);
  const [sourceReady,setSourceReady]=useState(false);
  const source=useRef<Blob|null>(null);
  const revisionId=useRef("");
  async function request() {
    if(busy || !source.current || !prompt.trim()) return;
    setBusy(true);onBusy?.(true);setError("");setProposal(undefined);setReady(false);revisionId.current="";
    try {setProposal(await propose(base.id,prompt.trim(),source.current));}
    catch(cause){setError(cause instanceof Error ? cause.message : "수정본을 만들지 못했어요.");}
    finally{setBusy(false);onBusy?.(false);}
  }
  async function save() {
    if(busy || !proposal || !ready || proposal.prompt!==prompt.trim()) return;
    setBusy(true);onBusy?.(true);setError("");
    try {revisionId.current ||= crypto.randomUUID();await apply(revisionId.current,proposal);}
    catch(cause){setError(cause instanceof Error ? cause.message : "수정본을 저장하지 못했어요.");}
    finally{setBusy(false);onBusy?.(false);}
  }
  const cost=imageEstimate(useCostModels().image,"high",1);
  return <div className="ic-prompt-editor">
    <h3>말로 수정하기</h3>
    <p>카피, 숫자, 이미지 속 문구까지 바꿀 내용을 적어 주세요. 이 시안 한 장만 수정합니다.</p>
    {demo && <p className="ic-muted">지금은 회사 AI에 연결하지 않은 개발 미리보기입니다. 준비된 원본·수정 요청 예시가 일치할 때만 실제 AI로 만든 수정 예시를 보여줍니다.</p>}
    <label className="ic-field">수정 요청<textarea aria-label="수정 요청" className="field" rows={4} maxLength={2000} value={prompt} disabled={busy}
      placeholder='예: 제목을 "나에게 맞는 선택은?"으로 바꾸고, 오른쪽 아래 작은 설명은 지워줘.'
      onChange={e=>{setPrompt(e.target.value);setError("");}}/></label>
    <div className="ic-row">
      {demo && examplePrompt && <button className="secondary-button" type="button" disabled={busy} onClick={()=>setPrompt(examplePrompt)}>예시 문구 넣기</button>}
      <button type="button" className="primary-button" disabled={busy || !sourceReady || !prompt.trim()} onClick={()=>void request()}>{busy ? "수정본 준비 중…" : demo ? "수정 예시 확인" : "AI로 수정본 만들기"}</button>
      {!demo && <CostTag kind="paid" amount={cost}/>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="ic-prompt-comparison">
      <figure><figcaption>수정 전</figcaption>
        {isWarehouseFormat(base.formatId) && !base.promptEdit && !base.referenceArtwork
          ? <WarehouseVariantPreview variant={base} assetUrl={assetUrl} onReady={blob=>{source.current=blob;setSourceReady(!!blob);}}/>
          : <LegacySavedPng projectId={projectId} variant={base} assetUrl={assetUrl} referenceUrl={referenceUrl} detailUrl={detailUrl} promptEditUrl={promptEditUrl} referenceArtworkUrl={referenceArtworkUrl} onReady={blob=>{source.current=blob;setSourceReady(!!blob);}}/>}
      </figure>
      <figure><figcaption>수정 후</figcaption>
        {proposal ? <>
          {/* eslint-disable-next-line @next/next/no-img-element -- new candidate; original is kept until explicit apply */}
          <img src={proposal.url} alt="AI 수정 후보" onLoad={()=>setReady(true)} onError={()=>{setReady(false);setError("수정 이미지가 열리지 않아요. 원본은 보존되어 있습니다.");}}/>
          <p>{proposal.prompt}</p>{proposal.sizeNote && <p role="status">{proposal.sizeNote}</p>}
        </> : <p className="ic-muted">수정 요청을 보내면 이곳에서 비교할 수 있어요.</p>}
      </figure>
    </div>
    {proposal && <p className="ic-muted">문구와 숫자, 요청하지 않은 부분도 확인해 주세요. 적용하면 원본을 남기고 별도 수정본으로 저장합니다.</p>}
    {proposal && proposal.prompt!==prompt.trim() && <p role="status">요청을 바꿨어요. 새 수정본을 만든 뒤 적용해 주세요.</p>}
    <div className="ic-row">
      {proposal && <button type="button" className="primary-button" disabled={busy || !ready || proposal.prompt!==prompt.trim()} onClick={()=>void save()}>수정본 적용</button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={close}>닫기 · 원본 유지</button>
    </div>
  </div>;
}

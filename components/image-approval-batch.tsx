"use client";

import { ImageFormatSample } from "./image-format-choice";
import { useState } from "react";
import { CREATIVE_SIZES, IMAGE_FORMATS, isWarehouseFormat, usesBackgroundPhoto, type ImageFormatId } from "@/lib/image-creative/formats";
import type { CreativeVariant, ImageBatch } from "@/lib/image-creative/model";
import { designSummary, LegacyPreview, SafeZoneOverlay } from "./image-design-editor";
import { WarehouseVariantPreview } from "./warehouse-variant-preview";
import { LegacySavedPng } from "./legacy-saved-png";
import { MacReviewPreview } from "./mac-review-preview";

export type RenderTarget = "render-pc" | "local";
export const targetNames = { "render-pc": "공용 맥미니", local: "내 Mac" } as const;
export type MachineRender = { id: string; target: RenderTarget; status: "queued" | "active" | "done" | "failed"; variantIds: string[]; reason?: string };
const renderLabels = { queued: "출력 대기", active: "출력 중", done: "PNG 출력 완료", failed: "출력 실패" } as const;
export type ReferenceGenerationRun = { id:string; variantId:string; inputHash:string; status:"active"|"done"|"failed"; expiresAt:number; failure?:string };
export type ReviewStep = "format" | "copy" | "preview" | "final";
type ReturnStep = Exclude<ReviewStep, "format">;

export function FormatBoard({ id, size, referenceUrl }: {id: ImageFormatId; size: CreativeVariant["size"]; referenceUrl?:string}) {
  const f = IMAGE_FORMATS[id];
  const example: CreativeVariant = {
    id: "format-guide", formatId: id, formatVersion: f.version, size,
    appeal: {id:"guide",meaning:"구성 견본"}, copy:{headline:"제목이 들어갈 자리",body:"설명이 들어갈 자리",cta:"자세히 보기"},
    ...(isWarehouseFormat(id) ? {brand:"브랜드"} : {}),
    ...(f.supportsAsset && !f.backgroundPhoto ? {asset:{path:"guide",w:1536,h:1024}} : {}), at:"", by:"guide",
  };
  return <figure className="ic-card ic-guide-card">
    {id === "reference_image" ? (referenceUrl &&
      // eslint-disable-next-line @next/next/no-img-element -- project-specific reference, no generic sample
      <img className="ic-compare-photo" alt="선택한 디자인 원본" src={referenceUrl}/>) : id === "thumbnail_subject" ? <ImageFormatSample id={id} size={size}/> : isWarehouseFormat(id) ? <WarehouseVariantPreview variant={example} assetUrl="/image-format-test/master.jpg"/>
      : <LegacyPreview variant={example} url="/image-format-test/master.jpg"/>}
    <figcaption className="ic-card-body"><strong>{f.name}</strong><p>{f.when}</p><small>{CREATIVE_SIZES[size].label} · 포맷 구성 견본</small></figcaption>
  </figure>;
}

export function WinnerArtwork({variant,url,projectId,photo,referenceUrl,detailUrl,promptEditUrl,referenceArtworkUrl,demo}:{variant:CreativeVariant;url?:string;projectId:string;photo?:string;referenceUrl?:string;detailUrl?:string;promptEditUrl?:string;referenceArtworkUrl?:string;demo:boolean}) {
  if (demo) return isWarehouseFormat(variant.formatId) && !variant.promptEdit && !variant.referenceArtwork
    ? <WarehouseVariantPreview variant={variant} assetUrl={photo}/>
    : <LegacySavedPng projectId={projectId} variant={variant} assetUrl={photo} referenceUrl={referenceUrl} detailUrl={detailUrl} promptEditUrl={promptEditUrl} referenceArtworkUrl={referenceArtworkUrl}/>;
  if (!url) return <p role="status">최종 출력본을 다시 불러와 주세요.</p>;
  // eslint-disable-next-line @next/next/no-img-element -- signed URL for the winning, reviewed PNG.
  return <img className="ic-compare-photo" src={url} alt={variant.copy.headline}/>;
}

interface Props {
  batch: ImageBatch; index: number; variants: CreativeVariant[]; assets: {path:string;url:string}[];
  projectId: string; target: RenderTarget; render?: MachineRender; demo:boolean; guided?:boolean; busy:boolean; showGuide:boolean;
  experimentRound?: boolean; winner?: ImageBatch["winner"]; control?: CreativeVariant; revisions?: CreativeVariant[]; registerWinner?:(batchId:string,variantId:string,note:string)=>void;
  selectedId: string; rendered?: Record<string,string>; reviewable?: Record<string,string>;
  review:(batchId:string,step:ReviewStep,renderId?:string)=>void;
  returnReview:(batchId:string,step:ReturnStep,reason:string)=>void;
  edit:(id:string)=>void; select:(id:string)=>void; download:(id:string,kind?:"batch"|"variant")=>void;
  keepBlob:(variantId:string,blob:Blob|null)=>void;
  attachPhoto?:(batchId:string,assetPath:string)=>void; uploadPhoto?:(file:File|null)=>void;
  generateReference?:(batchId:string)=>void; referenceRun?:ReferenceGenerationRun; generating?:boolean; refresh?:()=>void;
}
export function ImageApprovalBatch({ batch, index, variants, assets, projectId, target, render, demo, guided, busy, showGuide, selectedId,
  experimentRound, winner, control, revisions = [], registerWinner, rendered, reviewable, review, returnReview, edit, select, download, keepBlob, attachPhoto, uploadPhoto, generateReference, referenceRun, generating, refresh }:Props) {
  const alternateCandidates = [...(control ? [control] : []), ...revisions];
  const recorded = batch.winner;
  const recordedVariant = recorded && [...variants,...alternateCandidates].find(v=>v.id===recorded.variantId);
  const [resultNote,setResultNote]=useState(batch.winner?.note || "");
  const [reason,setReason]=useState("");
  const [revising,setRevising]=useState<ReturnStep>();
  const [previewReady,setPreviewReady]=useState<Record<string,boolean>>({});
  const [finalReady,setFinalReady]=useState<Record<string,boolean>>({});
  const stages=batch.review;
  const confirmed=stages?.preview;
  const done=Boolean(confirmed && render?.id === confirmed.runId && render.status === "done");
  const final=Boolean(done && stages?.final?.runId === confirmed?.runId);
  const copyReady=Boolean(stages?.copy);
  const aiReference=variants.some(v=>v.referenceLayout && (!confirmed || v.referenceLayout.reproduction==="image-ai"));
  const generationPending=aiReference && variants.some(v=>!v.referenceArtwork && !v.promptEdit);
  const generationActive=generating || (referenceRun?.status==="active" && referenceRun.expiresAt>Date.now() && variants.some(v=>v.id===referenceRun.variantId));
  const generationFailed=referenceRun?.status==="failed" && variants.some(v=>v.id===referenceRun.variantId && !v.referenceArtwork && !v.promptEdit);
  const photoSlot=variants.length>0 && variants.every(v=>v.referenceLayout?.photo);
  const photoPending=!aiReference && photoSlot && variants.some(v=>!v.asset);
  const referenceUrl=assets.find(a=>a.path===variants[0]?.referenceLayout?.source.path)?.url;
  const photoChoices=assets.filter(a=>!variants.some(v=>v.referenceLayout?.source.path===a.path || v.detailAsset?.path===a.path || v.referenceArtwork?.image.path===a.path || v.promptEdit?.image.path===a.path));
  const photoPicker=attachPhoto && <div className="ic-photo-pick" role="group" aria-label="공통 사진 고르기">
    <p>{aiReference ? "교체할 상품 사진·보고서가 있을 때만 고르세요. 모든 시안에 같은 자료를 사용합니다." : "원본 디자인의 사진 자리에 들어갈 사진이에요. 모든 시안에 같은 사진이 들어가요."}</p>
    <div className="ic-row">{photoChoices.map((a,i)=><button key={a.path} type="button" className="secondary-button" disabled={busy || generationActive}
      aria-pressed={variants.every(v=>v.asset?.path===a.path)} onClick={()=>attachPhoto(batch.id,a.path)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated project asset */}
      <img src={a.url} alt={`올린 사진 ${i+1}`} width={56} height={56}/> 이 사진 넣기</button>)}
      {uploadPhoto && <label className="secondary-button">사진 올리기<input className="ic-sr" type="file" accept="image/png,image/jpeg" disabled={busy || generationActive}
        onChange={e=>{uploadPhoto(e.target.files?.[0] ?? null);e.target.value="";}}/></label>}</div>
  </div>;
  const markPreview=(id:string,ok:boolean)=>setPreviewReady(old=>old[id]===ok ? old : {...old,[id]:ok});
  const canPreview=!generationPending && !photoPending && variants.length>0 && variants.every(v=>previewReady[v.id]);
  const canFinal=done && (demo ? canPreview : variants.every(v=>reviewable?.[v.id]===render?.id && finalReady[render!.id+v.id]));
  const current: ReturnStep = !copyReady ? "copy" : done ? "final" : "preview";
  const stageText=!stages?.format ? "포맷 승인 대기" : !copyReady ? "카피 승인 대기" : generationPending ? generationActive ? "시안 생성 중" : generationFailed ? "시안 생성 중단" : "시안 생성 전" : photoPending ? "사진 선택 대기" : !confirmed ? "미리보기 확인 대기"
    : final ? "최종 검수 완료" : done ? "최종 검수 대기" : render ? renderLabels[render.status] : "출력 대기";
  return <section className="ic-review-group" aria-label={`${index+1}번째 묶음 검토`}>
    <div className="ic-row"><h3>{index+1}번째 묶음 · {variants.length}장</h3><strong>{stageText}</strong></div>
    {!stages?.format && <div className="ic-preview-grid">{[...new Set(variants.map(v=>v.formatId))].map(id=>
      <FormatBoard key={id} id={id} size={variants.find(v=>v.formatId===id)!.size} referenceUrl={assets.find(a=>a.path===variants.find(v=>v.formatId===id)?.referenceLayout?.source.path)?.url}/>)}</div>}
    {final && experimentRound && registerWinner && <details className="ic-details"><summary>집행 결과 메모 (선택)</summary>
      <label className="ic-field">결과 메모<input className="field" maxLength={500} value={resultNote} onChange={e=>setResultNote(e.target.value)} placeholder="비교한 기간 또는 승리 판단 근거"/></label>
    </details>}
    {experimentRound && recorded && <p><strong>{winner ? "승리 소재" : "이전 출력본 승리 기록"} · {recordedVariant?.copy.headline || recorded.variantId}</strong>
      {recorded.note && <span> · {recorded.note}</span>}</p>}
    {copyReady && aiReference && <section className="ic-panel" aria-label="레퍼런스 기반 시안 제작">
      <details className="ic-details" open={generationPending}><summary>선택한 레퍼런스 원본과 비교</summary>
        <div className="ic-preview-grid">{referenceUrl && <figure>
          {/* eslint-disable-next-line @next/next/no-img-element -- entire selected reference, not a generated draft */}
          <img className="ic-compare-photo" src={referenceUrl} alt="선택한 레퍼런스 원본 전체"/><figcaption>원본 디자인</figcaption>
        </figure>}{variants.filter(v=>v.referenceArtwork || v.promptEdit).map(v=>{
          const artwork=assets.find(a=>a.path===(v.promptEdit?.image.path || v.referenceArtwork?.image.path));
          return artwork && <figure key={v.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- saved generated image for original comparison */}
            <img className="ic-compare-photo" src={artwork.url} alt={`생성 시안 비교: ${v.copy.headline}`}/><figcaption>{v.copy.headline}</figcaption>
          </figure>;
        })}</div>
        <p>배경·카드·장식·배치를 유지하고, 확정한 문구와 선택한 상품 자료를 바꿉니다.</p>
      </details>
      {!confirmed && photoPicker && <details className="ic-details"><summary>상품 자료 추가·변경 (선택)</summary>{photoPicker}</details>}
      {generationPending && <>
        {demo && <p role="status">개발 화면에서는 실제 AI 생성 결과를 불러온 경우에만 시안을 확인할 수 있어요.</p>}
        <p role="status">{generationActive ? "원본 디자인으로 시안을 만들고 있어요. 완료된 시안부터 아래에 표시합니다." : generationFailed ? "생성이 중단됐어요. 완료된 시안은 보존됩니다. 상태를 확인한 뒤 남은 시안만 다시 요청할 수 있어요." : "아직 시안을 만들지 않았어요. 상품 자료 없이도 원본의 그림과 장식을 유지해 만들 수 있어요."}</p>
        <div className="ic-row"><button type="button" className="primary-button" disabled={busy || generationActive || demo || !generateReference}
          onClick={()=>generateReference?.(batch.id)}>{generationActive ? "시안 만드는 중…" : generationFailed ? "남은 시안 다시 만들기" : "레퍼런스로 시안 만들기"}</button>
          {refresh && <button type="button" className="secondary-button" disabled={busy} onClick={refresh}>상태 새로고침</button>}
        </div>
      </>}
    </section>}
    {copyReady && photoPending && photoPicker && <section className="ic-panel" aria-label="시안에 넣을 사진"><h4>시안에 넣을 사진을 골라 주세요</h4>{photoPicker}</section>}
    {copyReady && !aiReference && photoSlot && !photoPending && !confirmed && photoPicker && <details className="ic-details"><summary>사진 바꾸기</summary>{photoPicker}</details>}
    <div className="ic-preview-grid">
      {experimentRound && alternateCandidates.map(candidate=><article key={candidate.id} className={`ic-card ${winner?.variantId===candidate.id ? "ic-selected" : ""}`}>
        <WinnerArtwork variant={candidate} projectId={projectId} url={rendered?.[candidate.id]} demo={demo} photo={assets.find(a=>a.path===candidate.asset?.path)?.url} referenceUrl={assets.find(a=>a.path===candidate.referenceLayout?.source.path)?.url} detailUrl={assets.find(a=>a.path===candidate.detailAsset?.path)?.url} promptEditUrl={assets.find(a=>a.path===candidate.promptEdit?.image.path)?.url} referenceArtworkUrl={assets.find(a=>a.path===candidate.referenceArtwork?.image.path)?.url}/>
        <div className="ic-card-body"><strong>{candidate.id===control?.id ? "기존 승리 소재" : "디자인 수정본"}</strong><h3>{candidate.copy.headline}</h3><p>{candidate.copy.body}</p><small>{candidate.copy.cta}</small>
          {final && registerWinner && <p><button type="button" className="secondary-button" disabled={busy} aria-pressed={winner?.variantId===candidate.id}
            onClick={()=>registerWinner(batch.id,candidate.id,resultNote)}>{candidate.id===control?.id ? "기존 소재 승리로 기록" : "승리 소재로 지정"}</button></p>}
        </div></article>)}
      {variants.map(v=>{
      const url=assets.find(a=>a.path===v.asset?.path)?.url;
      const onCheck=(issues:string[])=>{ if (issues.length) markPreview(v.id,false); };
      const keep=(blob:Blob|null)=>keepBlob(v.id,blob);
      const showFinal=Boolean(!demo && done && !final && reviewable?.[v.id]===render?.id);
      const readyKey=(render?.id || "")+v.id;
      const hasPreview=!photoPending && (!aiReference || !!v.referenceArtwork || !!v.promptEdit);
      return <article className={`ic-card ${(experimentRound ? v.id===winner?.variantId : v.id===selectedId)?"ic-selected":""}`} key={v.id}>
        {copyReady && hasPreview && <div className="ic-artboard" onLoadCapture={e=>{
          if (e.target instanceof HTMLImageElement && e.target.naturalWidth > 0) markPreview(v.id,true);
        }} onErrorCapture={()=>markPreview(v.id,false)}>
          {final && !demo && rendered?.[v.id] ?
            // eslint-disable-next-line @next/next/no-img-element -- Final reviewed private PNG.
            <img className="ic-compare-photo" alt={v.copy.headline} src={rendered[v.id]} />
            : showFinal ? <MacReviewPreview key={readyKey} projectId={projectId} variantId={v.id} runId={render!.id} title={v.copy.headline}
              onReady={ok=>setFinalReady(old=>old[readyKey]===ok?old:{...old,[readyKey]:ok})}/>
            : !demo && done ? <p role="status">검수용 출력본을 불러오는 중입니다.</p>
            : isWarehouseFormat(v.formatId) && !v.promptEdit && !v.referenceArtwork ? <WarehouseVariantPreview variant={v} assetUrl={url} onReady={keep} onCheck={onCheck}/>
            : <LegacySavedPng projectId={projectId} variant={v} promptEditUrl={assets.find(a=>a.path===v.promptEdit?.image.path)?.url} referenceArtworkUrl={assets.find(a=>a.path===v.referenceArtwork?.image.path)?.url} assetUrl={url} referenceUrl={assets.find(a=>a.path===v.referenceLayout?.source.path)?.url} detailUrl={assets.find(a=>a.path===v.detailAsset?.path)?.url} onReady={keep} onCheck={onCheck}/>}
          {showGuide && <SafeZoneOverlay size={v.size} design={v.design}/>}
        </div>}
        <div className="ic-card-body"><strong>{v.promptEdit ? "프롬프트 수정본" : v.referenceArtwork ? "레퍼런스 기반 AI 시안" : IMAGE_FORMATS[v.formatId].name}</strong>
          {v.promptEdit && <><p>{v.promptEdit.prompt}</p><small>기준 소구 · {v.appeal.meaning}</small></>}
          {stages?.format && !v.promptEdit && <><h3>{v.copy.headline}</h3><dl className="ic-copy-lines">
            {v.brand && <><dt>브랜드</dt><dd>{v.brand}</dd></>}<dt>소구</dt><dd>{v.appeal.meaning}</dd>
            <dt>본문</dt><dd>{v.copy.body || "본문 없음"}</dd><dt>CTA</dt><dd>{v.copy.cta}</dd></dl></>}
          {v.design && <p className="ic-muted">{designSummary(v)}</p>}
          <div className="ic-row">
            {copyReady && <button className="secondary-button" disabled={busy || generationActive || !hasPreview} onClick={()=>edit(v.id)}>수정하기</button>}
            {final && experimentRound && registerWinner && <button type="button" className="secondary-button" disabled={busy} aria-pressed={winner?.variantId===v.id}
              onClick={()=>registerWinner(batch.id,v.id,resultNote)}>승리 소재로 지정</button>}
            {final && (!experimentRound || !guided) && <button className="secondary-button" aria-pressed={v.id===selectedId} disabled={busy} onClick={()=>select(v.id)}>{v.id===selectedId?"기준으로 선택됨":"기준 시안 선택"}</button>}
            {(!guided || final) && <button className="secondary-button" disabled={busy || !final || (demo ? !previewReady[v.id] : !rendered?.[v.id])} onClick={()=>download(v.id)}>내보내기</button>}
          </div>
        </div>
      </article>;
    })}</div>
    <div className="ic-row ic-actions">
      {!stages?.format ? <button className="primary-button" disabled={busy} onClick={()=>review(batch.id,"format")}>묶음 포맷 승인</button>
        : !copyReady ? <button className="primary-button" disabled={busy} onClick={()=>review(batch.id,"copy")}>카피 승인</button>
        : !confirmed || render?.status==="failed" ? <button className="primary-button" disabled={busy || !canPreview} onClick={()=>review(batch.id,"preview")}>
          {demo ? "미리보기 확인 · 체험 출력" : `미리보기 확인 · ${targetNames[target]}에서 최종 출력`}</button>
        : done && !final ? <button className="primary-button" disabled={busy || !canFinal} onClick={()=>review(batch.id,"final",render!.id)}>최종 검수 완료</button> : null}
      {confirmed && render && <span>{demo ? "브라우저 체험 출력" : targetNames[render.target]} · {renderLabels[render.status]}{render.reason && ` · ${render.reason}`}</span>}
      {!demo && render?.status === "queued" && variants.some(usesBackgroundPhoto) &&
        <p className="ic-muted">이 배경 사진을 출력하려면 {targetNames[render.target]}에 배경 사진을 지원하는 최신 제작 엔진이 필요합니다.</p>}
      {stages?.format && !final && !revising && (!confirmed || render?.status==="done" || render?.status==="failed") &&
        <button className="secondary-button" disabled={busy} onClick={()=>setRevising(current)}>수정 요청</button>}
      {(!guided || final) && <button className="secondary-button" disabled={busy || !final || variants.some(v=>demo ? !previewReady[v.id] : !rendered?.[v.id])}
        onClick={()=>download(batch.id,"batch")}>{index+1}번째 묶음 ZIP</button>}
    </div>
    {stages?.history?.length ? <details className="ic-details"><summary>검토 이력</summary><ul>
      {stages.history.map((row,i)=><li key={i}>{({format:"포맷",copy:"카피",preview:"미리보기",final:"최종 검수"})[row.step]} ·
        {row.decision==="returned"?" 수정 요청":" 승인"} · {row.name || row.by} · <time dateTime={row.at}>{new Date(row.at).toLocaleString("ko-KR")}</time>{row.reason && " · "+row.reason}</li>)}
    </ul></details> : null}
    {revising && <div className="ic-row ic-actions"><label className="ic-field">수정 사유<input className="field" value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label>
      <button className="secondary-button" disabled={busy || !reason.trim()} onClick={()=>{returnReview(batch.id,revising,reason.trim());setRevising(undefined);setReason("");}}>수정 요청 보내기</button>
      <button className="secondary-button" onClick={()=>setRevising(undefined)}>취소</button></div>}
  </section>;
}

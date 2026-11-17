"use client";

import {useState, type ReactNode} from "react";
import type {ImageProjectBundle} from "./image-creative-workspace";
import {ImageReferenceSteps} from "./reference-image-creation";

/** Viewing an earlier step never revokes a recorded approval or starts another generation. */
export function ImageSavedSteps({bundle,busy,leave,children,enabled=true}:{bundle:ImageProjectBundle;busy:boolean;leave:()=>void;children:ReactNode;enabled?:boolean}) {
  const [step,setStep]=useState<number>();
  if(!enabled) return children;
  const {state,assets}=bundle;
  const batch=state.batches[0];
  const originals=batch?.variantIds.flatMap(id=>state.variants.find(row=>row.id===id) ?? []) ?? [];
  const source=originals[0]?.referenceLayout?.source;
  const image=assets.find(asset=>asset.path===source?.path);
  const labels=["상품","소구점","레퍼런스","카피"];
  if(step===undefined) return <>
    <button type="button" className="secondary-button ic-actions" disabled={busy} onClick={()=>setStep(3)}>뒤로 · 카피 확인</button>
    {children}
  </>;
  return <section className="panel panel-pad-lg ic-panel" aria-label="이전 단계 확인">
    <ImageReferenceSteps current={step}/>
    <h2>{labels[step]} 확인</h2>
    <p className="ic-muted">이 작업에서 선택하고 승인한 내용입니다. 돌아가도 입력과 시안, 승인 기록은 그대로 유지됩니다.</p>
    {step===0 && <dl className="ic-copy-lines">
      <dt>상품</dt><dd>{state.brief.product}</dd><dt>타겟</dt><dd>{state.brief.audience}</dd>
      <dt>제공 내용</dt><dd>{state.brief.offer}</dd><dt>광고 목표</dt><dd>{state.brief.objective}</dd>
    </dl>}
    {step===1 && <ol>{(state.formatRecommendation?.appeals ?? originals.map(row=>row.appeal)).map(row=><li key={row.id}>{row.meaning}</li>)}</ol>}
    {step===2 && <>
      <p>{state.formatRecommendation?.referenceSnapshot?.name || "선택한 원본 디자인"}</p>
      {image ? /* eslint-disable-next-line @next/next/no-img-element -- saved project reference */
        <img className="ic-saved-reference" src={image.url} alt="승인한 레퍼런스 원본"/> : <p>선택한 디자인은 현재 시안에서 확인할 수 있습니다.</p>}
    </>}
    {step===3 && <div className="ic-preview-grid">{originals.map(row=><article key={row.id} className="ic-card ic-card-body">
      <strong>{row.appeal.meaning}</strong><h3>{row.copy.headline}</h3>{row.copy.body && <p>{row.copy.body}</p>}<p>버튼 문구 · {row.copy.cta}</p>
    </article>)}</div>}
    {state.variants.some(row=>row.promptEdit) && step===3 && <p className="ic-muted">위 내용은 최초 승인한 카피입니다. 이후 프롬프트로 수정한 문구는 해당 수정 시안에서 확인하세요.</p>}
    <div className="ic-row ic-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>step===0 ? leave() : setStep(step-1)}>{step===0 ? "뒤로 · 프로젝트 목록" : `뒤로 · ${labels[step-1]} 확인`}</button>
      {step<3 && <button type="button" className="secondary-button" disabled={busy} onClick={()=>setStep(step+1)}>다음 · {labels[step+1]} 확인</button>}
      <button type="button" className="primary-button" disabled={busy} onClick={()=>setStep(undefined)}>현재 시안으로 돌아가기</button>
    </div>
    <p className="ic-muted">완성된 시안의 문구·이미지는 ‘수정하기’에서 바꿀 수 있습니다. 상품이나 소구 구성을 바꾸는 새 실험은 새 프로젝트로 시작하세요.</p>
  </section>;
}

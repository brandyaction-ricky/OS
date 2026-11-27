"use client";

import { useState } from "react";
import Link from "next/link";
import type { ImageProductCatalog } from "./use-image-product-catalog";
import type { ImageBrief } from "@/lib/image-creative/model";
import { briefForImageProduct, imageBriefMatchesProduct, onlyImageProductVersionChanged } from "@/lib/image-creative/products";
import { useSession } from "./session-provider";

const manualOption = "__manual";
const demoOption = "__demo";
const demoProduct = { product: "산들공방 머그컵 수업", brand: "산들공방", audience: "퇴근 후 도자기를 처음 배우려는 직장인", offer: "한 시간 수업에서 직접 만든 머그컵 한 개", objective:"첫 수업 예약", funnel:"체험 수업 예약" };

export function ProductCanonNotice({brief,catalog,disabled,onReview,onRecheck,apply=false}:{
  brief:ImageBrief;catalog:ImageProductCatalog;disabled:boolean;onReview?:()=>void;onRecheck?:(brief:ImageBrief)=>void;apply?:boolean;
}) {
  const ref = brief.productSource, result = catalog.result;
  if (!ref || !result) return null;
  if (result.error) return <p role="status" className="ic-muted">{result.error} <button type="button" className="secondary-button"
    disabled={disabled} onClick={()=>void catalog.refresh().catch(()=>{})}>다시 불러오기</button></p>;
  const current = result.items.find(item=>item.id===ref.productId);
  if (current?.needsData) return <div role="status" className="os-callout" data-tone="info"><strong>상품 정보 확인 필요</strong><p>{current.needsData}</p></div>;
  if (imageBriefMatchesProduct(brief,current)) return null;
  const next = current && briefForImageProduct(brief,current);
  const versionOnly = next && onlyImageProductVersionChanged(brief,next);
  const sourceChanges = current ? [
    ref.source.version!==current.source.version && `상품 v${ref.source.version} → v${current.source.version}`,
    ref.audienceSource && current.audienceSource && ref.audienceSource.version!==current.audienceSource.version &&
      `타겟 v${ref.audienceSource.version} → v${current.audienceSource.version}`,
  ].filter(Boolean).join(" · ") : "";
  return <div role="status" className="os-callout" data-tone="info">
    <strong>{current ? "상품 정본이 갱신됐어요." : "이 상품을 최신 정본에서 찾을 수 없어요."}</strong>
    {sourceChanges && <p>{sourceChanges}</p>}
    {versionOnly && <p>이 광고에 쓰는 상품 정보는 같습니다.</p>}
    {current && current.audience!==brief.audience && <p>최신 타겟 · {current.audience}</p>}
    {current && current.offer!==brief.offer && <p>최신 제공 내용 · {current.offer}</p>}
    {versionOnly && onRecheck ? <button type="button" className="secondary-button" disabled={disabled} onClick={()=>onRecheck(next)}>기획 유지 · 정본 버전 반영</button>
    : onReview && (!apply || current) ? <button type="button" className="secondary-button" disabled={disabled} onClick={onReview}>
      {apply ? "최신 정본 적용" : "상품 정보 확인"}</button> : <p>{onReview ? "다른 상품을 고르거나 직접 입력해 주세요." : "승인된 기획에는 승인 당시의 상품 정보가 보존됩니다."}</p>}
  </div>;
}

export function ImageProductFields({brief,setBrief,catalog,sample,onProductChosen,disabled,requireGoal=true}:{
  brief:ImageBrief;setBrief:(value:ImageBrief)=>void;catalog:ImageProductCatalog;sample:boolean;
  onProductChosen?:(value:ImageBrief)=>void; disabled:boolean; requireGoal?:boolean;
}) {
  const {demo} = useSession();
  const [manual,setManual] = useState(false);
  const [editGoal,setEditGoal] = useState(false);
  const result = catalog.result;
  const items = result?.items ?? [];
  const isSample = sample && !manual && !brief.productSource && brief.product === demoProduct.product && brief.audience === demoProduct.audience && brief.offer === demoProduct.offer;
  const ref = brief.productSource;
  const docLink = (id:string) => (demo && !sample ? "https://brandyaction-os.vercel.app" : "") + "/knowledge/doc/" + encodeURIComponent(id);
  const selectedId = ref?.productId ?? (isSample ? demoOption : (manual || brief.product ? manualOption : ""));
  const selected = items.find(row=>row.id === selectedId);
  function choose(id:string) {
    setManual(id===manualOption);
    setEditGoal(false);
    const next = {...brief};
    delete next.productSource;
    // Preserve the employee’s main message when replacing the product, not the previous product’s facts.
    const defaults = {product:"",brand:"",audience:"",offer:"",facts:"",funnel:"",objective:""};
    if (id === manualOption) {
      setBrief({...next,...defaults});
      return;
    }
    let chosen:ImageBrief;
    if (id === demoOption) chosen = {...next,...defaults,...demoProduct};
    else {
      const item = items.find(row=>row.id === id);
      if (!item) return;
      chosen = briefForImageProduct(ref?.productId===id ? brief : {...next,...defaults},item);
    }
    setBrief(chosen);
    if (!items.find(row=>row.id===id)?.needsData) onProductChosen?.(chosen);
  }
  function changeForAd() {
    const next = {...brief};
    delete next.productSource;
    setManual(true);
    setBrief(next);
  }
  const showGoalInput = editGoal || !brief.objective || !(isSample || (ref && selected?.objective));
  const manualField = (key:"product"|"audience"|"offer", label:string) =>
    <label key={key} className="ic-field">{label}<input className="field" value={brief[key] ?? ""} required maxLength={2000} onChange={event=>setBrief({...brief,[key]:event.target.value})}/></label>;
  return <div className="ic-product-fields">
    <label className="ic-field">상품 선택<select required disabled={disabled} className="field" value={selectedId}
      onChange={event=>choose(event.target.value)}>
      <option disabled value="">광고할 상품을 선택하세요</option>
      {items.map(row=><option key={row.id} value={row.id}>{row.product}{row.needsData ? " · 정보 확인 필요" : ""}</option>)}
      {ref && !selected && <option value={ref.productId}>{brief.product} · 저장된 기획</option>}
      {sample && <option value={demoOption}>{demoProduct.product} · 체험 상품</option>}
      <option value={manualOption}>직접 입력</option>
    </select></label>
    {!result && <p className="ic-muted" role="status">상품 정본을 불러오는 중이에요.</p>}
    {result?.error && !ref && <p className="ic-muted" role="status">{result.error} <button type="button" className="secondary-button" onClick={()=>void catalog.refresh().catch(()=>{})}>다시 불러오기</button></p>}
    {result && !result.error && !items.length && !sample && <p className="ic-muted">선택할 수 있는 상품 정본이 없습니다. 상품을 직접 입력할 수 있어요.</p>}
    {selectedId===manualOption ? <div className="ic-grid ic-actions">{manualField("product","상품명")}{manualField("audience","타겟")}{manualField("offer","제공 내용")}
      <label className="ic-field">브랜드명 (선택)<input className="field" maxLength={15} value={brief.brand ?? ""} onChange={event=>setBrief({...brief,brand:event.target.value})}/></label></div>
    : (ref || isSample) && <>
      <dl className="ic-copy-lines ic-product-summary">
        <div><dt>타겟</dt><dd>{brief.audience || "직접 입력 필요"}</dd></div>
        <div><dt>제공 내용</dt><dd>{brief.offer || "직접 입력 필요"}</dd></div>
        {!showGoalInput && <div><dt>광고 목표</dt><dd>{brief.objective}</dd></div>}
      </dl>
      {demo && <small className="ic-product-source-note">{isSample ? "체험용 예시 상품" : selected?.needsData ? "상품 원문 확인 필요" : "OS 정본 조회본"}</small>}
      <ProductCanonNotice brief={brief} catalog={catalog} disabled={disabled} apply onReview={()=>choose(selectedId)}/>
      <details className="ic-details"><summary>{isSample ? "상품 정보 · 수정" : "정본 정보 · 수정"}</summary>
        {brief.funnel && <p>고객 단계 · {brief.funnel}</p>}
        <div className="ic-row">
          {ref?.source.id && <Link href={docLink(ref.source.id)} target="_blank" rel="noreferrer">{ref.source.version ? `상품 정본 v${ref.source.version}` : "연결할 상품 문서"}</Link>}
          {ref?.audienceSource && <Link href={docLink(ref.audienceSource.id)} target="_blank" rel="noreferrer">타겟 정본 v{ref.audienceSource.version}</Link>}
          {requireGoal && !onProductChosen && !showGoalInput && <button type="button" className="secondary-button" onClick={()=>setEditGoal(true)}>광고 목표 변경</button>}
          <button type="button" className="secondary-button" onClick={changeForAd}>이번 광고에서 수정</button>
        </div>
      </details>
    </>}
    {selectedId && requireGoal && !onProductChosen && showGoalInput && <label className="ic-field ic-actions">광고를 본 뒤 원하는 행동<input className="field" required maxLength={2000}
      placeholder="예: 무료 진단 시작, 첫 수업 예약" value={brief.objective} onChange={event=>setBrief({...brief,objective:event.target.value})}/></label>}
  </div>;
}

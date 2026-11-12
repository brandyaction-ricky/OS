"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";
import type { ImageBrief } from "@/lib/image-creative/model";
import type { ImageAdProduct } from "@/lib/image-creative/products";
import { useSession } from "./session-provider";

const catalogPath = "/api/v1/content/image-creatives/products";
const manualOption = "__manual";
const demoOption = "__demo";
const demoProduct = { product: "산들공방 머그컵 수업", brand: "산들공방", audience: "퇴근 후 도자기를 처음 배우려는 직장인", offer: "한 시간 수업에서 직접 만든 머그컵 한 개", objective:"첫 수업 예약", funnel:"체험 수업 예약" };

export function ImageProductFields({brief,setBrief,previewProducts,revision,onProductChosen,disabled,requireGoal=true}:{
  brief:ImageBrief; setBrief:(value:ImageBrief)=>void; previewProducts?:ImageAdProduct[]; revision:number;
  onProductChosen?:(value:ImageBrief)=>void; disabled:boolean; requireGoal?:boolean;
}) {
  const {demo,accessToken} = useSession();
  const [load,setLoad] = useState<{token:string;items:ImageAdProduct[];error?:string}>();
  const [refresh,setRefresh] = useState(0);
  const [manual,setManual] = useState(false);
  const [editGoal,setEditGoal] = useState(false);
  useEffect(()=>{
    if (demo || !accessToken) return;
    const controller = new AbortController();
    apiRequest<{products:ImageAdProduct[]}>(catalogPath,{token:accessToken,signal:controller.signal})
      .then(({products})=>{
        if (!Array.isArray(products)) throw new Error("상품 목록을 읽지 못했어요.");
        if (!controller.signal.aborted) setLoad({token:accessToken,items:products});
      }).catch(()=>{
        if (!controller.signal.aborted) setLoad({token:accessToken,items:[],error:"상품 정본을 불러오지 못했어요."});
      });
    return ()=>controller.abort();
  },[accessToken,demo,refresh,revision]);

  const result: {items:ImageAdProduct[];error?:string}|undefined = demo ? {items:previewProducts ?? []} : (load?.token === accessToken ? load : undefined);
  const items = result?.items ?? [];
  const sample = demo && !previewProducts;
  const isSample = sample && !manual && !brief.productSource && brief.product === demoProduct.product && brief.audience === demoProduct.audience && brief.offer === demoProduct.offer;
  const ref = brief.productSource;
  const docLink = (id:string) => (demo && previewProducts ? "https://brandyaction-os.vercel.app" : "") + "/knowledge/doc/" + encodeURIComponent(id);
  const selectedId = ref?.productId ?? (isSample ? demoOption : (manual || brief.product ? manualOption : ""));
  const selected = items.find(row=>row.id === selectedId);
  const changed = Boolean(ref && selected && (ref.source.id !== selected.source.id || ref.source.version !== selected.source.version ||
    ref.audienceSource?.id !== selected.audienceSource?.id || ref.audienceSource?.version !== selected.audienceSource?.version));

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
      const {source,audienceSource} = item;
      chosen = {...next,...defaults,product:item.product,brand:item.brand,audience:item.audience,offer:item.offer,
        objective:item.objective ?? "",funnel:item.funnel ?? "",
        productSource:{productId:item.id,source:{id:source.id,version:source.version},
          ...(audienceSource ? {audienceSource:{id:audienceSource.id,version:audienceSource.version}} : {})}};
    }
    setBrief(chosen);
    onProductChosen?.(chosen);
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
  return <div>
    <label className="ic-field">상품 선택<select required disabled={disabled} className="field" value={selectedId}
      onChange={event=>choose(event.target.value)}>
      <option disabled value="">광고할 상품을 선택하세요</option>
      {items.map(row=><option key={row.id} value={row.id}>{row.product}</option>)}
      {ref && !selected && <option value={ref.productId}>{brief.product} · 저장된 기획</option>}
      {sample && <option value={demoOption}>{demoProduct.product} · 체험 상품</option>}
      <option value={manualOption}>직접 입력</option>
    </select></label>
    {!result && <p className="ic-muted" role="status">상품 정본을 불러오는 중이에요.</p>}
    {result?.error && <p className="ic-muted" role="status">{result.error} <button type="button" className="secondary-button" onClick={()=>{setLoad(undefined);setRefresh(value=>value+1);}}>다시 불러오기</button></p>}
    {result && !result.error && !items.length && !sample && <p className="ic-muted">선택할 수 있는 상품 정본이 없습니다. 상품을 직접 입력할 수 있어요.</p>}
    {selectedId===manualOption ? <div className="ic-grid ic-actions">{manualField("product","상품명")}{manualField("audience","타겟")}{manualField("offer","제공 내용")}
      <label className="ic-field">브랜드명 (선택)<input className="field" maxLength={15} value={brief.brand ?? ""} onChange={event=>setBrief({...brief,brand:event.target.value})}/></label></div>
    : (ref || isSample) && <>
      <dl className="ic-copy-lines">
        <dt>타겟</dt><dd>{brief.audience || "직접 입력 필요"}</dd>
        <dt>제공 내용</dt><dd>{brief.offer || "직접 입력 필요"}</dd>
        {!showGoalInput && <><dt>광고 목표</dt><dd>{brief.objective}</dd></>}
      </dl>
      {demo && <small>{isSample ? "체험용 예시 상품" : "OS 정본 조회본"}</small>}
      {changed && <p role="status">상품 정본이 갱신됐어요. <button type="button" className="secondary-button" disabled={disabled} onClick={()=>choose(selectedId)}>최신 정본 적용</button></p>}
      <details className="ic-details"><summary>{isSample ? "상품 정보 · 수정" : "정본 정보 · 수정"}</summary>
        {brief.funnel && <p>고객 단계 · {brief.funnel}</p>}
        <div className="ic-row">
          {ref && <Link href={docLink(ref.source.id)} target="_blank" rel="noreferrer">상품 정본 v{ref.source.version}</Link>}
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

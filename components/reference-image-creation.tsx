"use client";

import { useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { IMAGE_FORMATS, isImageFormat, type ImageFormatId } from "@/lib/image-creative/formats";
import warehouseCatalog from "@/lib/image-creative/warehouse-formats.json";
import { selectedReferencePlan } from "@/lib/image-creative/direction";
import { approveImageFormat, confirmReferenceCopy, createImageBatch, imageBriefProblems, sameImageBrief, startImageCopyBatch,
  type CreativeVariant, type FormatRecommendation, type ImageBatchRequest, type ImageCreativeState, type ImageFormatPlan } from "@/lib/image-creative/model";
import { ImageProductFields } from "./image-product-fields";
import { ImageFormatPicker, ImageFormatSample } from "./image-format-choice";
import type { GuidedImageProps } from "./guided-image-creative";
import type { ImageProjectBundle } from "./image-creative-workspace";

type Props = Pick<GuidedImageProps, "brief"|"setBrief"|"bundle"|"previewProducts"|"localDirectionPlanner"|"demo"|"busy"|"createProject"|"patch"|"receive"|"run"|"refresh"|"assetPaths"|"setAssetPaths"|"upload"|"leave"> & {plan:ImageFormatPlan};
type Appeal = CreativeVariant["appeal"];
type AdCopy = CreativeVariant["copy"];
const steps = ["상품 선택","소구점 선택","레퍼런스 선택","카피 작성","디자인 수정","확정"];
const exampleRefs: ImageFormatId[] = ["M01","typography","note","A04","A10","D12"];
const stamp = () => ({by:"브라우저 체험",at:new Date().toISOString()});

export function ImageReferenceSteps({current}:{current:number}) {
  return <ol className="ic-reference-steps" aria-label="제작 순서">{steps.map((label,index)=>
    <li key={label} aria-current={current===index ? "step" : undefined}>{label}</li>)}</ol>;
}

export function ReferenceImageCreation({plan,brief,setBrief,bundle,previewProducts,localDirectionPlanner,demo,busy,createProject,patch,receive,run,refresh,
  assetPaths,setAssetPaths,upload,leave}:Props) {
  const saved = bundle?.state.formatRecommendation;
  const mode = plan.mode === "appeal" ? "appeal" : "standalone";
  const [name,setName] = useState("");
  const [count,setCount] = useState(mode==="standalone" ? 5 : plan.count);
  const size = plan.size;
  const [localStep,setStep] = useState<number>();
  const [manual,setManual] = useState(false);
  const [written,setWritten] = useState("");
  const [checked,setChecked] = useState<string[]>([]);
  const [reword,setReword] = useState<Record<string,string>>({});
  const [picked,setPicked] = useState<ImageFormatId>();
  const [catalogRevision,setCatalogRevision] = useState(0);
  const approved = bundle?.state.formatApproval?.request;
  const batch = bundle?.state.batches[0];
  const variants = batch ? batch.variantIds.flatMap(id=>bundle?.state.variants.find(v=>v.id===id) ?? []) : [];
  const step = batch ? 3 : localStep ?? (approved ? 3 : saved?.appeals?.length ? 2 : saved?.referenceFirst ? 1 : 0);
  const options = bundle && sameImageBrief(brief,bundle.state.brief) ? saved?.appealOptions : undefined;
  const working = (phase:"formats"|"copy") => bundle?.jobs.find(job=>job.currentInput!==false && (job.phase ?? "copy")===phase && ["backlog","active"].includes(job.status));
  const local = (current:ImageProjectBundle,state:ImageCreativeState):ImageProjectBundle =>
    ({...current,state,project:{...current.project,version:current.project.version+1}});
  async function project() {
    const issue = imageBriefProblems(brief,true)[0];
    if (issue) throw new Error(issue);
    const title=name.trim() || brief.product + (mode==="appeal" ? " · A/B 테스트" : " · 광고 한 장");
    return bundle ?? createProject(title.slice(0,120),brief,mode==="appeal" ? true : undefined);
  }
  function prepareAppeals(fn:()=>Promise<void>) {
    void run(async()=>{
      try { await fn(); }
      catch (error) {
        if (error instanceof ApiRequestError && error.code==="IMAGE_PRODUCT_CHANGED") {
          setCatalogRevision(n=>n+1);setStep(0);
        }
        throw error;
      }
    });
  }
  function suggest() {
    prepareAppeals(async()=>{
      if (!Number.isInteger(count) || count<1 || count>20) throw new Error("추천 수를 1~20개로 정해 주세요.");
      const current = await project();
      let next: ImageProjectBundle;
      if (demo) {
        if (!localDirectionPlanner) throw new Error("이 브라우저에서 AI 추천을 받으려면 구독 AI 연결이 필요합니다. 소구점을 직접 작성할 수 있어요.");
        const result=await apiRequest<{appealOptions:Appeal[]}>("/api/dev/image-ad-direction",
          {method:"POST",body:JSON.stringify({phase:"appeals",brief,count})});
        if (result.appealOptions?.length!==count) throw new Error("요청한 수의 소구점을 받지 못했어요.");
        const formatRecommendation:FormatRecommendation = {mode,size,count:mode==="appeal"?count:1,referenceFirst:true,appealFirst:true,appealOptions:result.appealOptions};
        next=local(current,{...current.state,brief,formatRecommendation,formatApproval:undefined});
      } else next=await patch({action:"recommend-appeals",brief,mode,size,count},current);
      setChecked([]);setReword({});setManual(false);setStep(1);receive(next);
    });
  }
  const chosen:Appeal[] = manual ? written.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
    .map((meaning,index)=>({id:"manual-"+(index+1),meaning})) : (options ?? []).filter(a=>checked.includes(a.id)).map(a=>({...a,meaning:(reword[a.id] ?? a.meaning).trim()}));
  function chooseAppeals() {
    prepareAppeals(async()=>{
      const recommendation = selectedReferencePlan(brief,mode,size,chosen,options);
      const current = await project();
      const next = demo ? local(current,{...current.state,brief,formatRecommendation:recommendation,formatApproval:undefined})
        : await patch({action:"select-appeals",brief,mode,size,appeals:chosen},current);
      setPicked(undefined);setAssetPaths([]);setStep(undefined);receive(next);
    });
  }
  const chosenRef = picked && IMAGE_FORMATS[picked];
  const originalAd = picked && warehouseCatalog.entries.find(entry=>entry.id===picked)?.thumbnail;
  const photo = bundle?.assets.find(asset=>asset.path===assetPaths.at(-1));
  function chooseReference() {
    if (!bundle || !picked || !saved?.appeals?.length) return;
    const request:ImageBatchRequest = {mode,count:saved.appeals.length,size:saved.size,formatIds:[picked],assetPaths:IMAGE_FORMATS[picked].supportsAsset && photo ? [photo.path] : []};
    void run(async()=>{
      const next=demo ? local(bundle,approveImageFormat(bundle.state,request,stamp())) : await patch({action:"approve-format",request},bundle);
      receive(next);setStep(undefined);
    });
  }
  function backToAppeals() {
    const values = saved?.appeals ?? [];
    const allOptions = values.length>0 && values.every(a=>options?.some(opt=>opt.id===a.id));
    setManual(values.length>0 && !allOptions);setChecked(allOptions ? values.map(a=>a.id) : []);
    setReword(Object.fromEntries(values.map(a=>[a.id,a.meaning])));setWritten(values.map(a=>a.meaning).join("\n"));setStep(1);
  }
  const submitProduct = () => void run(async()=>{
    const issue=imageBriefProblems(brief,true)[0]; if(issue) throw new Error(issue);
    setManual(false);setChecked([]);setReword({});setWritten("");setPicked(undefined);setStep(1);
  });
  const waiting = (phase:"formats"|"copy") => <p role="status" className="ic-muted">
    {phase==="formats" ? "구독 AI에 소구점을 요청했어요." : "구독 AI에 카피 초안을 요청했어요."}
    {" "}<button type="button" className="secondary-button" disabled={busy} onClick={refresh}>상태 새로고침</button></p>;
  const format = approved?.formatIds?.[0] ?? variants[0]?.formatId;
  const editingCopy = step===3 && bundle && saved?.appeals && isImageFormat(format);
  async function confirm(copies:AdCopy[]) {
    if (!bundle || !saved?.appeals || !isImageFormat(format)) return;
    let current = bundle;
    let row = batch;
    if (!row) {
      if (!approved) throw new Error("먼저 레퍼런스를 선택해 주세요.");
      const source=bundle.assets.find(asset=>asset.path===approved.assetPaths?.[0]);
      const result={variants:saved.appeals.map((appeal,index)=>({formatId:format,formatVersion:IMAGE_FORMATS[format].version,size:saved.size,
        ...(source ? {asset:{path:source.path,w:source.w,h:source.h}} : {}),appeal,copy:copies[index]}))};
      if (demo) {
        const contents=createImageBatch(bundle.state,approved,result,{now:new Date().toISOString(),by:"브라우저 체험",newId:()=>crypto.randomUUID(),assets:bundle.assets});
        current=local(bundle,startImageCopyBatch(bundle.state,contents,approved));
      } else current=await patch({action:"import",request:approved,result},bundle);
      row=current.state.batches.at(-1);
      if (!row) throw new Error("작성한 카피를 저장하지 못했어요.");
      receive(current);
    }
    const next=demo ? local(current,confirmReferenceCopy(current.state,row.id,copies,stamp())) :
      await patch({action:"confirm-reference-copy",batchId:row.id,copies},current);
    receive(next);
  }
  async function suggestCopy():Promise<AdCopy[]|undefined> {
    if (!bundle || !saved?.appeals || !approved || !isImageFormat(format)) return;
    if (demo) {
      const photo=bundle.assets.find(a=>a.path===approved.assetPaths?.[0]);
      const res=await apiRequest<{variants:{copy:AdCopy}[]}>("/api/dev/image-ad-direction",{method:"POST",
        body:JSON.stringify({phase:"copy",brief:bundle.state.brief,mode,size:saved.size,appeals:saved.appeals,referenceId:format,
          ...(photo ? {asset:{path:photo.path,w:photo.w,h:photo.h}} : {})})});
      return res.variants.map(v=>v.copy);
    }
    receive(await patch({action:"generate",request:approved,guided:true},bundle));
  }
  return <><ImageReferenceSteps current={step}/>
    {step===0 && <form className="panel panel-pad-lg ic-panel ic-guided-brief" onSubmit={e=>{e.preventDefault();submitProduct();}}>
      <h2>상품 선택</h2>
      <ImageProductFields brief={brief} setBrief={setBrief} previewProducts={previewProducts} revision={catalogRevision} disabled={busy}
        requireGoal={false}/>
      {mode==="appeal" && !bundle && <label className="ic-field">프로젝트 이름 (선택)<input className="field" value={name} maxLength={120}
        onChange={e=>setName(e.target.value)} placeholder="예: 무료 진단 · 11월 소구점 테스트"/></label>}
      <div className="ic-row"><button className="primary-button" disabled={busy || !brief.product.trim()}>소구점 선택하기</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={leave}>뒤로</button></div>
    </form>}
    {step===1 && <section className="panel panel-pad-lg ic-panel ic-guided-brief"><h2>소구점 선택</h2><p>{brief.product}</p>
      <div className="ic-row"><button type="button" className="secondary-button" disabled={busy || !!working("formats")} aria-pressed={!!options?.length && !manual} onClick={()=>options?.length ? setManual(false) : suggest()}>{options?.length ? "AI 추천 소구점" : "AI에게 추천받기"}</button>
        <button type="button" className="secondary-button" aria-pressed={manual} disabled={busy} onClick={()=>setManual(true)}>직접 작성</button></div>
      {mode==="appeal" && !manual && !options?.length && <label className="ic-field">추천 수<input className="field ic-count-input" type="number" min={1} max={20}
        disabled={busy} value={count || ""} onChange={e=>setCount(Number(e.target.value))}/></label>}
      {working("formats") && waiting("formats")}
      {busy && demo && !manual && !options?.length && <p role="status">구독 AI가 소구점을 준비하고 있어요.</p>}
      {manual ? <label className="ic-field">소구점 직접 작성<textarea className="field" rows={mode==="standalone"?2:5} maxLength={mode==="standalone" ? 300 : 6020}
        placeholder={mode==="appeal" ? "비교할 소구점을 한 줄에 하나씩 적으세요." : "이 상품을 선택할 이유를 한 문장으로 적으세요."} value={written} onChange={e=>setWritten(e.target.value)}/></label>
        : options?.length ? <fieldset className="ic-checks ic-direction-concepts"><legend>{mode==="appeal" ? "테스트할 소구점 선택" : "광고에 쓸 소구점 한 개 선택"}</legend>
          {options.map(a=><div key={a.id}><label className="ic-check"><input type={mode==="appeal"?"checkbox":"radio"} name="appeal-option" checked={checked.includes(a.id)} disabled={busy}
            onChange={e=>setChecked(old=>mode==="standalone" ? [a.id] : e.target.checked ? [...old,a.id] : old.filter(id=>id!==a.id))}/>{reword[a.id]?.trim() || a.meaning}</label>
            {checked.includes(a.id) && <details className="ic-details"><summary>문구 수정</summary><label className="ic-field"><span className="ic-sr">선택한 소구점 수정</span><input className="field" maxLength={300} value={reword[a.id] ?? a.meaning}
              onChange={e=>setReword({...reword,[a.id]:e.target.value})}/></label></details>}</div>)}</fieldset> : null}
      <div className="ic-row"><button type="button" className="primary-button" disabled={busy || !chosen.length || chosen.length>20 ||
        chosen.some(a=>!a.meaning) || (mode==="standalone" && chosen.length!==1)} onClick={chooseAppeals}>레퍼런스 선택하기</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={()=>{setCatalogRevision(n=>n+1);setStep(0);}}>상품 변경</button></div>
    </section>}
    {step===2 && saved?.items && <section className="panel panel-pad-lg ic-panel ic-guided-brief"><h2>레퍼런스 선택</h2>
      <p>사용할 디자인 견본을 고르세요.{mode==="appeal" && " 고른 디자인과 버튼 문구는 모든 안에 공통으로 적용됩니다."}</p>
      <ImageFormatPicker reference recommendations={exampleRefs.filter(id=>saved.items?.some(row=>row.id===id)).map(id=>({id,reason:IMAGE_FORMATS[id].when}))}
        availableIds={saved.items.map(r=>r.id)} selected={picked?[picked]:[]} size={saved.size} disabled={busy} onSelect={setPicked}/>
      {chosenRef && <><strong>선택한 디자인 · {chosenRef.name}</strong>
        {originalAd ? <a target="_blank" rel="noreferrer" href={originalAd}>원본 광고 보기</a> : chosenRef.references[0] && <a target="_blank" rel="noreferrer" href={chosenRef.references[0].url}>출처 보기</a>}
        {chosenRef.supportsAsset && <fieldset className="ic-checks"><legend>{chosenRef.assetRequired ? "소재에 사용할 원본 이미지" : "사진 추가 (선택)"}</legend>
          {chosenRef.assetRequired && !photo && <p className="ic-muted">{demo || picked==="report_crop" ? "이 디자인에 넣을 원본 이미지 한 장을 선택해 주세요." : "원본을 올리거나 다음 단계에서 구독 AI로 이미지를 만들 수 있어요."}</p>}
          {!chosenRef.assetRequired && <label className="ic-check"><input type="radio" name="ref-asset" checked={!photo} onChange={()=>setAssetPaths([])}/>사진 없이 제작</label>}
          {bundle?.assets.map((a,i)=><label key={a.path} className="ic-check"><input type="radio" name="ref-asset" checked={photo?.path===a.path}
            onChange={()=>setAssetPaths([a.path])}/>
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated project asset */}
            <img src={a.url} alt={`등록 이미지 ${i+1}`} width={54} height={54}/></label>)}
          <label className="secondary-button">이미지 올리기<input className="ic-sr" type="file" accept="image/png,image/jpeg" disabled={busy}
            onChange={e=>{upload(e.target.files?.[0] ?? null);e.target.value="";}}/></label></fieldset>}</>}

      <div className="ic-row"><button type="button" className="primary-button" disabled={busy || !picked || (!!chosenRef?.assetRequired && !photo && (demo || picked==="report_crop"))}
        onClick={chooseReference}>카피 작성하기</button>{!approved && <button type="button" className="secondary-button" disabled={busy} onClick={backToAppeals}>소구점 변경</button>}</div>
    </section>}
    {editingCopy && <ReferenceCopyEditor key={JSON.stringify([format,saved.appeals,batch?.id ?? approved])} format={format} size={saved.size}
      appeals={saved.appeals!} initial={variants.map(v=>v.copy)} busy={busy} canSuggest={!batch && (!demo || !!localDirectionPlanner)}
      needsPhoto={!batch && !!IMAGE_FORMATS[format].assetRequired && !approved?.assetPaths?.length} pending={!!working("copy")}
      suggestCopy={suggestCopy} confirm={confirm} run={run} refresh={refresh}
      changeReference={batch || working("copy") ? undefined : ()=>{setPicked(format);setStep(2);}}/>}
  </>;
}

function ReferenceCopyEditor({format,size,appeals,initial,busy,canSuggest,needsPhoto,pending,suggestCopy,confirm,run,refresh,changeReference}:{
  format:ImageFormatId;size:ImageFormatPlan["size"];appeals:Appeal[];initial:AdCopy[];busy:boolean;canSuggest:boolean;needsPhoto:boolean;pending:boolean;
  suggestCopy:()=>Promise<AdCopy[]|undefined>;confirm:(copies:AdCopy[])=>Promise<void>;run:Props["run"];refresh:()=>void;changeReference?:()=>void;
}) {
  const [rows,setRows] = useState(appeals.map((_a,i)=>initial[i] ?? {headline:"",body:"",cta:""}));
  const [cta,setCta] = useState(initial[0]?.cta ?? "");
  const spec=IMAGE_FORMATS[format];
  function field(index:number,key:"body"|"headline",value:string) {setRows(old=>old.map((row,i)=>i===index?{...row,[key]:value}:row));}
  return <form className="panel panel-pad-lg ic-panel ic-guided-brief" onSubmit={e=>{e.preventDefault();void run(()=>confirm(rows.map(row=>({...row,cta:cta.trim()}))));}}>
    <h2>카피 작성</h2>
    <div className="ic-reference-summary"><ImageFormatSample id={format} size={size}/><strong>{spec.name}</strong>
      {changeReference && <button className="secondary-button" type="button" disabled={busy} onClick={changeReference}>레퍼런스 변경</button>}</div>
    {pending ? <div className="ic-row" role="status">구독 AI가 초안을 준비하고 있어요.<button className="secondary-button" type="button" onClick={refresh}>상태 새로고침</button></div>
      : canSuggest && <button className="secondary-button" type="button" disabled={busy} onClick={()=>void run(async()=>{const values=await suggestCopy();
        if(values){setRows(values);setCta(values[0]?.cta ?? "");}})}>{needsPhoto?"구독 AI로 공통 이미지와 카피 받기":"AI 카피 초안 받기"}</button>}
    {needsPhoto && <p>직접 쓰려면 레퍼런스 변경에서 원본 이미지를 올리세요.</p>}
    {appeals.map((appeal,i)=><fieldset disabled={busy || pending} key={appeal.id} className="ic-reference-copy">
      <legend>{appeal.meaning}</legend>
      <label className="ic-field">제목<input className="field" value={rows[i]?.headline ?? ""} required maxLength={spec.limits.headline}
        onChange={e=>field(i,"headline",e.target.value)}/></label>
      <label className="ic-field">본문<textarea className="field" value={rows[i]?.body ?? ""} rows={spec.bodyLines ?? 2} maxLength={spec.limits.body}
        placeholder={spec.bodyLines ? `한 줄에 한 항목씩 ${spec.bodyLines}줄` : undefined} onChange={e=>field(i,"body",e.target.value)}/></label>
    </fieldset>)}
    <label className="ic-field">버튼 문구<input className="field" disabled={busy || pending} required maxLength={spec.limits.cta} value={cta}
      placeholder="예: 무료 진단 시작하기" onChange={e=>setCta(e.target.value)}/></label>
    <button className="primary-button" disabled={busy || pending || needsPhoto || rows.some(r=>!r.headline.trim()) || !cta.trim()}>카피 확정 · 디자인 수정하기</button>
  </form>;
}

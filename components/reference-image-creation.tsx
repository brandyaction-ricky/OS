"use client";

import { useRef, useState } from "react";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { CREATIVE_SIZES, IMAGE_FORMATS, isImageFormat, isWarehouseFormat, type CreativeSize, type ImageFormatId } from "@/lib/image-creative/formats";
import { referenceSnapshot, warehouseDocumentUrl } from "@/lib/image-creative/reference-canon";
import { isReferenceLayout, usesReferenceDetailAsset, referenceBrandProblem, type ReferenceLayout } from "@/lib/image-creative/reference-layout";
import { LegacyPreview } from "./image-design-editor";
import { ReferenceLayoutEditor, prepareReferenceDesign, warehouseReferenceFile } from "./reference-layout-editor";
import { useImageReferenceCatalog } from "./use-image-reference-catalog";
import { selectedReferencePlan } from "@/lib/image-creative/direction";
import { imageJobPending, approveImageFormat, confirmReferenceCopy, createImageBatch, imageBriefProblems, sameImageBrief, saveReferenceCopyDraft, startImageCopyBatch, type ImageBrief,
  type CreativeVariant, type ImageBatchRequest, type ImageCreativeState, type ImageFormatPlan } from "@/lib/image-creative/model";
import { ImageProductFields, ProductCanonNotice } from "./image-product-fields";
import type { ImageProductCatalog } from "./use-image-product-catalog";
import { ImageFormatPicker, ImageFormatSample } from "./image-format-choice";
import type { GuidedImageProps } from "./guided-image-creative";
import type { ImageProjectBundle } from "./image-creative-workspace";
import type { ImageFlowPreview } from "@/lib/image-creative/flow-preview";
import "./image-creative-flow-preview.css";

type Props = Pick<GuidedImageProps, "brief"|"setBrief"|"bundle"|"localDirectionPlanner"|"demo"|"busy"|"createProject"|"patch"|"receive"|"run"|"refresh"|"assetPaths"|"setAssetPaths"|"upload"|"leave"> & {plan:ImageFormatPlan;catalog:ImageProductCatalog;sample:boolean;recheckProduct?:(brief:ImageBrief)=>void;flowPreview?:ImageFlowPreview};
type Appeal = CreativeVariant["appeal"];
type AdCopy = CreativeVariant["copy"];
const steps = ["상품 선택","소구점 선택","레퍼런스 선택","카피 작성","디자인 수정","확정"];
const exampleRefs: ImageFormatId[] = ["M01","typography","note","A04","A10","D12"];
const stamp = () => ({by:"브라우저 체험",at:new Date().toISOString()});
function closestSize({w,h}:ReferenceLayout["source"]):CreativeSize {
  const ratio=w/h;
  const distance=(key:CreativeSize)=>Math.abs(Math.log((CREATIVE_SIZES[key].width/CREATIVE_SIZES[key].height)/ratio));
  return (Object.keys(CREATIVE_SIZES) as CreativeSize[]).reduce((best,key)=>distance(key)<distance(best)?key:best);
}

export function ImageReferenceSteps({current}:{current:number}) {
  return <ol className="ic-reference-steps" aria-label="제작 순서">{steps.map((label,index)=>
    <li key={label} aria-current={current===index ? "step" : undefined}>{label}</li>)}</ol>;
}

function ReferenceComparison({sourceUrl,photo,detailUrl,variant,caption}:{sourceUrl:string;photo?:string;detailUrl?:string;variant:CreativeVariant;caption:string}) {
  return <div className="ic-reference-comparison" role="group" aria-label="원본 광고와 교체 시안">
    <figure><figcaption>원본 광고</figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element -- actual project reference */}
      <img alt="선택한 레퍼런스 원본" src={sourceUrl}/></figure>
    <figure><figcaption>{caption}</figcaption>
      <LegacyPreview variant={variant} url={photo} detailUrl={detailUrl} referenceUrl={sourceUrl}/></figure>
  </div>;
}

export function ReferenceImageCreation({plan,brief,setBrief,bundle,catalog,sample,recheckProduct,localDirectionPlanner,demo,busy,createProject,patch,receive,run,refresh,
  assetPaths,setAssetPaths,upload,leave,flowPreview}:Props) {
  const preview = process.env.NODE_ENV === "development" && demo ? flowPreview : undefined;
  const saved = bundle?.state.formatRecommendation;
  const mode = plan.mode === "appeal" ? "appeal" : "standalone";
  const [name,setName] = useState("");
  const size = plan.size;
  const [localStep,setStep] = useState<number>();
  const [showSaved,setShowSaved] = useState(false);
  const editingLegacyAppeals = saved?.appealFirst && !saved.referenceFirst;
  const [written,setWritten] = useState(() => (saved?.appeals ?? []).map(a=>a.meaning).join("\n"));
  const appealProduct = useRef(brief.productSource?.productId ?? brief.product);
  const [checked,setChecked] = useState<string[]>([]);
  const [reword,setReword] = useState<Record<string,string>>({});
  const [picked,setPicked] = useState<ImageFormatId>();
  const approved = bundle?.state.formatApproval?.request;
  const [previewReferenceId,setPreviewReferenceId] = useState(() => preview?.references.find(entry=>entry.layout.source.path===approved?.referenceLayout?.source.path)?.id);
  const [uploadedPreview,setUploadedPreview] = useState<{name:string;url:string}>();
  const [enlargedReference,setEnlargedReference] = useState<{name:string;imageUrl:string;source?:string}>();
  const [warehouseFilter,setWarehouseFilter] = useState("approved");
  const [warehouseQuery,setWarehouseQuery] = useState("");
  const [failedReferences,setFailedReferences] = useState<string[]>([]);
  const [galleryGroup,setGalleryGroup] = useState("");
  const [galleryQuery,setGalleryQuery] = useState("");
  const [galleryId,setGalleryId] = useState<string>();
  const referenceDialog = useRef<HTMLDialogElement>(null);
  const [referenceLayout,setReferenceLayout] = useState<ReferenceLayout>();
  const [detailAssetPath,setDetailAssetPath] = useState<string>();
  const [referenceError,setReferenceError] = useState("");
  const [preparing,setPreparing]=useState(false);
  const [referenceSize,setReferenceSize] = useState<CreativeSize>();
  const batch = bundle?.state.batches[0];
  const variants = batch ? batch.variantIds.flatMap(id=>bundle?.state.variants.find(v=>v.id===id) ?? []) : [];
  const step = batch ? 3 : localStep ?? (approved ? 3 : editingLegacyAppeals ? 1 : saved?.appeals?.length ? 2 : saved?.referenceFirst ? 1 : 0);
  const warehouse = useImageReferenceCatalog(Boolean(localDirectionPlanner), step === 2 && !preview);
  const sameBrief = bundle && sameImageBrief(brief,bundle.state.brief);
  const options = sameBrief ? saved?.appealOptions : undefined;
  const pendingCopy = bundle?.jobs.some(job=>job.currentInput!==false && (job.phase ?? "copy")==="copy" && imageJobPending(job));
  const local = (current:ImageProjectBundle,state:ImageCreativeState):ImageProjectBundle =>
    ({...current,state,project:{...current.project,version:current.project.version+1}});
  async function project() {
    const issue = imageBriefProblems(brief,true)[0];
    if (issue) throw new Error(issue);
    const title=name.trim() || brief.product + (mode==="appeal" ? " · A/B 테스트" : " · 광고 한 장");
    return bundle ?? createProject(title.slice(0,120),brief,mode==="appeal" ? true : undefined);
  }
  function runWithProduct(fn:()=>Promise<void>) {
    void run(async()=>{
      try {
        if (!approved && !batch) await catalog.verify(brief);
        await fn();
      }
      catch (error) {
        if (error instanceof ApiRequestError && error.code==="IMAGE_PRODUCT_CHANGED") {
          setStep(0);
        }
        throw error;
      }
    });
  }
  const useSaved = Boolean(showSaved && options?.length);
  const chosen:Appeal[] = useSaved
    ? (options ?? []).filter(a=>checked.includes(a.id)).map(a=>({...a,meaning:(reword[a.id] ?? a.meaning).trim()}))
    : written.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
      .map((meaning,index)=>({id:"manual-"+(index+1),meaning}));
  function chooseAppeals() {
    runWithProduct(async()=>{
      // Keep the saved reference and edited copy when returning without changing inputs.
      if (sameBrief && saved?.appeals?.length===chosen.length && chosen.every((appeal,index)=>
        appeal.meaning===saved.appeals?.[index].meaning)) {
        setStep(2);
        return;
      }
      const recommendation = selectedReferencePlan(brief,mode,size,chosen,options);
      const current = await project();
      const next = demo ? local(current,{...current.state,brief,formatRecommendation:recommendation,formatApproval:undefined})
        : await patch({action:"select-appeals",brief,mode,size,appeals:chosen},current);
      setPicked(undefined);setPreviewReferenceId(undefined);setUploadedPreview(undefined);setReferenceLayout(undefined);setReferenceSize(undefined);setDetailAssetPath(undefined);setAssetPaths([]);setStep(undefined);receive(next);
    });
  }
  const availableIds = (saved?.items ?? []).map(row => row.id).filter(id =>
    !isWarehouseFormat(id) || warehouse.catalog?.entries.some(entry => entry.id === id));
  const referenceBusy = busy || preparing;
  const custom = picked==="reference_image";
  const suggestedSize=referenceLayout ? closestSize(referenceLayout.source) : undefined;
  const outputSize=referenceSize ?? suggestedSize ?? saved?.size ?? size;
  const chosenRef = picked && (custom || availableIds.includes(picked)) ? IMAGE_FORMATS[picked] : undefined;
  const selectedEntry = warehouse.catalog?.entries.find(entry => entry.id === picked);
  const photo = bundle?.assets.find(asset=>asset.path===assetPaths.at(-1));
  const needsDetail = usesReferenceDetailAsset(referenceLayout);
  const detail = needsDetail ? bundle?.assets.find(asset=>asset.path===detailAssetPath && asset.path!==referenceLayout?.source.path) : undefined;
  const original = bundle?.assets.find(a=>a.path===referenceLayout?.source.path);
  const hasWarehouseImage = Boolean(selectedEntry?.originalImageUrl || selectedEntry?.archivedThumbnail || selectedEntry?.thumbnail);
  // 레퍼런스 창고 gallery: one group at a time; a search looks through every group.
  const galleryEntries = warehouse.catalog?.entries ?? [];
  const galleryGroups = [...new Set(galleryEntries.map(entry=>entry.group))];
  const shownGroup = galleryGroups.includes(galleryGroup) ? galleryGroup : galleryGroups[0] ?? "";
  const galleryText = galleryQuery.trim().toLowerCase();
  const galleryShown = galleryEntries.filter(entry=>galleryText ? `${entry.id} ${entry.name} ${entry.group}`.toLowerCase().includes(galleryText) : entry.group===shownGroup);
  const galleryEntry = galleryEntries.find(entry=>entry.id===galleryId);
  const imageOf = (entry:{archivedThumbnail?:string;originalImageUrl?:string;thumbnail:string}) => entry.archivedThumbnail || entry.originalImageUrl || entry.thumbnail;
  async function importWarehouseSource(entry = selectedEntry) {
    if (!entry || referenceBusy) return;
    setPreparing(true);setReferenceError("");
    try {
      const file=await warehouseReferenceFile(entry);
      await upload(file,async asset=>{
        const layout=await prepareReferenceDesign(asset,entry.masterRecipe,brief.brand);
        setReferenceLayout(layout);setReferenceSize(undefined);setDetailAssetPath(undefined);setPicked("reference_image");
      });
    } catch (cause) {
      setReferenceError((cause instanceof Error ? cause.message : "창고 원본을 불러오지 못했어요.")+" 원 광고 파일을 직접 올릴 수 있어요.");
    } finally {setPreparing(false);}
  }
  function chooseReference() {
    if (!bundle || !picked || !chosenRef || !saved?.appeals?.length) return;
    if (custom && (!isReferenceLayout(referenceLayout) || (referenceLayout.photo && (!photo || photo.path===referenceLayout.source.path)) || (needsDetail && !detail))) return;
    const needsAsset = custom ? Boolean(referenceLayout?.photo) : chosenRef.supportsAsset;
    const request:ImageBatchRequest = {mode,count:saved.appeals.length,size:custom?outputSize:saved.size,formatIds:[picked],assetPaths:needsAsset && photo ? [photo.path] : [],
      ...(custom && {referenceLayout}),...(custom && detail && {detailAssetPath:detail.path})};
    runWithProduct(async()=>{
      const snapshot = isWarehouseFormat(picked) && selectedEntry ? referenceSnapshot(selectedEntry) : undefined;
      const next=demo ? local(bundle,approveImageFormat(bundle.state,request,stamp(),snapshot)) : await patch({
        action:"approve-format",request,...(snapshot && {referenceSource:{documentId:snapshot.documentId,version:snapshot.version}}),
      },bundle);
      receive(next);setStep(undefined);
    });
  }
  function backToAppeals() {
    const values = saved?.appeals ?? [];
    const allOptions = values.length>0 && values.every(a=>options?.some(opt=>opt.id===a.id));
    setShowSaved(Boolean(allOptions));setChecked(allOptions ? values.map(a=>a.id) : []);
    setReword(Object.fromEntries(values.map(a=>[a.id,a.meaning])));setWritten(values.map(a=>a.meaning).join("\n"));setStep(1);
  }
  const submitProduct = () => runWithProduct(async()=>{
    const issue=imageBriefProblems(brief,true)[0]; if(issue) throw new Error(issue);
    const productId=brief.productSource?.productId ?? brief.product;
    if (appealProduct.current!==productId) {setShowSaved(false);setWritten("");}
    appealProduct.current=productId;
    setChecked([]);setReword({});setPicked(undefined);setStep(1);
  });
  const format = approved?.formatIds?.[0] ?? variants[0]?.formatId;
  const copyLayout = approved?.referenceLayout ?? variants[0]?.referenceLayout;
  const copyPhotoPath = approved?.assetPaths?.[0] ?? variants[0]?.asset?.path;
  const copyDetailPath = approved?.detailAssetPath ?? variants[0]?.detailAsset?.path;
  const copyDetail = bundle?.assets.find(asset=>asset.path===copyDetailPath);
  const editingCopy = step===3 && bundle && saved?.appeals && isImageFormat(format);
  const copyDraft = batch?.review?.copyDraft ?? bundle?.state.formatApproval?.copyDraft;
  const previewReference = preview?.references.find(entry=>entry.id===previewReferenceId);
  const previewProductReady = !preview?.renderProductIds?.length || preview.renderProductIds.includes(brief.productSource?.productId ?? "");
  const approvedPreviewReference = preview?.references.find(entry=>entry.layout.source.path===copyLayout?.source.path);
  const warehouseChoices = preview?.warehouse?.entries.map(entry=>({...entry,
    imageUrl:entry.archivedThumbnail || entry.originalImageUrl || entry.thumbnail,
  })) ?? preview?.references.map(entry=>({...entry,source:"",group:""})) ?? [];
  const selectedWarehouseReference = warehouseChoices.find(entry=>entry.id===previewReferenceId);
  const visibleWarehouseChoices = warehouseChoices.filter(entry=>
    (!preview?.warehouse || warehouseFilter==="all" || (warehouseFilter==="ready" ? preview.references.some(ref=>ref.id===entry.id) : preview.warehouse.approvedIds.includes(entry.id))) &&
    `${entry.id} ${entry.name}`.toLowerCase().includes(warehouseQuery.trim().toLowerCase()));
  async function inspectPreviewUpload(file:File|null) {
    if (!file || !preview) return;
    setReferenceError("");
    if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size>10*1024*1024) {
      setReferenceError("10MB 이하의 PNG, JPG, WebP 이미지를 선택해 주세요.");
      return;
    }
    setPreparing(true);
    try {
      const url=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>typeof reader.result==="string" ? resolve(reader.result) : reject(new Error("이미지를 읽지 못했어요."));
        reader.onerror=()=>reject(new Error("이미지를 읽지 못했어요."));
        reader.readAsDataURL(file);
      });
      setUploadedPreview({name:file.name,url});setPreviewReferenceId(undefined);
    } catch (error) {setReferenceError(error instanceof Error ? error.message : "이미지를 읽지 못했어요.");}
    finally {setPreparing(false);}
  }
  function choosePreviewReference() {
    if (!preview || !previewReference || !previewProductReady || uploadedPreview || !bundle || !saved?.appeals?.length) return;
    runWithProduct(async()=>{
      const entry=previewReference;
      const request:ImageBatchRequest={mode,count:saved.appeals!.length,size:closestSize(entry.layout.source),formatIds:["reference_image"],
        assetPaths:entry.photoPath ? [entry.photoPath] : [],referenceLayout:entry.layout,...(entry.detailAssetPath && {detailAssetPath:entry.detailAssetPath})};
      const assets=Array.from(new Map([...bundle.assets,...entry.assets].map(asset=>[asset.path,asset])).values());
      let state=approveImageFormat(bundle.state,request,stamp());
      const copies=copyDraft?.length===saved.appeals!.length ? copyDraft : saved.appeals!.map(appeal=>({
        headline:appeal.meaning,body:entry.layout.body ? preview.body : "",cta:preview.cta,
      }));
      state=saveReferenceCopyDraft(state,copies);
      receive(local({...bundle,assets},state));
      setPicked("reference_image");setReferenceLayout(entry.layout);setReferenceSize(request.size);setAssetPaths(request.assetPaths ?? []);setDetailAssetPath(entry.detailAssetPath);setStep(3);
    });
  }
  async function saveDraft(copies:AdCopy[]) {
    if (!bundle) throw new Error("카피를 저장할 프로젝트를 다시 열어 주세요.");
    const next = demo ? local(bundle,saveReferenceCopyDraft(bundle.state,copies)) :
      await patch({action:"save-reference-copy-draft",copies},bundle);
    receive(next,bundle.project.version);
  }
  async function confirm(copies:AdCopy[]) {
    if (!bundle || !saved?.appeals || !isImageFormat(format)) return;
    let current = bundle;
    let row = batch;
    if (!row) {
      if (!approved) throw new Error("먼저 레퍼런스를 선택해 주세요.");
      const source=bundle.assets.find(asset=>asset.path===approved.assetPaths?.[0]);
      const result={variants:saved.appeals.map((appeal,index)=>({formatId:format,formatVersion:IMAGE_FORMATS[format].version,size:approved.size ?? saved.size,
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
        body:JSON.stringify({phase:"copy",brief:bundle.state.brief,mode,size:approved.size ?? saved.size,appeals:saved.appeals,referenceId:format,referenceSnapshot:saved.referenceSnapshot,
          ...(approved.referenceLayout && {referenceLayout:approved.referenceLayout}),
          ...(copyDetail && {detailAsset:{path:copyDetail.path,w:copyDetail.w,h:copyDetail.h}}),
          ...(photo ? {asset:{path:photo.path,w:photo.w,h:photo.h}} : {})})});
      return res.variants.map(v=>v.copy);
    }
    receive(await patch({action:"generate",request:approved,guided:true},bundle));
  }
  const sampleAssetInput=chosenRef && !custom && chosenRef.supportsAsset && <fieldset className="ic-checks">
    <legend>{chosenRef.assetRequired ? "소재에 사용할 원본 이미지" : "사진 추가 (선택)"}</legend>
    {chosenRef.assetRequired && !photo && <p className="ic-muted">{demo || picked==="report_crop" ? "이 디자인에 넣을 원본 이미지 한 장을 선택해 주세요." : "원본을 올리거나 다음 단계에서 구독 AI로 이미지를 만들 수 있어요."}</p>}
    {!chosenRef.assetRequired && <label className="ic-check"><input type="radio" name="ref-asset" checked={!photo} onChange={()=>setAssetPaths([])}/>사진 없이 제작</label>}
    {bundle?.assets.map((a,i)=><label key={a.path} className="ic-check">
      <input type="radio" name="ref-asset" checked={photo?.path===a.path} onChange={()=>setAssetPaths([a.path])}/>
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated project asset */}
      <img src={a.url} alt={`등록 이미지 ${i+1}`} width={54} height={54}/>
    </label>)}
    <label className="secondary-button">이미지 올리기<input className="ic-sr" type="file" accept="image/png,image/jpeg" disabled={referenceBusy}
      onChange={e=>{upload(e.target.files?.[0] ?? null);e.target.value="";}}/></label>
  </fieldset>;
  const brandIssue=referenceLayout ? referenceBrandProblem(referenceLayout,brief.brand) : undefined;
  const referenceReady=!!chosenRef && (custom
    ? isReferenceLayout(referenceLayout) && !brandIssue && (!needsDetail || !!detail) && (!referenceLayout.photo || (!!photo && photo.path!==referenceLayout.source.path))
    : !chosenRef.assetRequired || !!photo || (!demo && picked!=="report_crop"));
  const referenceDialogView = <dialog ref={referenceDialog} className="ic-flow-reference-dialog" onClose={()=>setEnlargedReference(undefined)}>
    <div><strong>{enlargedReference?.name}</strong><button className="secondary-button" type="button" onClick={()=>referenceDialog.current?.close()}>닫기</button></div>
    {/* eslint-disable-next-line @next/next/no-img-element -- same original image at a larger size */}
    {enlargedReference && <img src={enlargedReference.imageUrl} alt={`${enlargedReference.name} 원본 크게 보기`}/>}
  </dialog>;
  return <><ImageReferenceSteps current={step}/>
    {step>0 && <ProductCanonNotice brief={brief} catalog={catalog} disabled={busy} onRecheck={bundle && sameImageBrief(brief,bundle.state.brief) ? recheckProduct : undefined}
      onReview={!approved && !batch ? ()=>setStep(0) : undefined}/>}
    {step===0 && <form className="panel panel-pad-lg ic-panel ic-guided-brief" onSubmit={e=>{e.preventDefault();submitProduct();}}>
      <h2>상품 선택</h2>
      <ImageProductFields brief={brief} setBrief={setBrief} catalog={catalog} sample={sample} disabled={busy}
        requireGoal={false}/>
      {mode==="appeal" && !bundle && <label className="ic-field">프로젝트 이름 (선택)<input className="field" value={name} maxLength={120}
        onChange={e=>setName(e.target.value)} placeholder="예: 무료 진단 · 11월 소구점 테스트"/></label>}
      <div className="ic-row"><button className="primary-button" disabled={busy || !brief.product.trim() || !!catalog.result?.items.find(row=>row.id===brief.productSource?.productId)?.needsData}>소구점 선택하기</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={leave}>뒤로</button></div>
    </form>}
    {step===1 && <section className="panel panel-pad-lg ic-panel ic-guided-brief"><h2>소구점 선택</h2><p>{brief.product}</p>
      {!!options?.length && <div className="ic-row">
        <button type="button" className="secondary-button" aria-pressed={!useSaved} disabled={busy} onClick={()=>setShowSaved(false)}>직접 작성</button>
        <button type="button" className="secondary-button" aria-pressed={useSaved} disabled={busy} onClick={()=>setShowSaved(true)}>저장된 소구점 보기</button>
      </div>}
      {!useSaved ? <label className="ic-field">소구점 직접 작성<textarea disabled={busy} className="field" rows={mode==="standalone"?2:5} maxLength={mode==="standalone" ? 300 : 6020}
        placeholder={mode==="appeal" ? "비교할 소구점을 한 줄에 하나씩 적으세요." : "이 상품을 선택할 이유를 한 문장으로 적으세요."} value={written} onChange={e=>setWritten(e.target.value)}/></label>
        : options?.length ? <fieldset className="ic-checks ic-direction-concepts"><legend>{mode==="appeal" ? "테스트할 소구점 선택" : "광고에 쓸 소구점 한 개 선택"}</legend>
          {options.map(a=><div key={a.id}><label className="ic-check"><input type={mode==="appeal"?"checkbox":"radio"} name="appeal-option" checked={checked.includes(a.id)} disabled={busy}
            onChange={e=>setChecked(old=>mode==="standalone" ? [a.id] : e.target.checked ? [...old,a.id] : old.filter(id=>id!==a.id))}/>{reword[a.id]?.trim() || a.meaning}</label>
            {checked.includes(a.id) && <details className="ic-details"><summary>문구 수정</summary><label className="ic-field"><span className="ic-sr">선택한 소구점 수정</span><input className="field" maxLength={300} value={reword[a.id] ?? a.meaning}
              onChange={e=>setReword({...reword,[a.id]:e.target.value})}/></label></details>}</div>)}</fieldset> : null}
      <div className="ic-row"><button type="button" className="primary-button" disabled={busy || !chosen.length || chosen.length>20 ||
        chosen.some(a=>!a.meaning) || (mode==="standalone" && chosen.length!==1)} onClick={chooseAppeals}>레퍼런스 선택하기</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={()=>setStep(0)}>뒤로 · 상품 선택</button></div>
    </section>}
    {step===2 && saved?.items && preview && <section className="panel panel-pad-lg ic-panel ic-guided-brief ic-flow-reference"><h2>레퍼런스 선택</h2>
      {!previewProductReady && <p role="status" className="os-callout" data-tone="info">이 상품은 선택·정본 자동 채움·레퍼런스 탐색까지 확인할 수 있습니다. 지금 준비된 시안은 핵심 보고서 예시입니다. 카피부터 출력까지 테스트하려면 핵심 보고서를 선택해 주세요.</p>}
      <p>사용할 원본 디자인을 고르세요. {mode==="appeal" ? `${saved.appeals?.length ?? 0}개 소구점에 같은 디자인과 버튼 문구를 적용합니다.` : "이 디자인에 맞춰 카피를 준비합니다."}</p>
      <h3>레퍼런스 창고에서 고르기</h3>
      {preview.warehouse && <>
        <div className="ic-flow-warehouse-toolbar">
          <label className="ic-field">보여줄 레퍼런스<select aria-label="보여줄 레퍼런스" className="field" value={warehouseFilter} onChange={e=>setWarehouseFilter(e.target.value)}>
            <option value="approved">승인한 레퍼런스 {preview.warehouse.approvedIds.length}종</option>
            <option value="all">창고 전체 {warehouseChoices.length}종</option>
            <option value="ready">시안까지 확인 가능 {preview.references.length}종</option>
          </select></label>
          <label className="ic-field">레퍼런스 검색<input type="search" className="field" value={warehouseQuery} placeholder="이름 또는 번호 검색"
            onChange={e=>setWarehouseQuery(e.target.value)}/></label>
        </div>
        <p className="ic-muted">OS 창고를 {preview.warehouse.checkedAt}에 읽은 목록입니다. 전체 목록에는 기존 보관 항목도 포함됩니다.</p>
      </>}
      <div className="ic-flow-reference-grid" aria-label="레퍼런스 원본">
        {visibleWarehouseChoices.map(entry=>{
          const missing=!entry.imageUrl || failedReferences.includes(entry.id);
          const ready=preview.references.some(ref=>ref.id===entry.id);
          const selected=entry.id===previewReferenceId && !uploadedPreview;
          return <article className="ic-flow-reference-card" key={entry.id} data-reference-id={entry.id} data-selected={selected}>
            <button className="ic-flow-reference-choice" type="button" disabled={referenceBusy || missing} aria-pressed={selected}
              onClick={()=>{setPreviewReferenceId(entry.id);setUploadedPreview(undefined);setReferenceError("");}}>
              {/* eslint-disable-next-line @next/next/no-img-element -- actual OS warehouse image, never a substitute example */}
              {!missing ? <img src={entry.imageUrl} alt={`${entry.name} 원본 광고`} loading="lazy"
                onError={()=>setFailedReferences(old=>old.includes(entry.id)?old:[...old,entry.id])}/>
                : <span className="ic-flow-reference-missing">{entry.imageUrl ? "이미지를 불러오지 못했어요" : "원본 이미지 등록 필요"}</span>}
              <span><strong>{entry.id} · {entry.name}</strong><span>{selected ? "선택됨" : missing ? "선택 불가" : "선택"}</span></span>
            </button>
            <small className="ic-flow-reference-meta">{ready ? "시안까지 확인 가능" : "이 미리보기에서는 원본 보기만 가능"}</small>
            <div className="ic-flow-reference-actions">
              <button type="button" className="ic-flow-enlarge" disabled={missing} onClick={()=>{setEnlargedReference(entry);referenceDialog.current?.showModal();}}>크게 보기</button>
              {entry.source && <a className="ic-flow-enlarge" href={entry.source} target="_blank" rel="noreferrer">광고 출처</a>}
            </div>
          </article>;
        })}
      </div>
      {!visibleWarehouseChoices.length && <p role="status">조건에 맞는 레퍼런스가 없어요. 검색어나 목록을 바꿔 주세요.</p>}
      {selectedWarehouseReference && !uploadedPreview && <div className="ic-flow-selected" role="status">
        <strong>선택한 원본 · {selectedWarehouseReference.id} · {selectedWarehouseReference.name}</strong>
        {!previewReference && <p>이 원본은 현재 미리보기에서 제작할 수 없습니다. 이번 화면 검토에서 카피부터 출력까지 확인하려면 ‘시안까지 확인 가능’ 목록을 선택해 주세요.</p>}
      </div>}
      <details className="ic-details ic-flow-upload"><summary>내 레퍼런스 이미지 직접 올리기</summary>
        <p className="ic-muted">내 이미지도 선택하고 확인할 수 있어요. 이번 미리보기에서는 준비된 원본 2종으로 카피와 시안까지 확인할 수 있습니다.</p>
        <label className="secondary-button">이미지 선택<input className="ic-sr" type="file" accept="image/png,image/jpeg,image/webp" disabled={referenceBusy}
          onChange={e=>{void inspectPreviewUpload(e.target.files?.[0] ?? null);e.target.value="";}}/></label>
        {uploadedPreview && <div className="ic-flow-upload-preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-selected local file preview, never uploaded */}
          <img src={uploadedPreview.url} alt={uploadedPreview.name}/><strong>{uploadedPreview.name}</strong>
          <p role="status">파일 미리보기까지 확인했습니다. 직접 올린 원본의 자동 분석·카피·시안 생성은 아직 연결하지 않았어요. 시안까지 확인 가능한 원본을 선택하면 다음 단계로 이어집니다.</p>
        </div>}
      </details>
      {referenceError && <p role="alert">{referenceError}</p>}
      {!selectedWarehouseReference && !uploadedPreview && <p className="ic-muted">위 이미지에서 사용할 디자인을 선택해 주세요.</p>}
      <div className="ic-row"><button type="button" className="primary-button" disabled={referenceBusy || !previewProductReady || !previewReference || !!uploadedPreview || !!(previewReferenceId && failedReferences.includes(previewReferenceId))}
        onClick={choosePreviewReference}>이 디자인으로 카피 {saved.appeals?.length ?? 0}개 제안받기</button>
        <button type="button" className="secondary-button" disabled={referenceBusy} onClick={backToAppeals}>소구점으로 돌아가기</button></div>
      {referenceDialogView}
    </section>}
    {step===2 && saved?.items && !preview && <section className="panel panel-pad-lg ic-panel ic-guided-brief"><h2>레퍼런스 선택</h2>
      <p>원본 디자인을 가져올 광고를 고르세요.{mode==="appeal" && " 고른 디자인과 버튼 문구는 모든 안에 공통으로 적용됩니다."}</p>
      {!custom && warehouse.offline && <p className="ic-muted">오프라인 체험용 예시</p>}
      {!custom && warehouse.error && <p role="alert">{warehouse.error} <button type="button" className="secondary-button" onClick={()=>void warehouse.refresh().catch(()=>{})}>다시 읽기</button></p>}
      {!custom && !warehouse.catalog && !warehouse.error && <p role="status">OS 포맷 창고를 읽고 있어요.</p>}
      {!custom && galleryEntries.length>0 && <div className="ic-flow-reference">
        <h3>레퍼런스 창고에서 고르기</h3>
        <div className="ic-flow-warehouse-toolbar">
          <label className="ic-field">묶음<select className="field" value={shownGroup} disabled={!!galleryText} onChange={e=>setGalleryGroup(e.target.value)}>
            {galleryGroups.map(group=><option key={group} value={group}>{group} · {galleryEntries.filter(entry=>entry.group===group).length}종</option>)}</select></label>
          <label className="ic-field">레퍼런스 검색<input type="search" className="field" value={galleryQuery} placeholder="이름 또는 번호 · 모든 묶음에서 찾아요"
            onChange={e=>setGalleryQuery(e.target.value)}/></label>
        </div>
        <div className="ic-flow-reference-grid" aria-label="레퍼런스 창고">
          {galleryShown.map(entry=>{
            const url=imageOf(entry), missing=!url || failedReferences.includes(entry.id), selected=entry.id===galleryId;
            return <article className="ic-flow-reference-card" key={entry.id} data-selected={selected}>
              <button className="ic-flow-reference-choice" type="button" disabled={referenceBusy || missing} aria-pressed={selected}
                onClick={()=>{setGalleryId(entry.id);setReferenceError("");}}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the warehouse's own original, never a substitute */}
                {!missing ? <img src={url} alt={`${entry.name} 원본 광고`} loading="lazy" onError={()=>setFailedReferences(old=>old.includes(entry.id)?old:[...old,entry.id])}/>
                  : <span className="ic-flow-reference-missing">{url ? "이미지를 불러오지 못했어요" : "원본 이미지 등록 필요"}</span>}
                <span><strong>{entry.id} · {entry.name}</strong><span>{selected ? "선택됨" : missing ? "선택 불가" : "선택"}</span></span>
              </button>
              <div className="ic-flow-reference-actions">
                <button type="button" className="ic-flow-enlarge" disabled={missing} onClick={()=>{setEnlargedReference({name:entry.name,imageUrl:url,source:entry.source});referenceDialog.current?.showModal();}}>크게 보기</button>
                {entry.source && <a className="ic-flow-enlarge" href={entry.source} target="_blank" rel="noreferrer">광고 출처</a>}
              </div>
            </article>;
          })}
        </div>
        {!galleryShown.length && <p role="status">조건에 맞는 레퍼런스가 없어요. 검색어나 묶음을 바꿔 주세요.</p>}
        {galleryEntry && <div className="ic-row"><button type="button" className="primary-button" disabled={referenceBusy} onClick={()=>void importWarehouseSource(galleryEntry)}>
          {preparing ? "원본을 준비하고 있어요" : "이 디자인으로 시작하기"}</button>
          <span className="ic-muted">{galleryEntry.id} · {galleryEntry.name} 원본에서 바꿀 자리를 자동으로 잡아요.</span></div>}
        {galleryEntry && referenceError && <p role="alert">{referenceError}</p>}
        {referenceDialogView}
        <h3>다른 방법으로 만들기</h3>
      </div>}
      <button type="button" className="secondary-button" disabled={referenceBusy} aria-pressed={custom}
        onClick={()=>{setReferenceError("");setPicked("reference_image");}}>새 레퍼런스 이미지 사용</button>
      {custom && <ReferenceLayoutEditor brand={brief.brand} onPreparing={setPreparing} layout={referenceLayout} onChange={next=>{
        if(next.source.path!==referenceLayout?.source.path){setReferenceSize(undefined);setDetailAssetPath(undefined);}
        setReferenceLayout(next);
      }}
        assets={bundle?.assets ?? []} detail={detail} onDetail={setDetailAssetPath} replacement={photo} onPhoto={path=>setAssetPaths(path?[path]:[])}
        upload={upload} entries={warehouse.catalog?.entries ?? []} disabled={referenceBusy}/>}
      {custom && original && referenceLayout && (photo || !referenceLayout.photo) && (!needsDetail || detail) && saved.appeals?.[0] &&
        <ReferenceComparison sourceUrl={original.url} detailUrl={detail?.url} photo={referenceLayout.photo ? photo?.url : undefined} caption="교체 시안 · 첫 소구점"
          variant={{formatId:"reference_image",formatVersion:1,referenceLayout,detailAsset:detail,brand:referenceLayout.master?.brandSlots?.length ? brief.brand : undefined,size:outputSize,asset:referenceLayout.photo ? photo : undefined,appeal:saved.appeals[0],
            copy:copyDraft?.[0] ?? {headline:saved.appeals[0].meaning,body:"",cta:""},id:"draft",by:"",at:""}}/>}
      {custom && brandIssue && <p role="alert">{brandIssue}</p>}
      {custom && referenceLayout && <label className="ic-field">출력 규격<select className="field" disabled={referenceBusy} value={outputSize}
        onChange={e=>setReferenceSize(e.target.value as CreativeSize)}>{(Object.keys(CREATIVE_SIZES) as CreativeSize[]).map(key=>
          <option key={key} value={key}>{CREATIVE_SIZES[key].label} · {CREATIVE_SIZES[key].width} × {CREATIVE_SIZES[key].height}{key===suggestedSize?" · 원본 비율 추천":""}</option>
        )}</select>
        {Math.abs(referenceLayout.source.w/referenceLayout.source.h-CREATIVE_SIZES[outputSize].width/CREATIVE_SIZES[outputSize].height)>.001 &&
          <small>{referenceLayout.composition ? "선택한 규격에 맞춰 사진과 문구의 위치를 다시 계산합니다." : "원본 전체를 유지하고 비율이 다른 부분에는 여백이 생깁니다."}</small>}
      </label>}
      {custom && <button type="button" className="secondary-button" disabled={referenceBusy} onClick={()=>setPicked(undefined)}>디자인 견본으로 돌아가기</button>}
      {!custom && <ImageFormatPicker reference recommendations={exampleRefs.filter(id=>availableIds.includes(id)).map(id=>({id,reason:IMAGE_FORMATS[id].when}))}
        availableIds={availableIds} references={warehouse.catalog?.entries} selected={picked?[picked]:[]} size={saved.size} disabled={referenceBusy} onSelect={id=>{setReferenceError("");setPicked(id);}}/>}
      {chosenRef && !custom && <><strong>선택한 디자인 · {selectedEntry?.name ?? chosenRef.name}</strong>
        {selectedEntry ? <>
          {hasWarehouseImage ? <button type="button" className="primary-button" disabled={referenceBusy} onClick={()=>void importWarehouseSource()}>
            이 레퍼런스로 제작
          </button> : <p>창고에 원본 이미지가 없어요. 원 광고 파일을 올리거나 아래 견본을 사용하세요.</p>}
          {referenceError && <p role="alert">{referenceError}</p>}
          {selectedEntry.slots && <p>바꿀 요소 · {selectedEntry.slots}</p>}
          <div className="ic-row">
            {selectedEntry.documentId && <a href={warehouseDocumentUrl(selectedEntry.documentId)} target="_blank" rel="noreferrer">창고 원문 · v{selectedEntry.version}</a>}
            {(selectedEntry.originalImageUrl || selectedEntry.thumbnail) && <a href={selectedEntry.originalImageUrl || selectedEntry.thumbnail} target="_blank" rel="noreferrer">원본 광고 보기</a>}
            {selectedEntry.source && <a href={selectedEntry.source} target="_blank" rel="noreferrer">광고 출처</a>}
          </div>
        </> : chosenRef.references[0] && <a target="_blank" rel="noreferrer" href={chosenRef.references[0].url}>출처 보기</a>}
      </>}

      {hasWarehouseImage ? <details className="ic-details"><summary>견본 포맷으로 새로 배치</summary>
        {sampleAssetInput}
        <button type="button" className="secondary-button" disabled={referenceBusy || !referenceReady} onClick={chooseReference}>견본 포맷으로 카피 작성</button>
      </details> : sampleAssetInput}
      <div className="ic-row">{!hasWarehouseImage && <button type="button" className="primary-button" disabled={referenceBusy || !referenceReady}
        onClick={chooseReference}>카피 작성하기</button>}{!approved && <button type="button" className="secondary-button" disabled={referenceBusy} onClick={backToAppeals}>소구점 변경</button>}</div>
    </section>}
    {editingCopy && <ReferenceCopyEditor key={JSON.stringify([format,saved.appeals,batch?.id ?? approved])} format={format} brand={bundle.state.brief.brand} size={approved?.size ?? variants[0]?.size ?? saved.size} referenceName={warehouseChoices.find(entry=>entry.id===approvedPreviewReference?.id)?.name ?? approvedPreviewReference?.name ?? saved.referenceSnapshot?.name}
      flowPreview={!!preview} referenceImageUrl={approvedPreviewReference?.imageUrl}
      appeals={saved.appeals!} draft={copyDraft} initial={copyDraft ?? variants.map(v=>v.copy)} busy={busy} canSuggest={!preview && !batch && (!demo || !!localDirectionPlanner)}
      sourceUrl={format==="reference_image" ? bundle.assets.find(a=>a.path===copyLayout?.source.path)?.url : undefined}
      layout={copyLayout} detail={copyDetail} photo={bundle.assets.find(a=>a.path===copyPhotoPath)}
      hasBody={format!=="reference_image" || Boolean(copyLayout?.body)}
      needsPhoto={!batch && (format==="reference_image" ? !!approved?.referenceLayout?.photo : !!IMAGE_FORMATS[format].assetRequired) && !approved?.assetPaths?.length} pending={!!pendingCopy}
      suggestCopy={suggestCopy} saveDraft={saveDraft} confirm={confirm} run={run} refresh={refresh}
      changeReference={batch || pendingCopy ? undefined : ()=>{setPicked(format);setReferenceLayout(approved?.referenceLayout);setReferenceSize(approved?.size);setAssetPaths(approved?.assetPaths??[]);setDetailAssetPath(approved?.detailAssetPath);setStep(2);}}/>}
  </>;
}

function ReferenceCopyEditor({format,brand,size,referenceName,sourceUrl,layout,photo,detail,hasBody,appeals,draft,initial,busy,canSuggest,needsPhoto,pending,suggestCopy,saveDraft,confirm,run,refresh,changeReference,flowPreview,referenceImageUrl}:{
  layout?:ReferenceLayout;brand?:string;photo?:ImageProjectBundle["assets"][number];detail?:ImageProjectBundle["assets"][number];
  format:ImageFormatId;referenceName?:string;sourceUrl?:string;hasBody:boolean;size:ImageFormatPlan["size"];appeals:Appeal[];draft?:AdCopy[];initial:AdCopy[];busy:boolean;canSuggest:boolean;needsPhoto:boolean;pending:boolean;
  suggestCopy:()=>Promise<AdCopy[]|undefined>;saveDraft:(copies:AdCopy[])=>Promise<void>;confirm:(copies:AdCopy[])=>Promise<void>;run:Props["run"];refresh:()=>void;changeReference?:()=>void;
  flowPreview?:boolean;referenceImageUrl?:string;
}) {
  const [rows,setRows] = useState(appeals.map((_a,i)=>initial[i] ?? {headline:"",body:"",cta:""}));
  const [cta,setCta] = useState(initial[0]?.cta ?? "");
  const [previewIndex,setPreviewIndex]=useState(0);
  const spec=IMAGE_FORMATS[format];
  const copies = rows.map(row=>({...row,cta:cta.trim()}));
  const isSaved = draft?.length === copies.length && copies.every((row,i)=>
    row.headline===draft[i].headline && row.body===draft[i].body && row.cta===draft[i].cta);
  function field(index:number,key:"body"|"headline",value:string) {setRows(old=>old.map((row,i)=>i===index?{...row,[key]:value}:row));}
  return <form className="panel panel-pad-lg ic-panel ic-guided-brief" onSubmit={e=>{e.preventDefault();void run(()=>confirm(copies));}}>
    <h2>{flowPreview ? "카피 확인" : "카피 작성"}</h2>
    {flowPreview && <p className="ic-muted">선택한 소구점을 제목으로 넣은 예시 카피입니다. 전체 문구를 확인·수정하고 확정하면 시안으로 이어집니다.</p>}
    <div className="ic-reference-summary">{format!=="reference_image" && <ImageFormatSample id={format} size={size}/>}<strong>{referenceName ?? spec.name}</strong>
      {/* eslint-disable-next-line @next/next/no-img-element -- chosen original, not a generated result */}
      {flowPreview && referenceImageUrl && <img className="ic-flow-copy-reference" src={referenceImageUrl} alt="선택한 원본 디자인"/>}
      {changeReference && <button className="secondary-button" type="button" disabled={busy} onClick={()=>flowPreview ? void run(async()=>{await saveDraft(copies);changeReference();}) : changeReference()}>{flowPreview ? "레퍼런스로 돌아가기" : "레퍼런스 변경"}</button>}</div>
    {!flowPreview && layout && sourceUrl && (!layout.photo || photo) && (!usesReferenceDetailAsset(layout) || detail) && <div>
      {copies.length>1 && <label className="ic-field">확인할 소구점<select className="field" value={previewIndex}
        onChange={e=>setPreviewIndex(Number(e.target.value))}>{appeals.map((a,i)=><option key={a.id} value={i}>{a.meaning}</option>)}</select></label>}
      <ReferenceComparison sourceUrl={sourceUrl} detailUrl={detail?.url} photo={layout.photo ? photo?.url : undefined} caption="교체 시안 · 작성 중인 카피"
        variant={{formatId:"reference_image",formatVersion:1,referenceLayout:layout,detailAsset:detail,brand:layout.master?.brandSlots?.length ? brand : undefined,size,asset:layout.photo ? photo : undefined,
          appeal:appeals[previewIndex],copy:copies[previewIndex],id:"draft",by:"",at:""}}/>
    </div>}
    {pending ? <div className="ic-row" role="status">AI가 초안을 준비하고 있어요.<button className="secondary-button" type="button" onClick={refresh}>상태 새로고침</button></div>
      : canSuggest && <button className="secondary-button" type="button" disabled={busy || needsPhoto} onClick={()=>void run(async()=>{const values=await suggestCopy();
        if(values){setRows(values);setCta(values[0]?.cta ?? "");}})}>{needsPhoto?"공통 이미지를 먼저 선택해 주세요":"AI 카피 초안 받기"}</button>}
    {needsPhoto && <p>직접 쓰려면 레퍼런스 변경에서 원본 이미지를 올리세요.</p>}
    {appeals.map((appeal,i)=><fieldset disabled={busy || pending} key={appeal.id} className="ic-reference-copy">
      <legend>{appeal.meaning}</legend>
      <label className="ic-field">제목<input className="field" value={rows[i]?.headline ?? ""} required maxLength={spec.limits.headline}
        onChange={e=>field(i,"headline",e.target.value)}/></label>
      {hasBody && <label className="ic-field">본문<textarea className="field" value={rows[i]?.body ?? ""} rows={spec.bodyLines ?? 2} maxLength={spec.limits.body}
        placeholder={spec.bodyLines ? `한 줄에 한 항목씩 ${spec.bodyLines}줄` : undefined} onChange={e=>field(i,"body",e.target.value)}/></label>}
    </fieldset>)}
    <label className="ic-field">버튼 문구<input className="field" disabled={busy || pending} required maxLength={spec.limits.cta} value={cta}
      placeholder="예: 무료 진단 시작하기" onChange={e=>setCta(e.target.value)}/></label>
    <div className="ic-row">
      <button type="button" className="secondary-button" disabled={busy || pending || isSaved}
        onClick={()=>void run(()=>saveDraft(copies))}>초안 저장</button>
      {isSaved && <span role="status">초안 저장됨 · 카피 승인 대기</span>}
      <button className="primary-button" disabled={busy || pending || needsPhoto || rows.some(r=>!r.headline.trim()) || !cta.trim()}>{flowPreview ? "카피 확정 · 시안 보기" : "카피 확정 · 디자인 수정하기"}</button>
    </div>
  </form>;
}

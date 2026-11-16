"use client";

import { useRef, useState, type PointerEvent } from "react";
import { downloadBlob } from "@/lib/image-creative/warehouse-output";
import { applyMasterRecipe, exportMasterRecipe, prepareMasterLayout } from "@/lib/image-creative/analyze-master";
import { analyzeReferenceDesign } from "@/lib/image-creative/analyze-reference";
import { draftReferenceLayout, referenceContains, usesReferenceDetailAsset, REFERENCE_BRAND_SLOT_LIMIT, REFERENCE_DETAIL_SLOT_LIMIT, REFERENCE_MASK_LIMIT, type ReferenceBox, type ReferenceLayout, type ReferenceComposition } from "@/lib/image-creative/reference-layout";
import type { ReferenceEntry } from "@/lib/image-creative/reference-canon";
import type { ImageProjectBundle } from "./image-creative-workspace";
import type { GuidedImageProps } from "./guided-image-creative";

const labels = {photo:"사진",headline:"제목",body:"본문",cta:"버튼"};
type ContentSlot = keyof typeof labels;
type Panel = `panel:${number}`;
type Brand = `brand:${number}`;
type Detail = `detail:${number}`;
type Slot = ContentSlot | "continuation" | Panel | Brand | Detail | number;
function detailSlot(slot:Slot):slot is Detail {return typeof slot==="string" && slot.startsWith("detail:");}
const detailIndex=(key:Detail)=>Number(key.slice(7));
function brandSlot(slot:Slot):slot is Brand {return typeof slot==="string" && slot.startsWith("brand:");}
const brandIndex=(key:Brand)=>Number(key.slice(6));
function panelSlot(slot:Slot):slot is Panel {return typeof slot==="string" && slot.startsWith("panel:");}
const panelIndex=(key:Panel)=>Number(key.slice(6));
function label(slot:Slot) {
  if(detailSlot(slot)) return `그래픽 ${detailIndex(slot)+1}`;
  if(brandSlot(slot)) return `브랜드 ${brandIndex(slot)+1}`;
  return typeof slot==="number" ? `가림 ${slot+1}` : panelSlot(slot) ? `원본 장식 ${panelIndex(slot)+1}` : slot==="continuation" ? "본문 다음 줄" : labels[slot];
}
function selectedBox(layout:ReferenceLayout | undefined, slot:Slot) {
  if(detailSlot(slot)) return layout?.master?.detailSlots?.[detailIndex(slot)];
  if(brandSlot(slot)) return layout?.master?.brandSlots?.[brandIndex(slot)];
  return typeof slot==="number" ? layout?.master?.regions[slot] : panelSlot(slot) ? layout?.master?.keepOverPhoto?.[panelIndex(slot)] : slot==="continuation" ? layout?.master?.bodyContinuation : layout?.[slot];
}
type Asset = ImageProjectBundle["assets"][number];
type Props = {
  layout?: ReferenceLayout; brand?:string; onChange:(next:ReferenceLayout)=>void;
  onPreparing:(pending:boolean)=>void; assets:Asset[]; replacement?:Asset; onPhoto:(path?:string)=>void;
  detail?:Asset; onDetail:(path?:string)=>void;
  upload:GuidedImageProps["upload"]; entries:readonly ReferenceEntry[]; disabled:boolean;
};
const boxKeys = {x:"왼쪽", y:"위쪽", w:"너비", h:"높이"} as const;
const clamp = (v:number,min:number,max:number)=>Math.min(max,Math.max(min,Math.round(v*10)/10));

const maxFileSize = 5 * 1024 * 1024;
async function referenceFile(blob:Blob,name:string) {
  if (blob.size>maxFileSize) throw new Error("5MB 이하 레퍼런스를 선택해 주세요.");
  if (blob.type==="image/png" || blob.type==="image/jpeg") return new File([blob],name,{type:blob.type});
  if (blob.type!=="image/webp") throw new Error("PNG, JPG 또는 WebP 레퍼런스를 선택해 주세요.");
  const image=await createImageBitmap(blob);
  try {
    if (image.width>8192 || image.height>8192 || image.width*image.height>20_000_000) throw new Error("레퍼런스 이미지 크기를 줄여 주세요.");
    const canvas=document.createElement("canvas");
    canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 열 수 없어요.");
    ctx.drawImage(image,0,0);
    const png=await new Promise<Blob|null>(done=>canvas.toBlob(done,"image/png"));
    if (!png || png.size>maxFileSize) throw new Error("변환한 이미지가 5MB를 넘었어요. 원본 크기를 줄여 주세요.");
    return new File([png],name.replace(/\.webp$/i,"")+".png",{type:png.type});
  } finally {image.close();}
}
function ProjectImagePicker({role,assets,source,selected,select,upload,disabled}:{
  role:"photo"|"detail";assets:Asset[];source:Asset;selected?:Asset;select:(path:string)=>void;upload:Props["upload"];disabled:boolean;
}) {
  const photo=role==="photo";
  return <fieldset className="ic-checks" disabled={disabled}><legend>{photo ? "교체할 사진" : "그래픽 원본"}</legend>
    {!photo && <p className="ic-muted">로고·아이콘·화면 요소가 담긴 이미지를 고르세요. 그래픽 칸마다 사용할 부분을 자를 수 있어요.</p>}
    <div className="ic-row">{assets.map((asset,i)=>asset.path!==source.path && <label className="ic-check" key={asset.path}>
      <input type="radio" name={"replacement-"+role} aria-label={(photo ? "이미지 " : "그래픽 원본 ")+(i+1)} checked={selected?.path===asset.path} onChange={()=>select(asset.path)}/>
      {/* eslint-disable-next-line @next/next/no-img-element -- employee project image */}
      <img className="ic-ref-photo-thumb" src={asset.url} alt={"이미지 "+(i+1)} width={64} height={64}/></label>)}
      <label className="secondary-button">{photo ? "교체 사진 올리기" : "그래픽 원본 올리기"}<input type="file" className="ic-sr" accept="image/png,image/jpeg"
        onChange={e=>{void upload(e.currentTarget.files?.[0]??null,asset=>select(asset.path));e.currentTarget.value="";}}/></label>
    </div>
  </fieldset>;
}

function CropEditor({asset,crop,disabled,onChange}:{asset:Asset;crop:ReferenceBox;disabled:boolean;onChange:(crop:ReferenceBox)=>void}) {
  const drag=useRef<{x:number;y:number}|null>(null);
  function point(e:PointerEvent<HTMLDivElement>) {
    const rect=e.currentTarget.getBoundingClientRect();
    return {x:clamp(100*(e.clientX-rect.left)/rect.width,0,100),y:clamp(100*(e.clientY-rect.top)/rect.height,0,100)};
  }
  return <>
    <p className="ic-muted">이미지에서 사용할 부분을 드래그하세요.</p>
    <div className="ic-ref-board ic-detail-source" aria-label="그래픽 원본에서 자를 범위"
      onPointerDown={e=>{if(disabled || e.button!==0)return;drag.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{
        if(disabled || !drag.current) return;
        const {x,y}=point(e), start=drag.current;
        const w=Math.abs(x-start.x),h=Math.abs(y-start.y);
        if(w>=1 && h>=1)onChange({x:Math.min(x,start.x),y:Math.min(y,start.y),w,h});
      }} onLostPointerCapture={()=>{drag.current=null;}}>
      {/* eslint-disable-next-line @next/next/no-img-element -- show the full project-owned source and its actual crop */}
      <img src={asset.url} alt="그래픽 원본에서 선택한 부분" width={asset.w} height={asset.h} draggable={false}/>
      <svg aria-hidden="true" width="100%" height="100%">
        <rect x={crop.x+"%"} y={crop.y+"%"} width={crop.w+"%"} height={crop.h+"%"}/>
      </svg>
    </div>
    <details className="ic-details"><summary>자르는 위치와 크기</summary><div className="ic-ref-numbers">
      {(Object.keys(boxKeys) as (keyof ReferenceBox)[]).map(k=><label className="ic-field" key={k}>원본 {boxKeys[k]} (%)
        <input className="field" type="number" min={k==="x" || k==="y"?0:1} max={100} step="0.1" value={crop[k]}
          onChange={e=>{
            const n=e.target.valueAsNumber, max={x:100-crop.w,y:100-crop.h,w:100-crop.x,h:100-crop.y}[k];
            if(Number.isFinite(n))onChange({...crop,[k]:clamp(n,k==="w" || k==="h"?1:0,max)});
          }}/>
      </label>)}
    </div></details>
  </>;
}

export async function warehouseReferenceFile(entry: ReferenceEntry) {
  const url = entry.originalImageUrl || entry.archivedThumbnail || entry.thumbnail;
  if (!url) throw new Error("창고에 원본 이미지가 없어요. 원 광고에서 받은 파일을 올려 주세요.");
  const response = await fetch(url,{credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(12000)});
  if (!response.ok || Number(response.headers.get("content-length"))>maxFileSize) throw new Error("원 광고 이미지를 불러오지 못했어요.");
  return referenceFile(await response.blob(), entry.id);
}
export async function prepareReferenceDesign(asset:Asset,recipe?:string,brand?:string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = asset.url;
  await image.decode();
  const initial=draftReferenceLayout(asset);
  return recipe ? applyMasterRecipe(image,initial,recipe) : prepareMasterLayout(image,initial,brand);
}
export function ReferenceLayoutEditor({layout,brand,onChange,assets,replacement,onPhoto,detail,onDetail,upload,entries,onPreparing,disabled}:Props) {
  const [slot,setSlot] = useState<Slot>("headline");
  const [warehouseId,setWarehouseId] = useState("");
  const [showWarehouse,setShowWarehouse] = useState(false);
  const [search,setSearch] = useState("");
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{slot:Slot; box:ReferenceBox; x:number; y:number; resize:boolean} | null>(null);
  const request = useRef(0);
  const sourceImage = useRef<HTMLImageElement>(null);
  const source = assets.find(a=>a.path===layout?.source.path);
  const entry = entries.find(a=>a.id===warehouseId);
  const thumbnail = entry?.archivedThumbnail || entry?.thumbnail || entry?.originalImageUrl;
  const matchingEntries=showWarehouse ? entries.filter(row=>(row.id+" "+row.name+" "+row.group).toLowerCase().includes(search.trim().toLowerCase())) : [];
  const [picking,setPicking] = useState<"color"|"texture">();
  const master=layout?.master;
  const active = selectedBox(layout,slot);
  let activeText:ReferenceLayout["body"];
  if(brandSlot(slot))activeText=master?.brandSlots?.[brandIndex(slot)];
  else if(slot==="continuation")activeText=master?.bodyContinuation;
  else if(slot==="headline" || slot==="body" || slot==="cta")activeText=layout?.[slot];
  const slots:Slot[] = (Object.keys(labels) as ContentSlot[]).filter(k=>layout?.[k]);
  if (master?.bodyContinuation) slots.push("continuation");
  if(master?.detailSlots) slots.push(...master.detailSlots.map((_,i):Detail=>`detail:${i}`));
  if(master?.brandSlots) slots.push(...master.brandSlots.map((_,i):Brand=>`brand:${i}`));
  if (master) slots.push(...master.regions.map((_,i)=>i),...(master.keepOverPhoto ?? []).map((_,i):Panel=>`panel:${i}`));
  const photoInDetails = master?.detailSlots?.some(box=>box.source==="photo");
  const selectedDetail=detailSlot(slot) ? master?.detailSlots?.[detailIndex(slot)] : undefined;
  const cropSource=selectedDetail?.source==="photo" ? replacement : detail;
  const busy = disabled || loading;
  async function selectSource(asset:Asset,recipe?:string) {
    if (asset.path===source?.path) return;
    const current=++request.current;
    setLoading(true);onPreparing(true);setError("");
    try {
      const analyzed=await prepareReferenceDesign(asset,recipe,brand);
      if(current!==request.current) return;
      if(replacement?.path===asset.path) onPhoto();
      onChange(analyzed);setSlot("headline");setPicking(undefined);
    } catch(cause) {
      if(current===request.current) setError(cause instanceof Error ? cause.message : "원본 이미지를 읽지 못했어요. 파일을 다시 선택해 주세요.");
    } finally {if(current===request.current) {setLoading(false);onPreparing(false);}}
  }
  async function importSource(file?:File) {
    if (busy || (!file && !thumbnail)) return;
    setLoading(true);setError("");onPreparing(true);
    try {
      await upload(file ? await referenceFile(file,file.name) : await warehouseReferenceFile(entry!), asset=>selectSource(asset,file ? undefined : entry?.masterRecipe));
    } catch (cause) {
      setError(file ? (cause instanceof Error ? cause.message : "이미지를 읽지 못했어요.")
        : "창고 원본을 가져오지 못했어요. 원 광고의 PNG, JPG 또는 WebP 파일을 저장해 올려 주세요.");
    } finally {setLoading(false);onPreparing(false);}
  }
  function editBox(key:Slot, patch:Partial<NonNullable<ReferenceLayout["body"]>> & {radius?:number; crop?:ReferenceBox; fit?:"contain"|"cover";source?:"detail"|"photo"}) {
    if(!layout || !selectedBox(layout,key)) return;
    if(typeof key==="number" && master) {
      const regions=master.regions.map((r,i)=>{
        if(i!==key)return r;
        const next={...r,...patch};
        if(next.sample)next.sample={...next.sample,x:Math.min(next.sample.x,100-next.w),y:Math.min(next.sample.y,100-next.h)};
        return next;
      });
      onChange({...layout,master:{...master,regions}});
    } else if(panelSlot(key) && master?.keepOverPhoto) {
      onChange({...layout,master:{...master,keepOverPhoto:master.keepOverPhoto.map((r,i)=>i===panelIndex(key) ? {...r,...patch} : r)}});
    } else if(detailSlot(key) && master?.detailSlots) {
      onChange({...layout,master:{...master,detailSlots:master.detailSlots.map((box,i)=>i===detailIndex(key) ? {...box,...patch} : box)}});
    } else if(brandSlot(key) && master?.brandSlots) {
      onChange({...layout,master:{...master,brandSlots:master.brandSlots.map((r,i)=>i===brandIndex(key) ? {...r,...patch} : r)}});
    } else if(key==="continuation" && master?.bodyContinuation) {
      onChange({...layout,master:{...master,bodyContinuation:{...master.bodyContinuation,...patch}}});
    } else if(typeof key==="string" && key!=="continuation" && !panelSlot(key) && !brandSlot(key) && !detailSlot(key)) onChange({...layout,[key]:{...layout[key],...patch}});
  }
  function addMask() {
    if(!layout || !master || master.regions.length>=REFERENCE_MASK_LIMIT) return;
    onChange({...layout,master:{...master,regions:[...master.regions,{x:35,y:7,w:30,h:9,fill:master.background}]}});
    setSlot(master.regions.length);setPicking(undefined);
  }
  function deleteMask() {
    if(!layout || !master || typeof slot!=="number") return;
    onChange({...layout,master:{...master,regions:master.regions.filter((_,i)=>i!==slot)}});
    setSlot("headline");setPicking(undefined);
  }
  function addPanel() {
    if(!layout?.photo || !master) return;
    const panels=master.keepOverPhoto ?? [];
    if(panels.length>=REFERENCE_MASK_LIMIT) return;
    const {x,y,w,h}=layout.photo;
    onChange({...layout,master:{...master,keepOverPhoto:[...panels,{x,y,w:Math.max(1,w/2),h:Math.max(1,h/2)}]}});
    setSlot(`panel:${panels.length}`);setPicking(undefined);
  }
  function deletePanel() {
    if(!layout || !master?.keepOverPhoto || !panelSlot(slot)) return;
    const panels=master.keepOverPhoto.filter((_,i)=>i!==panelIndex(slot));
    const next={...master}; if(panels.length) next.keepOverPhoto=panels; else delete next.keepOverPhoto;
    onChange({...layout,master:next});setSlot("headline");
  }
  function addDetail() {
    if (!layout || !master) return;
    const slots=master.detailSlots ?? [];
    if (slots.length>=REFERENCE_DETAIL_SLOT_LIMIT) return;
    const box={x:8,y:8,w:18,h:12,crop:{x:0,y:0,w:100,h:100}};
    onChange({...layout,master:{...master,detailSlots:[...slots,box]}});
    setSlot(`detail:${slots.length}`); setPicking(undefined);
  }
  function deleteDetail() {
    if (!layout || !master?.detailSlots || !detailSlot(slot)) return;
    const slots=master.detailSlots.filter((_,i)=>i!==detailIndex(slot));
    const next={...master};
    if (slots.length) next.detailSlots=slots;
    else {delete next.detailSlots;onDetail();}
    onChange({...layout,master:next});setSlot("headline");
  }
  function addBrand() {
    if(!layout || !master || !brand?.trim())return;
    const fields=master.brandSlots ?? [];
    if(fields.length>=REFERENCE_BRAND_SLOT_LIMIT)return;
    const first={...layout.headline,x:12,y:5,w:76,h:6,fontSize:34,fill:master.background,align:"center" as const};
    onChange({...layout,master:{...master,brandSlots:[...fields,first]}});
    setSlot(`brand:${fields.length}`);setPicking(undefined);
  }
  function deleteBrand() {
    if(!layout || !master?.brandSlots || !brandSlot(slot))return;
    const fields=master.brandSlots.filter((_,i)=>i!==brandIndex(slot));
    const next={...master};if(fields.length)next.brandSlots=fields;else delete next.brandSlots;
    onChange({...layout,master:next});setSlot("headline");setPicking(undefined);
  }
  function toggleContinuation(enabled:boolean) {
    if(!layout?.body || !master) return;
    const next={...master};
    if(enabled) next.bodyContinuation={...layout.body,y:Math.min(100-layout.body.h,layout.body.y+layout.body.h)};
    else delete next.bodyContinuation;
    onChange({...layout,master:next});setSlot(enabled ? "continuation" : "body");setPicking(undefined);
  }
  async function recipe(file?:File) {
    if(!layout?.master || !sourceImage.current || busy) return;
    setLoading(true);onPreparing(true);setError("");
    try {
      if(file) {
        if(file.size>32*1024) throw new Error("32KB 이하의 교체 위치 파일을 선택해 주세요.");
        const next=await applyMasterRecipe(sourceImage.current,layout,await file.text());
        onChange(next);setSlot("headline");setPicking(undefined);
        if(!next.photo) onPhoto();
      } else {
        const data=await exportMasterRecipe(sourceImage.current,layout);
        downloadBlob(new Blob([data],{type:"application/json"}),"교체-위치.json");
      }
    } catch (cause) {setError(cause instanceof Error ? cause.message : "교체 위치 파일을 확인해 주세요.");}
    finally {setLoading(false);onPreparing(false);}
  }
  function changeMask(fill?:string,sample?:{x:number;y:number;flipX?:boolean}) {
    if(!layout || !master || typeof slot!=="number")return;
    const regions=master.regions.map((region,i)=>{
      if(i!==slot)return region;
      const next={...region};
      if(fill)next.fill=fill;
      if(sample)next.sample=sample;else delete next.sample;
      return next;
    });
    onChange({...layout,master:{...master,regions}});
  }
  function sampleColor(event:PointerEvent<HTMLDivElement>) {
    const image=sourceImage.current;
    if(!picking || !image || !active) return;
    event.preventDefault();event.stopPropagation();
    const rect=image.getBoundingClientRect();
    const sx=Math.max(0,Math.min(image.naturalWidth-1,Math.floor((event.clientX-rect.left)*image.naturalWidth/rect.width)));
    const sy=Math.max(0,Math.min(image.naturalHeight-1,Math.floor((event.clientY-rect.top)*image.naturalHeight/rect.height)));
    if(picking==="texture") {
      changeMask(undefined,{x:clamp(sx*100/image.naturalWidth,0,100-active.w),y:clamp(sy*100/image.naturalHeight,0,100-active.h)});
      setPicking(undefined);return;
    }
    try {
      const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
      const ctx=canvas.getContext("2d");if(!ctx) throw new Error();
      ctx.fillStyle="#ffffff";ctx.fillRect(0,0,1,1);ctx.drawImage(image,sx,sy,1,1,0,0,1,1);
      const color=Array.from(ctx.getImageData(0,0,1,1).data.slice(0,3),c=>c.toString(16).padStart(2,"0")).join("");
      changeMask("#"+color);
    } catch {setError("색을 읽지 못했어요. 색상 입력으로 선택해 주세요.");}
    setPicking(undefined);
  }
  function setCoordinate(key:keyof ReferenceBox,value:number) {
    if (!active || !Number.isFinite(value)) return;
    const max={x:100-active.w,y:100-active.h,w:100-active.x,h:100-active.y}[key];
    editBox(slot,{...active,[key]:clamp(value,key==="w"||key==="h"?1:0,max)});
  }
  function start(event:PointerEvent<HTMLButtonElement>,name:Slot) {
    const box=selectedBox(layout,name);
    if (!box || busy || picking || event.button!==0) return;
    event.preventDefault();event.currentTarget.focus();board.current?.setPointerCapture(event.pointerId);
    setSlot(name);
    drag.current={slot:name, box,x:event.clientX,y:event.clientY,resize:(event.target as HTMLElement).dataset.resize==="yes"};
  }
  function move(event:PointerEvent<HTMLDivElement>) {
    if (!drag.current || !board.current) return;
    const {box,slot:name,x,y,resize}=drag.current;
    const rect=board.current.getBoundingClientRect();
    const dx=(event.clientX-x)*100/rect.width,dy=(event.clientY-y)*100/rect.height;
    editBox(name, resize
      ? {...box,w:clamp(box.w+dx,1,100-box.x),h:clamp(box.h+dy,1,100-box.y)}
      : {...box,x:clamp(box.x+dx,0,100-box.w),y:clamp(box.y+dy,0,100-box.h)});
  }
  function toggle(key:"photo"|"body",enabled:boolean) {
    if (!layout || (key==="photo" && !enabled && photoInDetails)) return;

    const next={...layout};
    if (enabled) Object.assign(next,{[key]:draftReferenceLayout(layout.source)[key]});
    else delete next[key];

    if(key==="body" && !enabled && next.master){ next.master={...next.master}; delete next.master.bodyContinuation; }
    if (key==="photo" && !enabled) {
      onPhoto();
      if(next.master){next.master={...next.master};delete next.master.keepOverPhoto;delete next.master.photoFit;}
      for (const field of ["headline","body","cta"] as const) {
        const text=next[field];
        if (!master && text?.fill==="transparent") next[field]={...text,fill:"#ffffff"};
      }
    }
    setSlot(enabled?key:"headline");setPicking(undefined);onChange(next);
  }

  const composition=layout?.composition;
  function changeComposition(patch:Partial<ReferenceComposition>) {
    if(layout && composition) onChange({...layout,composition:{...composition,...patch}});
  }
  const previousDesign = useRef<ReferenceLayout | undefined>(undefined);
  async function switchMode() {
    if (!layout || !sourceImage.current) return;
    const initial = draftReferenceLayout(layout.source);
    setLoading(true);onPreparing(true);
    try {
      const cached=previousDesign.current;
      const next = cached?.source.path===layout.source.path && Boolean(cached.composition)!==Boolean(composition)
        ? {...cached} : composition ? await prepareMasterLayout(sourceImage.current,initial,brand,"edit-original") : analyzeReferenceDesign(sourceImage.current,initial);
      previousDesign.current=layout;
      if(!layout.photo) {delete next.photo; if(next.master){next.master={...next.master};delete next.master.keepOverPhoto;delete next.master.photoFit;}}
      if(!layout.body) { delete next.body; if(next.master){next.master={...next.master};delete next.master.bodyContinuation;} }
      setSlot("headline");setPicking(undefined);onChange(next);setError("");
    } catch {setError("원본 이미지를 읽지 못했어요. 파일을 다시 올려 주세요.");}
    finally {setLoading(false);onPreparing(false);}
  }
  const invalidOverlay=layout && !master && (["headline","body","cta"] as const).find(name=>{
    const box=layout[name];
    return box?.fill==="transparent" && (!layout.photo || !referenceContains(layout.photo,box));
  });
  return <div className="ic-ref-editor">
    <div className="ic-row">
      <label className="secondary-button">레퍼런스 원본 올리기<input type="file" className="ic-sr" accept="image/png,image/jpeg,image/webp" disabled={busy}
        onChange={e=>{const file=e.currentTarget.files?.[0];if(file)void importSource(file);e.currentTarget.value="";}}/></label>
      {assets.length>0 && <label className="ic-field">등록된 원본 선택<select className="field" disabled={busy} value={source?.path??""}
        onChange={e=>{const asset=assets.find(a=>a.path===e.target.value);if(asset)selectSource(asset);}}>
        <option value="" disabled>프로젝트 이미지 선택</option>{assets.map((a,i)=><option key={a.path} value={a.path}>이미지 {i+1} · {a.w} × {a.h}</option>)}
      </select></label>}
    </div>
    {!!entries.length && <details className="ic-details" onToggle={e=>setShowWarehouse(e.currentTarget.open)}><summary>창고에서 원본 가져오기 · {entries.length}개</summary>
      {showWarehouse && <><label className="ic-field">창고 검색<input className="field" type="search" placeholder="이름 또는 번호" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <div className="ic-ref-warehouse-grid" aria-label="창고 레퍼런스">
          {matchingEntries.map(row=><button className="ic-format-choice" type="button" key={row.id} disabled={busy} aria-pressed={row.id===warehouseId}
            onClick={()=>{setWarehouseId(row.id);setError("");}}>
            {(row.archivedThumbnail || row.thumbnail || row.originalImageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element -- current warehouse design
              <img src={row.archivedThumbnail || row.thumbnail || row.originalImageUrl} loading="lazy" referrerPolicy="no-referrer" alt=""/>
            )}
            <span>{row.id} · {row.name}</span>
          </button>)}
        </div>{!matchingEntries.length && <p>검색 결과가 없어요.</p>}</>}
    </details>}
    {entry && <div className="ic-row">
        {thumbnail && <>
          {/* eslint-disable-next-line @next/next/no-img-element -- original warehouse advertisement */}
          <img className="ic-ref-origin-thumb" alt={entry.name} src={thumbnail} referrerPolicy="no-referrer"/>
          <button type="button" className="secondary-button" disabled={busy} onClick={()=>void importSource()}>{loading?"가져오는 중…":"이 원본 가져오기"}</button></>}
        {(entry.source || entry.thumbnail) && <a href={entry.source || entry.thumbnail} target="_blank" rel="noreferrer">원 광고 열기</a>}
        {!thumbnail && <span>원 광고의 이미지를 저장해 올려 주세요.</span>}
      </div>}
    {error && <p role="alert">{error}</p>}
    {invalidOverlay && <p role="alert">{labels[invalidOverlay]} 영역을 사진 안에 맞추거나 ‘사진 위 글자’를 해제해 주세요.</p>}
    {source && layout && <>
      <p>{master?.base==="solid" ? "원본의 제목·사진·버튼 배치에 맞춰 내 광고를 구성했어요. 영역을 선택해 위치와 서식을 수정할 수 있어요." : master ? "원본에서 문구·사진 칸을 옮기거나 모서리를 당겨 맞추세요. 로고나 남은 문구는 가릴 영역을 추가하세요." : composition ? "원본에서 읽은 구도와 색으로 내 사진과 카피를 배치합니다." : "원본 위의 교체 영역을 옮기거나 오른쪽 아래 모서리를 당겨 크기를 맞추세요."}</p>
      <div className="ic-ref-layout">
        <div className="ic-ref-board" ref={board} data-picking={!!picking} onPointerDownCapture={sampleColor} onPointerMove={move} onLostPointerCapture={()=>{drag.current=null;}}>
          {/* eslint-disable-next-line @next/next/no-img-element -- editable pixel map of the employee's reference */}
          <img ref={sourceImage} src={source.url} alt="레퍼런스 원본과 교체 영역" width={source.w} height={source.h} crossOrigin="anonymous" draggable={false}/>
          {!composition && <svg className="ic-ref-overlay" width="100%" height="100%" aria-label="교체 영역">
          {slots.slice().sort((a,b)=>Number(a===slot)-Number(b===slot)).map(name=>{
            const box=selectedBox(layout,name);
            return box && <foreignObject key={name} x={box.x+"%"} y={box.y+"%"} width={box.w+"%"} height={box.h+"%"}>
              <button type="button" className="ic-ref-box" aria-label={label(name)+" 영역"} aria-pressed={slot===name} disabled={busy}
              onClick={()=>setSlot(name)} onPointerDown={e=>start(e,name)}>
              <span>{label(name)}</span><i data-resize="yes" aria-hidden="true"/></button></foreignObject>;
          })}</svg>}
        </div>
        <div className="ic-ref-controls">
          <div className="ic-row">
            <label><input type="checkbox" disabled={busy || photoInDetails} checked={Boolean(layout.photo)} onChange={e=>toggle("photo",e.target.checked)}/> 사진 교체</label>
            <label><input type="checkbox" disabled={busy} checked={Boolean(layout.body)} onChange={e=>toggle("body",e.target.checked)}/> 본문 교체</label>
          </div>
          {photoInDetails && <p className="ic-muted">그래픽에도 교체할 사진을 사용합니다.</p>}
          {composition ? <fieldset className="ic-ref-type" disabled={busy}><legend>추천 디자인</legend>
            {layout.photo && <>
              <label className="ic-field">구도<select className="field" value={composition.style} onChange={e=>changeComposition({style:e.target.value as ReferenceComposition["style"]})}>
                <option value="stack">사진과 문구 위아래</option><option value="split">사진과 문구 나란히</option><option value="overlay">사진 위에 문구</option>
              </select></label>
              {composition.style!=="overlay" && <label className="ic-field">사진이 차지하는 비율
                <input type="range" min={32} max={65} value={Math.round((composition.imageShare ?? (composition.style==="split"?.46:.51))*100)}
                  onChange={e=>changeComposition({imageShare:Number(e.target.value)/100})}/>
              </label>}
              <label className="ic-field">사진 위치<select className="field" value={composition.imageSide} onChange={e=>changeComposition({imageSide:e.target.value as ReferenceComposition["imageSide"]})}>
                <option value="start">{composition.style==="split"?"왼쪽":"위"}</option><option value="end">{composition.style==="split"?"오른쪽":"아래"}</option>
              </select></label>
              <label className="ic-field">사진 맞춤<select className="field" value={composition.fit} onChange={e=>changeComposition({fit:e.target.value as ReferenceComposition["fit"]})}>
                <option value="contain">전체 보이기</option><option value="cover">영역 채우기</option>
              </select></label>
              {composition.fit==="cover" && <details className="ic-details"><summary>사진 자르기 위치</summary>
                {(["focusX","focusY"] as const).map(k=><label className="ic-field" key={k}>{k==="focusX"?"좌우 중심":"상하 중심"}
                  <input type="range" min={0} max={100} value={composition[k] ?? 50} onChange={e=>changeComposition({[k]:Number(e.target.value)})}/>
                </label>)}
              </details>}
            </>}
            <label className="ic-field">제목 굵기<select className="field" value={composition.headlineWeight ?? 900} onChange={e=>changeComposition({headlineWeight:Number(e.target.value) as 600|900})}>
              <option value={600}>중간</option><option value={900}>굵게</option>
            </select></label>
            <label className="ic-field">버튼 표현<select className="field" value={composition.buttonStyle ?? "solid"} onChange={e=>changeComposition({buttonStyle:e.target.value as ReferenceComposition["buttonStyle"]})}>
              <option value="solid">둥근 버튼</option><option value="square">사각 버튼</option><option value="text">밑줄 문구</option>
            </select></label>
            <div className="ic-row">{(["background","ink","accent"] as const).filter(k=>!(layout.photo && composition.style==="overlay" && k==="ink") && !(k==="accent" && composition.buttonStyle==="text" && composition.style!=="split")).map(k=>
              <label className="ic-field" key={k}>{{background:"바탕색",ink:"글자색",accent:"버튼색"}[k]}
                <input type="color" value={composition[k]} onChange={e=>changeComposition({[k]:e.target.value})}/>
              </label>)}</div>
          </fieldset> : <>
          {master && <div className="ic-row">
            <button type="button" className="secondary-button" disabled={busy || master.regions.length>=REFERENCE_MASK_LIMIT} onClick={addMask}>가릴 영역 추가</button>
            <button type="button" className="secondary-button" disabled={busy || (master.detailSlots?.length ?? 0)>=REFERENCE_DETAIL_SLOT_LIMIT} onClick={addDetail}>그래픽 칸 추가</button>
            {brand?.trim() && <button type="button" className="secondary-button" disabled={busy || (master.brandSlots?.length ?? 0)>=REFERENCE_BRAND_SLOT_LIMIT} onClick={addBrand}>브랜드 칸 추가</button>}
            {layout.photo && <button type="button" className="secondary-button" disabled={busy || (master.keepOverPhoto?.length ?? 0)>=REFERENCE_MASK_LIMIT} onClick={addPanel}>사진 위에 원본 장식 유지</button>}
            {layout.body && <label><input type="checkbox" disabled={busy} checked={!!master.bodyContinuation} onChange={e=>toggleContinuation(e.target.checked)}/> 본문 두 칸에 나누기</label>}
          </div>}
          <label className="ic-field">편집할 영역<select className="field" disabled={busy} value={slot} onChange={e=>{
            const key=slots.find(k=>String(k)===e.target.value);if(key!==undefined){setSlot(key);setPicking(undefined);}
          }}>
            {slots.map(k=><option value={k} key={k}>{label(k)}</option>)}
          </select></label>
          {active && <details className="ic-details"><summary>위치와 크기 조정</summary>
            <div className="ic-ref-numbers">{(Object.keys(boxKeys) as (keyof ReferenceBox)[]).map(k=><label key={k} className="ic-field">{boxKeys[k]} (%)
              <input className="field" type="number" min={k==="x"||k==="y"?0:1} max={100} step="0.1" disabled={busy} value={active[k]}
                onChange={e=>setCoordinate(k,e.target.valueAsNumber)}/></label>)}</div></details>}
          {slot==="photo" && master && <label className="ic-field">사진 맞춤<select className="field" disabled={busy}
            value={master.photoFit ?? "cover"} onChange={e=>{
              const next={...master};
              if(e.target.value==="contain") next.photoFit="contain"; else delete next.photoFit;
              onChange({...layout,master:next});
            }}>
            <option value="contain">전체 보이기</option><option value="cover">영역 채우기</option>
          </select></label>}
          {slot==="photo" && master && !master.photoFit && <label className="ic-field">사진 자르기 기준<select className="field" disabled={busy}
            value={master.photoAlign ?? (master.keepOverPhoto?.length ? "center" : "top")}
            onChange={e=>onChange({...layout,master:{...master,photoAlign:e.target.value as "top"|"center"}})}>
            <option value="top">위쪽</option><option value="center">가운데</option>
          </select></label>}
          {selectedDetail && <fieldset className="ic-ref-type" disabled={busy}><legend>{label(slot)}에 사용할 부분</legend>
            <label className="ic-field">그래픽에 사용할 이미지<select className="field" value={selectedDetail.source ?? "detail"}
              onChange={e=>editBox(slot,{source:e.target.value as "detail"|"photo"})}>
              <option value="detail">별도 그래픽 원본</option><option value="photo" disabled={!layout.photo}>교체할 사진</option>
            </select></label>
            {cropSource && <CropEditor asset={cropSource} crop={selectedDetail.crop} disabled={busy} onChange={crop=>editBox(slot,{crop})}/>}
            <label className="ic-field">그래픽 맞춤<select className="field" value={selectedDetail.fit ?? "contain"}
              onChange={e=>editBox(slot,{fit:e.target.value as "contain"|"cover"})}>
              <option value="contain">전체 보이기</option><option value="cover">칸 채우기</option>
            </select></label>
            <label className="ic-field">그래픽 모서리 둥글기 (%)<input className="field" type="number" min={0} max={50} value={selectedDetail.radius ?? 0}
              onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))editBox(slot,{radius:clamp(e.target.valueAsNumber,0,50)});}}/></label>
            <button type="button" className="secondary-button" onClick={deleteDetail}>그래픽 칸 삭제</button>
          </fieldset>}
          {panelSlot(slot) && master?.keepOverPhoto?.[panelIndex(slot)] && <fieldset className="ic-ref-type" disabled={busy}><legend>{label(slot)}</legend>
            <label className="ic-field">모서리 둥글기 (%)<input className="field" type="number" min={0} max={50}
              value={master.keepOverPhoto[panelIndex(slot)].radius ?? 0}
              onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))editBox(slot,{radius:clamp(e.target.valueAsNumber,0,50)});}}/></label>
            <button type="button" className="secondary-button" onClick={deletePanel}>장식 영역 삭제</button>
          </fieldset>}
          {typeof slot==="number" && master?.regions[slot] && <fieldset className="ic-ref-type" disabled={busy}><legend>{label(slot)}</legend>
            <label className="ic-field">가림색<input type="color" value={master.regions[slot].fill} onChange={e=>changeMask(e.target.value)}/></label>
            <button type="button" className="secondary-button" aria-pressed={picking==="color"} onClick={()=>setPicking(picking==="color"?undefined:"color")}>
              {picking==="color" ? "배경색을 클릭하세요 · 취소" : "원본에서 색 찍기"}
            </button>
            <button type="button" className="secondary-button" aria-pressed={picking==="texture"} onClick={()=>setPicking(picking==="texture"?undefined:"texture")}>
              {picking==="texture" ? "복사할 부분의 왼쪽 위를 클릭하세요 · 취소" : "원본 무늬로 가리기"}
            </button>
            {master.regions[slot].sample && <>
              <div className="ic-ref-numbers">{(["x","y"] as const).map(axis=>{
                const region=master.regions[slot],sample=region.sample!;
                const max=100-(axis==="x"?region.w:region.h);
                return <label className="ic-field" key={axis}>복사할 {axis==="x"?"왼쪽":"위쪽"} (%)
                  <input className="field" type="number" min={0} max={max} step="0.1" value={sample[axis]}
                    onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))changeMask(undefined,{...sample,[axis]:clamp(e.target.valueAsNumber,0,max)});}}/></label>;
              })}</div>
              <label><input type="checkbox" checked={!!master.regions[slot].sample?.flipX} onChange={e=>{
                const sample=master.regions[slot].sample;if(sample)changeMask(undefined,{...sample,flipX:e.target.checked});
              }}/> 복사한 무늬 좌우 반전</label>
              <button type="button" className="secondary-button" onClick={()=>changeMask()}>단색으로 가리기</button>
            </>}
            <button type="button" className="secondary-button" onClick={deleteMask}>가림 삭제</button>
          </fieldset>}
          {master?.brandSlots?.length ? <p className="ic-muted">상품 브랜드 · {brand || "상품에서 브랜드명을 확인해 주세요"}</p> : null}
          {activeText && <fieldset className="ic-ref-type" disabled={busy}><legend>{label(slot)} 서식</legend>
            {slot==="headline" && master?.headlineAccent && <label className="ic-field">제목 강조색
              <input type="color" value={master.headlineAccent} onChange={e=>onChange({...layout,master:{...master,headlineAccent:e.target.value}})}/>
            </label>}
            {(master || (layout.photo && (referenceContains(layout.photo,activeText) || activeText.fill==="transparent"))) && <label>
              <input type="checkbox" checked={activeText.fill==="transparent"} onChange={e=>editBox(slot,{fill:e.target.checked?"transparent":master?.background ?? "#ffffff"})}/> {master ? "바탕을 유지하고 글자만 올리기" : "사진 위 글자 (배경 없음)"}</label>}
            <div className="ic-row">{(["fill","color"] as const).filter(k=>k!=="fill" || activeText.fill!=="transparent").map(k=><label className="ic-field" key={k}>{k==="fill"?"덮을 바탕색":"글자색"}
              <input type="color" value={activeText[k]} onChange={e=>editBox(slot,{[k]:e.target.value})}/></label>)}</div>
            <label className="ic-field">글자 크기<input type="number" className="field" min={12} max={200} value={activeText.fontSize}
              onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))editBox(slot,{fontSize:clamp(e.target.valueAsNumber,12,200)});}}/></label>
            {master && <label className="ic-field">{label(slot)} 굵기<select className="field"
              value={activeText.weight ?? (slot==="headline" ? master.headlineWeight : slot==="body" || slot==="continuation" ? 400 : 600)}
              onChange={e=>editBox(slot,{weight:Number(e.target.value) as 400|600|900})}>
              <option value={400}>보통</option><option value={600}>중간</option><option value={900}>굵게</option>
            </select></label>}
            <label className="ic-field">정렬<select className="field" value={activeText.align}
              onChange={e=>editBox(slot,{align:e.target.value as "left"|"center"|"right"})}>
              <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
            </select></label>
            {brandSlot(slot) && <button type="button" className="secondary-button" onClick={deleteBrand}>브랜드 칸 삭제</button>}
          </fieldset>}
          </>}
          <button type="button" className="secondary-button" disabled={busy} onClick={switchMode}>
            {composition ? "원본의 교체 영역 편집" : "새 구도로 다시 배치"}
          </button>
        </div>
      </div>
      {master && <details className="ic-details"><summary>같은 원본에 교체 위치 재사용</summary>
        <div className="ic-row">
          <button type="button" className="secondary-button" disabled={busy} onClick={()=>void recipe()}>교체 위치 저장</button>
          <label className="secondary-button">저장한 교체 위치 적용<input type="file" className="ic-sr" accept=".json,application/json" disabled={busy}
            onChange={e=>{const file=e.target.files?.[0];if(file)void recipe(file);e.target.value="";}}/></label>
        </div>
      </details>}
      {layout.photo && <ProjectImagePicker role="photo" assets={assets} source={source} selected={replacement} select={onPhoto} upload={upload} disabled={busy}/>}
      {usesReferenceDetailAsset(layout) && <ProjectImagePicker role="detail" assets={assets} source={source} selected={detail} select={onDetail} upload={upload} disabled={busy}/>}
    </>}
  </div>;
}

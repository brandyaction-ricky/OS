"use client";

import { useRef, useState } from "react";
import { draftReferenceLayout, type ReferenceLayout } from "@/lib/image-creative/reference-layout";
import type { ReferenceEntry } from "@/lib/image-creative/reference-canon";
import type { ImageProjectBundle } from "./image-creative-workspace";
import type { GuidedImageProps } from "./guided-image-creative";

type Asset = ImageProjectBundle["assets"][number];
type Props = {
  layout?: ReferenceLayout; onChange:(next:ReferenceLayout)=>void;
  onPreparing:(pending:boolean)=>void; assets:Asset[]; replacement?:Asset; onPhoto:(path?:string)=>void;
  upload:GuidedImageProps["upload"]; entries:readonly ReferenceEntry[]; disabled:boolean;
};
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
export async function warehouseReferenceFile(entry: ReferenceEntry) {
  const url = entry.originalImageUrl || entry.archivedThumbnail || entry.thumbnail;
  if (!url) throw new Error("창고에 원본 이미지가 없어요. 원 광고에서 받은 파일을 올려 주세요.");
  const response = await fetch(url,{credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(12000)});
  if (!response.ok || Number(response.headers.get("content-length"))>maxFileSize) throw new Error("원 광고 이미지를 불러오지 못했어요.");
  return referenceFile(await response.blob(), entry.id);
}
export async function prepareReferenceDesign(asset:Asset):Promise<ReferenceLayout> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = asset.url;
  await image.decode();
  return {...draftReferenceLayout(asset),reproduction:"image-ai"};
}
export function ReferenceLayoutEditor({layout,onChange,assets,replacement,onPhoto,upload,entries,onPreparing,disabled}:Props) {
  const [warehouseId,setWarehouseId] = useState("");
  const [showWarehouse,setShowWarehouse] = useState(false);
  const [search,setSearch] = useState("");
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const request = useRef(0);
  const source = assets.find(a=>a.path===layout?.source.path);
  const entry = entries.find(a=>a.id===warehouseId);
  const thumbnail = entry?.archivedThumbnail || entry?.thumbnail || entry?.originalImageUrl;
  const matchingEntries=showWarehouse ? entries.filter(row=>(row.id+" "+row.name+" "+row.group).toLowerCase().includes(search.trim().toLowerCase())) : [];
  const busy = disabled || loading;
  async function selectSource(asset:Asset) {
    if (asset.path===source?.path) return;
    const current=++request.current;
    setLoading(true);onPreparing(true);setError("");
    try {
      const analyzed=await prepareReferenceDesign(asset);
      if(current!==request.current) return;
      if(replacement?.path===asset.path) onPhoto();
      onChange(analyzed);
    } catch(cause) {
      if(current===request.current) setError(cause instanceof Error ? cause.message : "원본 이미지를 읽지 못했어요. 파일을 다시 선택해 주세요.");
    } finally {if(current===request.current) {setLoading(false);onPreparing(false);}}
  }
  async function importSource(file?:File) {
    if (busy || (!file && !thumbnail)) return;
    setLoading(true);setError("");onPreparing(true);
    try {
      await upload(file ? await referenceFile(file,file.name) : await warehouseReferenceFile(entry!), asset=>selectSource(asset));
    } catch (cause) {
      setError(file ? (cause instanceof Error ? cause.message : "이미지를 읽지 못했어요.")
        : "창고 원본을 가져오지 못했어요. 원 광고의 PNG, JPG 또는 WebP 파일을 저장해 올려 주세요.");
    } finally {setLoading(false);onPreparing(false);}
  }
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
    {source && <>
      <p>원본 전체를 이미지 AI에 전달합니다. 배치·색·장식을 유지하고 확정한 문구와 상품 자료만 바꿉니다.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- the full selected original is the generation input */}
      <img className="ic-compare-photo" src={source.url} alt="AI에 전달할 레퍼런스 원본 전체" width={source.w} height={source.h}/>
      <details className="ic-details"><summary>상품 이미지 추가 (선택)</summary>
        <p>교체할 상품 사진·보고서가 있을 때만 고르세요. 선택하지 않으면 원본의 그림과 장식을 유지합니다.</p>
        <fieldset className="ic-checks" disabled={busy}><legend>광고에 넣을 상품 이미지</legend>
          <div className="ic-row">{assets.map((asset,i)=>asset.path!==source.path && <label className="ic-check" key={asset.path}>
            <input type="radio" name="replacement-photo" aria-label={"이미지 "+(i+1)} checked={replacement?.path===asset.path} onChange={()=>onPhoto(asset.path)}/>
            {/* eslint-disable-next-line @next/next/no-img-element -- employee project image */}
            <img className="ic-ref-photo-thumb" src={asset.url} alt={"이미지 "+(i+1)} width={64} height={64}/></label>)}
            <label className="secondary-button">상품 이미지 올리기<input type="file" className="ic-sr" accept="image/png,image/jpeg"
              onChange={e=>{void upload(e.currentTarget.files?.[0]??null,asset=>onPhoto(asset.path));e.currentTarget.value="";}}/></label>
          </div>
        </fieldset>
        {replacement && <button type="button" className="secondary-button" disabled={busy} onClick={()=>onPhoto()}>상품 이미지 없이 만들기</button>}
      </details>
    </>}
  </div>;
}

"use client";
import { useEffect,useRef,useState } from "react";
import { apiRequest,getShortformLongform,listAllRecordsOfType } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

type Props={item:OsRecord;metadata:Record<string,unknown>;cutsText:string;assets:OsRecord[];
  onMetadata:(value:Record<string,unknown>)=>void;onCuts:(value:string)=>void;save:()=>Promise<boolean>;refresh:()=>Promise<void>};
export function ShortformRenderPanel({item,metadata,cutsText,assets,onMetadata,onCuts,save,refresh}:Props){
  const {accessToken}=useSession();
  const activeItem=useRef(item.id),mounted=useRef(true);
  activeItem.current=item.id;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const mode=(metadata.shortformBrief as {mode?:string}|undefined)?.mode;
  const [sources,setSources]=useState<OsRecord[]>([]),[sourceId,setSourceId]=useState(""),[consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState(""),[video,setVideo]=useState("");
  let cuts:{text?:string;voice?:string;assetId?:string}[]=[];
  try{const value=JSON.parse(cutsText);if(Array.isArray(value))cuts=value;}catch{}
  useEffect(()=>{setConsent(false);},[cutsText,metadata.shortformBrief,item.id]);
  useEffect(()=>{setStatus("");setError("");setSourceId("");},[item.id]);
  useEffect(()=>{
    let active=true;
    if(accessToken&&mode==="reuse")void listAllRecordsOfType(accessToken,"content_topic").then(rows=>{
      if(active)setSources(rows.filter(row=>row.owner_id===item.owner_id));
    }).catch(()=>{if(active)setError("롱폼 목록을 읽지 못했습니다.");});
    return()=>{active=false;};
  },[accessToken,mode,item.owner_id]);
  useEffect(()=>{
    let active=true;setVideo("");
    if(accessToken&&typeof metadata.mp4Path==="string"&&metadata.mp4Path)
      void apiRequest<{url:string}>("/api/v1/content/automation/uploads?path="+encodeURIComponent(metadata.mp4Path),{token:accessToken})
        .then(result=>{if(active)setVideo(result.url);}).catch(()=>{if(active)setError("완성 영상 주소를 읽지 못했습니다.");});
    return()=>{active=false;};
  },[accessToken,metadata.mp4Path]);
  const connect=async()=>{
    if(!accessToken||!sourceId)return;
    const requestedItem=item.id;
    setBusy(true);setError("");
    try{
      const source=await getShortformLongform(accessToken,sourceId);
      if(!mounted.current||activeItem.current!==requestedItem)return;
      if(source.transcript.length>100_000)throw new Error("이 원본의 자막이 너무 큽니다. 원본 구성을 먼저 확인해 주세요.");
      onMetadata({...metadata,shortformSource:{id:sourceId,key:source.reference.key},shortformTranscript:source.transcript});
    }catch(issue){setError(issue instanceof Error?issue.message:"원본 연결 실패");}
    finally{setBusy(false);}
  };
  const inspect=async()=>{
    if(!accessToken)return;
    try{
      const result=await apiRequest<{run:null|{status:string;error:string|null}}>("/api/v1/content/shorts/render?itemId="+item.id,{token:accessToken});
      const run=result.run;
      const reasons:Record<string,string>={SHORTFORM_VOICE_TOO_LONG:"내레이션이 장면보다 깁니다. 대본을 줄이거나 장면 시간을 조정해 주세요.",
        SHORTFORM_CAPTION_TOO_LONG:"한 장면 자막이 너무 깁니다. 네 줄 안으로 줄여 주세요.",SHORTFORM_INPUT_CHANGED:"제작 조건이 바뀌었습니다. 현재 내용으로 다시 요청해 주세요."};
      setStatus(!run?"제작 요청 없음":run.status==="done"?"완성 영상이 카드에 연결됐습니다. 아래에서 불러와 확인해 주세요.":
        run.status==="blocked"?(reasons[run.error??""]??"제작이 멈췄습니다. 소재와 렌더 PC 연결을 확인한 뒤 다시 요청해 주세요."):
        run.status==="in_progress"?"영상 만드는 중":"렌더 PC가 요청을 기다리는 중");
    }catch(issue){setError(issue instanceof Error?issue.message:"상태 확인 실패");}
  };
  const request=async()=>{
    if(!accessToken)return;
    setBusy(true);setError("");
    try{
      if(!await save())return;
      const current=await apiRequest<{record:OsRecord}>("/api/v1/content/automation/items/"+item.id,{token:accessToken});
      await apiRequest("/api/v1/content/shorts/render",{method:"POST",token:accessToken,
        body:JSON.stringify({itemId:item.id,version:current.record.version,confirmVoiceCost:consent})});
      await inspect();
    }catch(issue){setError(issue instanceof Error?issue.message:"제작 요청 실패");}
    finally{setBusy(false);}
  };
  return <div className="ca-v07-fields"><h3>MP4 자동 제작</h3>
    {mode==="reuse"?<>
      <label>내 OS 롱폼 원본<select value={sourceId} onChange={event=>setSourceId(event.target.value)}>
        <option value="">완성본이 있는 원본 선택</option>{sources.map(row=><option value={row.id} key={row.id}>{row.title}</option>)}
      </select></label>
      <button type="button" disabled={busy||!sourceId} onClick={()=>void connect()}>완성본·자막 연결</button>
      {metadata.shortformSource?<p>롱폼 연결됨 · 컷의 시작·끝은 원본 영상 시각입니다. 원본 음성을 사용합니다.</p>:null}
    </>:mode==="direct"?<>
      {cuts.map((cut,index)=><label key={index}>장면 {index+1}에 사용할 내 이미지<select value={cut.assetId??""} onChange={event=>{
        const next=cuts.map((value,i)=>i===index?{...value,assetId:event.target.value||undefined,missingAsset:!event.target.value}:value);
        onCuts(JSON.stringify(next,null,2));
      }}><option value="">확보한 이미지 선택</option>{assets.map(asset=><option key={asset.id} value={asset.id}>{asset.title}</option>)}</select></label>)}
      <p>720×1280 세로 영상으로 만듭니다. 사진 전체를 보존하고 여백에는 흐린 배경을 채웁니다. 가로 소재의 자막은 화면 바로 아래에 놓습니다. 내레이션이 장면보다 길면 대본을 고치도록 멈춥니다.</p>
      {cuts.some(cut=>cut.voice?.trim())?<label><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>선택한 대본의 Fish 내레이션 생성 비용이 발생할 수 있음을 확인했습니다.</label>:null}
    </>:<p>제작 방식과 조건을 먼저 선택해 주세요.</p>}
    <button type="button" disabled={busy||!mode||mode==="direct"&&cuts.some(cut=>cut.voice?.trim())&&!consent}
      onClick={()=>void request()}>{busy?"요청 준비 중…":"확인한 구성으로 MP4 만들기"}</button>
    <button type="button" disabled={busy} onClick={()=>void inspect()}>제작 상태 확인</button>
    {status?<p role="status">{status}</p>:null}
    <button type="button" disabled={busy} onClick={()=>void refresh()}>카드·완성본 새로 불러오기</button>
    {video?<><video controls preload="metadata" src={video} style={{width:"100%",maxHeight:480}}/><a href={video} target="_blank" rel="noreferrer">완성 MP4 열기</a></>:null}
    {error?<p role="alert">{error}</p>:null}
  </div>;
}

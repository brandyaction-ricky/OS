"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { X, ImagePlus, Save, Send, CheckCircle2 } from "lucide-react";
import { apiRequest, createContentMediaUpload, uploadContentMedia } from "@/lib/api-client";
import { defaultPublicationSettings, executePublication, publicationProblems, type PublicationSettings } from "@/lib/channel-publishing";
import type { ChannelConnection } from "@/lib/channel-types";
import type { OsRecord } from "@/lib/record-types";
import { renderContentCard } from "@/lib/card-renderer";
import { demoRecord } from "@/lib/demo-record";
import { useSession } from "./session-provider";
import { GuideNumber } from "./page-guide";

export function PublicationSettingsPanel({ record, onClose, onSaved }: { record: OsRecord; onClose:()=>void; onSaved:(record:OsRecord)=>void }) {
  const {accessToken,profile,demo}=useSession();
  const [current,setCurrent]=useState(record),[settings,setSettings]=useState(()=>defaultPublicationSettings(record.metadata,record.description,profile?.id??""));
  const [accounts,setAccounts]=useState<ChannelConnection[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [date,setDate]=useState(""),[permalink,setPermalink]=useState(""),[cards,setCards]=useState(`${record.title}\n${record.description.slice(0,180)}\n---\n핵심 정리\n${record.description.slice(180,360)}`),[previews,setPreviews]=useState<string[]>([]);
  const [confirmed,setConfirmed]=useState(false);
  useEffect(()=>{let live=true;
    if(demo){setAccounts((["instagram","threads"] as const).map(platform=>({platform,ownerId:profile?.id??"demo",accountName:`모의 ${platform} 계정`,accountType:"MOCK",teamShared:false,status:"connected",connectedAt:"",expiresAt:null,expiresSoon:false,lastSuccessAt:null,lastErrorCode:null,mock:true})));setLoading(false);return;}
    apiRequest<{connections:ChannelConnection[]}>("/api/v1/channels",{token:accessToken}).then(result=>{if(live)setAccounts(result.connections.filter(row=>row.platform!=="youtube"));}).catch(reason=>{if(live)setError(reason instanceof Error?reason.message:"채널 조회 실패");}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
  },[accessToken,demo,profile?.id]);
  useEffect(()=>()=>{previews.forEach(url=>URL.revokeObjectURL(url));},[previews]);
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy)onClose();};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[busy,onClose]);
  const savedSettings=useMemo(()=>defaultPublicationSettings(current.metadata,current.description,profile?.id??""),[current,profile?.id]);
  const dirty=JSON.stringify(settings)!==JSON.stringify(savedSettings)||current.metadata.channelWorkflowVersion!==1;
  const problems=publicationProblems(settings),approved=current.metadata.needsRecheck===false&&Boolean(current.metadata.publicationApproval)&&!dirty;
  const editable=current.status!=="published"&&!((current.metadata.externalIds as unknown[]|undefined)?.length);
  const change=<K extends keyof PublicationSettings>(key:K,value:PublicationSettings[K])=>{setSettings(old=>({...old,[key]:value}));setConfirmed(false);};
  async function run(operation:string){
    setBusy(true);setError("");setNotice("");
    try{
      let next:OsRecord;
      if(demo){
        let metadata={...current.metadata};let status=current.status;
        if(operation==="edit"){metadata={...metadata,...settings,channelWorkflowVersion:1,publicationApproval:null,needsRecheck:true};status="review";}
        if(operation==="approve"){if(problems.length||!confirmed)throw Error(problems.join(" ")||"확인 항목을 체크해 주세요.");metadata={...metadata,publicationApproval:{actorId:profile?.id},needsRecheck:false};status="ready";}
        if(["schedule","publish","manual_done"].includes(operation)&&!approved)throw Error("최종 승인을 먼저 완료해 주세요.");
        if(operation==="schedule"){if(!date||new Date(date).getTime()<=Date.now())throw Error("미래 시각을 입력해 주세요.");status="scheduled";}
        if(operation==="publish"){
          const outcome=await executePublication(settings,{receipts:[]},{create:async index=>`mock-container-${index}`,inspect:async()=>"ready",publish:async id=>({id:`mock-${id}`,permalink:""})},async()=>{});
          metadata={...metadata,mockPublished:true,externalIds:outcome.receipts.map(item=>item.id),publishedAt:new Date().toISOString(),postedBy:profile?.id};status="published";
        }
        if(operation==="manual_done"){if(!permalink.startsWith("https://"))throw Error("게시물 HTTPS 주소를 입력해 주세요.");metadata={...metadata,permalink,receiptSource:"manual",mockPublished:true};status="published";}
        next=demoRecord({status,description:settings.caption,metadata,...(operation==="schedule"?{startsAt:new Date(date).toISOString()}: {})},profile?.id??"demo",current);
      }else{
        const result=await apiRequest<{record:OsRecord}>("/api/v1/content/publish",{method:"POST",token:accessToken,body:JSON.stringify({id:current.id,expectedVersion:current.version,operation,...(operation==="edit"?{settings}:{}),...(operation==="schedule"?{startsAt:new Date(date).toISOString()}:{}),...(operation==="manual_done"?{permalink}:{}),confirm:confirmed})});next=result.record;
      }
      setCurrent(next);setSettings(defaultPublicationSettings(next.metadata,next.description,profile?.id??""));onSaved(next);setConfirmed(false);setNotice(demo?"모의 동작 완료 · 실제 게시·DB 저장 없음":"처리 결과를 저장했습니다.");
    }catch(reason){setError(reason instanceof Error?reason.message:"처리하지 못했습니다.");}finally{setBusy(false);}
  }
  async function attach(files:File[]){
    if(!current.parent_id)throw Error("기준 영상을 먼저 연결해 주세요.");
    const media:PublicationSettings["media"]=[],urls:string[]=[];
    try{for(const file of files){
      if(!["image/png","image/jpeg"].includes(file.type)||file.size>8*1024*1024)throw Error("카드는 JPEG/PNG, 8MB 이하만 첨부할 수 있습니다.");
      const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();
      let path=`demo/${file.name}`;
      if(!demo){const signed=await createContentMediaUpload(accessToken,{sourceId:current.parent_id,fileName:file.name,fileSize:file.size,mimeType:file.type,assetKind:"visuals"});await uploadContentMedia(signed.path,signed.token,file,file.type);path=signed.path;}
      media.push({path,mimeType:file.type as "image/png"|"image/jpeg",size:file.size,width,height});urls.push(URL.createObjectURL(file));
    }}catch(reason){urls.forEach(url=>URL.revokeObjectURL(url));throw reason;}
    change("media",media);setPreviews(urls);setNotice("이미지를 준비했습니다. 편집 저장 후 최종 승인해 주세요.");
  }
  async function attachVideo(file:File){
    setBusy(true);setError("");
    const local=URL.createObjectURL(file);
    try{
      if(!current.parent_id)throw Error("기준 영상을 먼저 연결해 주세요.");
      if(file.type!=="video/mp4")throw Error("MP4 영상 파일을 선택해 주세요.");
      const size=await new Promise<{width:number;height:number}>((resolve,reject)=>{
        const video=document.createElement("video");video.preload="metadata";
        const finish=(error?:Error)=>{clearTimeout(timeout);video.removeAttribute("src");video.load();if(error)reject(error);};
        const timeout=setTimeout(()=>finish(Error("영상 정보를 확인하지 못했습니다.")),10000);
        video.onloadedmetadata=()=>{const dimensions={width:video.videoWidth,height:video.videoHeight};finish();resolve(dimensions);};
        video.onerror=()=>finish(Error("재생 가능한 MP4 파일인지 확인해 주세요."));video.src=local;
      });
      if(!size.width||!size.height)throw Error("영상 크기를 확인하지 못했습니다.");
      let path=`demo/${file.name}`;
      if(!demo){const signed=await createContentMediaUpload(accessToken,{sourceId:current.parent_id,fileName:file.name,fileSize:file.size,mimeType:file.type,assetKind:"roughCut"});await uploadContentMedia(signed.path,signed.token,file,file.type);path=signed.path;}
      change("media",[{path,mimeType:"video/mp4",...size,size:file.size}]);setPreviews([]);setNotice("영상을 준비했습니다. 편집 저장 후 최종 승인해 주세요.");
    }catch(reason){setError(reason instanceof Error?reason.message:"영상 준비 실패");}finally{URL.revokeObjectURL(local);setBusy(false);}
  }
  async function prepare(files?:File[]){setBusy(true);setError("");try{if(files){await attach(files);}else{const entries=cards.split(/\n---\n/).map(text=>text.trim()).filter(Boolean);if(entries.length<2||entries.length>10)throw Error("카드 2~10장을 구분선 --- 로 나눠 주세요.");const output:File[]=[];for(const [index,text]of entries.entries()){const [title,...body]=text.split("\n");const blob=await renderContentCard(title,body.join("\n"),index,entries.length);output.push(new File([blob],`card-${index+1}.png`,{type:"image/png"}));}await attach(output);}}catch(reason){setError(reason instanceof Error?reason.message:"이미지 준비 실패");}finally{setBusy(false);}}
  return <aside className="panel publication-settings" aria-label="게시 설정">
    <header><div><h2>게시 설정</h2><p>{current.title}</p></div><button className="icon-button" aria-label="게시 설정 닫기" onClick={onClose}><X size={18}/></button></header>
    {demo?<p className="inline-alert">모의 검수 · 실제 게시·외부 저장 없음</p>:null}
    {error?<div className="inline-alert danger" role="alert">{error}</div>:null}{notice?<div className="inline-alert success" role="status">{notice}</div>:null}
    <fieldset disabled={busy||!editable}>
      <label><GuideNumber number={1}/>게시 계정<select aria-label="게시 계정" value={`${settings.account.platform}:${settings.account.ownerId}`} onChange={event=>{const account=accounts.find(row=>`${row.platform}:${row.ownerId}`===event.target.value);if(account&&account.platform!=="youtube"){setSettings(old=>({...old,account:{platform:account.platform as "instagram"|"threads",ownerId:account.ownerId},platformFormat:account.platform==="instagram"?"ig_carousel":"threads_text"}));setConfirmed(false);}}}><option value="">{loading?"확인 중…":"내 계정에서 연결하세요"}</option>{accounts.map(account=><option key={`${account.platform}:${account.ownerId}`} value={`${account.platform}:${account.ownerId}`}>{account.accountName}{account.teamShared?" · 팀 공유":" · 나만"}</option>)}</select></label>
      <Link href="/settings/account">채널 연결 관리</Link>
      <label>게시 형식<select value={settings.platformFormat} onChange={event=>change("platformFormat",event.target.value as PublicationSettings["platformFormat"])}>{settings.account.platform==="instagram"?<><option value="ig_carousel">인스타 카드뉴스</option><option value="ig_reel">인스타 릴스</option></>:<><option value="threads_text">Threads 한 글</option><option value="threads_chain">Threads 글타래</option><option value="threads_carousel">Threads 캐러셀</option></>}</select></label>
      <label>캡션<textarea value={settings.caption} onChange={event=>change("caption",event.target.value)}/><small>{Array.from(settings.caption).length}자 · 해시태그 포함 인스타 2,200 / Threads 500</small></label>
      <label>해시태그<input value={settings.hashtags} onChange={event=>change("hashtags",event.target.value)}/></label>
      {settings.platformFormat==="threads_chain"?<label>글타래 · 빈 줄로 구분<textarea value={settings.parts.join("\n\n")} onChange={event=>change("parts",event.target.value.split(/\n\n/))}/></label>:null}
      {settings.account.platform==="threads"?<label>답글 허용<select value={settings.replyControl} onChange={event=>change("replyControl",event.target.value as PublicationSettings["replyControl"])}><option value="everyone">모든 사람</option><option value="accounts_you_follow">내가 팔로우하는 계정</option><option value="mentioned_only">언급한 계정만</option></select></label>:<label>첫 댓글 · 앱에서 직접 작성<textarea value={settings.firstComment} onChange={event=>change("firstComment",event.target.value)}/><small>API 지원 확인 전에는 수동 할 일로 남깁니다.</small></label>}
      {settings.platformFormat.endsWith("carousel")?<section><h3>카드뉴스 이미지</h3><label>카드 원고 · 첫 줄 제목, --- 로 카드 구분<textarea value={cards} onChange={event=>setCards(event.target.value)}/></label><button className="secondary-button" onClick={()=>void prepare()}><ImagePlus size={14}/>1080×1350 이미지 만들기</button><label>이미지 파일 선택<input type="file" accept="image/png,image/jpeg" multiple onChange={event=>{if(event.target.files?.length)void prepare(Array.from(event.target.files));}}/></label><div className="publication-thumbnails">{previews.map((url,index)=><figure key={url}>{/* Object URLs are local, never a public media bucket. */}<img src={url} alt={`게시 카드 ${index+1}`}/><figcaption>{index+1} / {previews.length}</figcaption></figure>)}</div><small>{settings.media.length}장 · JPEG/PNG 8MB 이하 · 비공개 제작 저장소</small></section>:null}
      {settings.platformFormat==="ig_reel"?<label>릴스 MP4 파일<input type="file" accept="video/mp4" onChange={event=>{const file=event.target.files?.[0];if(file)void attachVideo(file);}}/><small>{settings.media[0]?`${settings.media[0].width}×${settings.media[0].height} · ${(settings.media[0].size/1024/1024).toFixed(1)}MB · 비공개 제작 저장소`:"MP4 영상 한 개를 첨부해 주세요."} 실계정 API 게시는 별도 검수 전까지 잠겨 있습니다.</small></label>:null}
      <label>게시 방식<select value={settings.publishMode} onChange={event=>change("publishMode",event.target.value as PublicationSettings["publishMode"])}><option value="confirm">예약 · 알림 후 확인하고 게시</option><option value="now">지금 게시</option><option value="manual">앱에서 직접</option></select></label>
      <button className="secondary-button" disabled={loading||!dirty} onClick={()=>void run("edit")}><Save size={14}/>편집 저장</button>
    </fieldset>
    <section className="publication-validation"><h3><GuideNumber number={2}/>게시 전 검사</h3>{problems.length?<ul>{problems.map(problem=><li key={problem}>{problem}</li>)}</ul>:<p>문안·형식 기준 통과 · 실제 연결 권한은 서버에서 다시 검사합니다.</p>}<p>24시간 기준: 인스타 게시 100 · Threads 게시 250 / 답글 1,000. 현재 계정 잔여 한도는 미확인입니다.</p><p>{dirty?"편집 저장 필요":approved?"최종 승인 완료":"재확인·최종 승인 필요"}</p></section>
    {current.status==="published"?<p className="inline-alert success"><CheckCircle2 size={16}/>{current.metadata.mockPublished?"모의 게시 완료":"게시 완료"} · 처리자와 시각을 기록했습니다.</p>:<>
      <label className="publication-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>문안·이미지·계정을 직접 확인했습니다.</label>
      <button className="primary-button" disabled={busy||dirty||problems.length>0||!confirmed||approved} onClick={()=>void run("approve")}>최종 승인</button>
      {settings.publishMode!=="now"?<label>예약 시각<input type="datetime-local" value={date} onChange={event=>setDate(event.target.value)}/></label>:null}
      <div className="publication-actions"><GuideNumber number={3}/>{settings.publishMode!=="now"?<button className="secondary-button" disabled={busy||!approved||!date} onClick={()=>void run("schedule")}>확인 알림 예약</button>:null}{settings.publishMode==="manual"?<><input aria-label="직접 게시한 주소" value={permalink} onChange={event=>setPermalink(event.target.value)} placeholder="https://…"/><button className="primary-button" disabled={busy||!approved||!confirmed||!permalink} onClick={()=>void run("manual_done")}>직접 게시 완료</button></>:<button className="primary-button" disabled={busy||!approved||!confirmed} onClick={()=>void run("publish")}><Send size={14}/>{demo?"모의 확인하고 게시":"확인하고 게시"}</button>}</div>
    </>}
  </aside>;
}

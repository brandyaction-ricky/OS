"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleAlert, Instagram, Youtube, MessageCircle, KeyRound } from "lucide-react";
import Link from "next/link";
import { apiRequest, listMembers, startYoutubeOAuth, type OsMember } from "@/lib/api-client";
import type { ChannelConnection, ChannelPlatform } from "@/lib/channel-types";
import type { OsRecord } from "@/lib/record-types";
import { PageTitle } from "./page-title";
import { GuideNumber } from "./page-guide";
import { PasswordChangeForm } from "./password-change-form";
import { useSession } from "./session-provider";

const PLATFORMS = [{ key: "youtube", label: "YouTube", icon: Youtube }, { key: "instagram", label: "인스타그램", icon: Instagram }, { key: "threads", label: "Threads", icon: MessageCircle }] as const;
type Theme = "light" | "dark" | "system";
export function AccountWorkspace() {
  const { accessToken, profile, demo } = useSession(), search = useSearchParams();
  const [connections, setConnections] = useState<ChannelConnection[]>([]), [members,setMembers] = useState<OsMember[]>([]), [requests,setRequests] = useState<OsRecord[]>([]);
  const [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState(""), [notice,setNotice] = useState("");
  const [mode,setMode] = useState("mock"), [theme,setTheme] = useState<Theme>("system"), [password,setPassword] = useState(false);
  const [accepted,setAccepted] = useState<Record<string,boolean>>({});
  const load = useCallback(async()=>{
    setError("");
    if(demo){setLoading(false);return;}
    try {
      const [channels, directory, tester] = await Promise.all([
        apiRequest<{connections:ChannelConnection[];mode:string}>("/api/v1/channels",{token:accessToken}), listMembers(accessToken),
        apiRequest<{requests:OsRecord[]}>("/api/v1/meta/tester",{token:accessToken}),
      ]);
      setConnections(channels.connections);setMode(channels.mode);setMembers(directory.members);setRequests(tester.requests);
    } catch(reason){setError(reason instanceof Error?reason.message:"채널 연결을 확인하지 못했습니다.");}
    finally{setLoading(false);}
  },[accessToken,demo]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{try{const saved=localStorage.getItem("brandy-os-theme");setTheme(saved==="light"||saved==="dark"?saved:"system");}catch{/* Keep device default. */}},[]);
  const ownerName=(id:string)=>id===profile?.id?"나":members.find(member=>member.id===id)?.display_name||"팀원";
  function changeTheme(value:Theme){
    const resolved=value==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):value;
    document.documentElement.dataset.theme=resolved;document.documentElement.style.colorScheme=resolved;
    try{if(value==="system")localStorage.removeItem("brandy-os-theme");else localStorage.setItem("brandy-os-theme",value);}catch{/* Applied for this session. */}
    setTheme(value);window.dispatchEvent(new Event("brandy-os-theme-change"));
  }
  async function perform(action:()=>Promise<void>){setBusy(true);setError("");setNotice("");try{await action();}catch(reason){setError(reason instanceof Error?reason.message:"작업을 완료하지 못했습니다.");}finally{setBusy(false);}}
  async function channelAction(platform:ChannelPlatform, action:string, connection?:ChannelConnection){
    if(action==="disconnect"&&!window.confirm("OS 채널 연결을 해제할까요? 예약·게시물 기록은 남고 다시 연결할 수 있습니다. Meta 앱 권한은 플랫폼 설정에서 별도로 해제할 수 있습니다."))return;
    await perform(async()=>{
      if(demo){
        if(action==="start")setConnections(rows=>[...rows.filter(row=>row.platform!==platform||row.ownerId!==profile?.id),{platform,ownerId:profile!.id,accountName:`모의 ${PLATFORMS.find(item=>item.key===platform)!.label} 계정`,accountType:"MOCK",teamShared:false,status:"connected",connectedAt:new Date().toISOString(),expiresAt:null,expiresSoon:false,lastSuccessAt:null,lastErrorCode:null,mock:true}]);
        if(action==="share")setConnections(rows=>rows.map(row=>row===connection?{...row,teamShared:!row.teamShared}:row));
        if(action==="disconnect")setConnections(rows=>rows.filter(row=>row!==connection));
        setNotice("모의 동작을 확인했습니다. 실제 계정·DB·게시물은 변경하지 않았습니다.");return;
      }
      if(platform==="youtube"){
        if(action==="start"){const result=await startYoutubeOAuth(accessToken);window.location.assign(result.authorizationUrl);return;}
        await apiRequest(`/api/v1/youtube/oauth${action==="test"?"/test":action==="disconnect"?`?ownerId=${encodeURIComponent(connection!.ownerId)}`:""}`,{token:accessToken,method:action==="share"?"PATCH":action==="disconnect"?"DELETE":"POST",...(action==="share"?{body:JSON.stringify({teamShared:!connection?.teamShared})}:action==="test"?{body:JSON.stringify({ownerId:connection?.ownerId})}:{})});
      }else{
        const result=await apiRequest<{authorizationUrl?:string}>(`/api/v1/meta/${action}`,{token:accessToken,method:"POST",body:JSON.stringify({platform,ownerId:connection?.ownerId,teamShared:action==="share"?!connection?.teamShared:undefined})});
        if(result.authorizationUrl){window.location.assign(result.authorizationUrl);return;}
      }
      await load();setNotice("채널 상태를 저장했습니다. 변경 기록에서 확인할 수 있습니다.");
    });
  }
  async function requestTester(platform:ChannelPlatform){await perform(async()=>{if(demo){setNotice("모의 테스터 등록 요청입니다. 실제 알림은 전송하지 않았습니다.");return;}await apiRequest("/api/v1/meta/tester",{token:accessToken,method:"POST",body:JSON.stringify({platform})});await load();setNotice("관리자에게 테스터 등록을 요청했습니다.");});}
  async function registered(record:OsRecord){await perform(async()=>{await apiRequest("/api/v1/meta/tester",{token:accessToken,method:"PATCH",body:JSON.stringify({id:record.id,expectedVersion:record.version,registered:true})});await load();setNotice("Meta 대시보드 등록 확인을 저장했습니다.");});}
  const callback=search.get("meta")??search.get("youtube");
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle/><p>내 정보와 채널 연결을 관리합니다. 회사 전체 연결 상태는 <Link href="/settings/connections">작동 상태</Link>에서 확인하세요.</p></div></header>
    {error?<div className="inline-alert danger" role="alert"><CircleAlert size={16}/>{error}<button onClick={load}>다시 불러오기</button></div>:null}
    {notice?<div className="inline-alert success" role="status">{notice}</div>:null}
    {callback?<div className="inline-alert" role="status">{callback==="connected"?"채널을 연결했습니다.":callback==="already_connected"?"다른 OS 계정에 연결되어 있습니다. 그 계정에서 팀 공유를 켜 주세요.":callback==="disconnect_first"?"기존 계정을 먼저 해제한 뒤 다른 계정을 연결해 주세요.":"연결을 완료하지 못했습니다. 관리자 테스터 등록 → 초대 수락 → 연결 순서와 권한을 확인해 주세요."}</div>:null}
    {demo||mode==="mock"?<div className="inline-alert">{demo?"로컬 모의 화면":"Meta 모의 모드"} · Meta 실제 인증·게시·답글은 실행하지 않습니다.</div>:null}
    <div className="account-layout"><aside>
      <section className="panel account-info"><h2>내 정보</h2><dl><dt>이름</dt><dd>{profile?.displayName}</dd><dt>팀</dt><dd>{profile?.team}</dd><dt>역할</dt><dd>{profile?.role==="admin"?"관리자":profile?.role==="lead"?"팀 리드":"구성원"}</dd></dl><label>화면 테마<select value={theme} onChange={event=>changeTheme(event.target.value as Theme)}><option value="system">기기 설정 따름</option><option value="light">밝게</option><option value="dark">다크</option></select></label><button className="secondary-button" onClick={()=>setPassword(true)}><KeyRound size={14}/>비밀번호 변경</button></section>
      <section className="panel account-shared"><h2>같이 쓰는 계정</h2><p>다른 사람이 ‘팀 공유’를 켠 계정입니다. 게시·답글·숨기기에 사용할 수 있습니다.</p>{loading?<p role="status">불러오는 중…</p>:connections.filter(row=>row.ownerId!==profile?.id&&row.teamShared).map(row=><div className="account-shared-row" key={`${row.ownerId}:${row.platform}`}><strong>{row.accountName}</strong><span>{ownerName(row.ownerId)}</span></div>)}{!loading&&!connections.some(row=>row.ownerId!==profile?.id&&row.teamShared)?<p>공유된 계정이 없습니다.</p>:null}</section>
    </aside><section className="account-channels" aria-label="채널 연결"><h2>채널 연결 <small>{loading?"불러오는 중…":`${connections.filter(row=>row.ownerId===profile?.id).length} / 3`}</small></h2><p><GuideNumber number={1}/>플랫폼마다 1개 · 다른 계정으로 바꾸려면 해제 후 연결 <GuideNumber number={2}/>팀 공유를 켜면 직원 누구나 사용할 수 있습니다.</p>
      <div className="account-channel-grid">{PLATFORMS.map(({key,label,icon:Icon})=>{const connection=connections.find(row=>row.platform===key&&row.ownerId===profile?.id), tester=requests.find(row=>row.owner_id===profile?.id&&row.metadata.platform===key);return <article className="panel account-channel-card" key={key}>
        <header><Icon size={17}/><h3>{label}</h3><span className={`status-pill status-${connection?.status==="connected"?"ready":"waiting"}`}>{loading?"확인 중":!connection?"연결 전":connection.mock?"모의 연결":connection.status==="expired"?"만료":connection.expiresSoon?"만료 임박":"연결됨"}</span></header>
        <div className="account-channel-body">{connection?<><dl><dt>계정</dt><dd>{connection.accountName}</dd><dt>연결</dt><dd>{new Date(connection.connectedAt).toLocaleDateString("ko-KR")} · 나</dd><dt>만료</dt><dd>{connection.expiresAt?new Date(connection.expiresAt).toLocaleDateString("ko-KR"):key==="youtube"?"Google 인증 상태에 따름":"모의 연결"}</dd></dl>{connection.expiresSoon||connection.status==="expired"?<p className="inline-alert warning"><GuideNumber number={3}/>만료되면 게시할 수 없습니다. 다시 연결해 주세요.</p>:null}<label className="channel-share"><input type="checkbox" role="switch" checked={connection.teamShared} disabled={busy} onChange={()=>void channelAction(key,"share",connection)}/>팀 공유 {connection.teamShared?"켜짐":"꺼짐"}</label><p>{connection.teamShared?"직원 누구나 이 계정으로 게시·답글·숨기기를 할 수 있습니다.":"나만 이 계정으로 게시·답글·숨기기를 할 수 있습니다."} 모든 작업은 변경 기록에 남습니다.</p></>:key==="youtube"?<p>내 Google 계정의 YouTube 채널을 연결합니다. 최종 승인된 영상만 업로드합니다.</p>:<><p>{key==="instagram"?"프로페셔널(비즈니스·크리에이터) 계정만 연결됩니다.":"Threads 계정을 연결합니다."} 회사 Meta 앱의 테스터 등록과 초대 수락이 필요합니다.</p><ol className="account-tester-steps"><li><button className="ghost-button" disabled={busy||loading||tester?.status==="backlog"} onClick={()=>void requestTester(key)}>관리자에게 테스터 등록 요청</button><small>{tester?.status==="done"?"관리자가 등록함 · 앱에서 초대를 수락하세요.":tester?.status==="backlog"?"관리자 등록 대기 중":"등록 후 연결할 수 있습니다."}</small></li><li><label><input type="checkbox" checked={Boolean(accepted[key])} onChange={event=>setAccepted(value=>({...value,[key]:event.target.checked}))}/>앱에서 테스터 초대 수락</label></li><li>아래 연결 버튼에서 권한 허용</li></ol></>}{key==="youtube"?<p className="muted">Google 앱이 테스트 상태이면 인증이 7일 후 만료될 수 있습니다. 회사 설정의 앱 상태를 확인하세요.</p>:null}</div>
        <footer><button className="primary-button" disabled={loading||busy||(!connection&&key!=="youtube"&&mode==="live"&&!accepted[key])} onClick={()=>void channelAction(key,"start",connection)}>{connection?"다시 연결":demo||(key!=="youtube"&&mode==="mock")?"모의 연결":"연결하기"}</button>{connection?<><button className="secondary-button" disabled={busy} onClick={()=>void channelAction(key,"test",connection)}>연결 테스트</button><button className="ghost-button danger-text" disabled={busy} onClick={()=>void channelAction(key,"disconnect",connection)}>연결 해제</button></>:null}</footer>
      </article>;})}</div><p className="muted">토큰은 서버에만 암호화해 보관합니다. 계정 변경 시 기존 연결을 자동으로 덮어쓰지 않습니다.</p>
    </section></div>
    {profile?.role==="admin"&&requests.length?<section className="panel account-info"><h2>테스터 등록 요청</h2><p><a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta 대시보드</a>의 앱 역할에서 직접 등록한 뒤 확인을 남겨 주세요. OS는 Meta 역할을 자동으로 추가하지 않습니다.</p>{requests.map(row=><div className="account-shared-row" key={row.id}><span>{ownerName(row.owner_id??"")} · {String(row.metadata.platform)} · {row.status==="done"?"등록 확인됨":"등록 대기"}</span><button disabled={busy||row.status==="done"} className="secondary-button" onClick={()=>void registered(row)}>등록함</button></div>)}</section>:null}
    {password?<div className="modal-backdrop" onMouseDown={()=>setPassword(false)}><div onMouseDown={event=>event.stopPropagation()}><PasswordChangeForm onCancel={()=>setPassword(false)}/></div></div>:null}
  </>;
}

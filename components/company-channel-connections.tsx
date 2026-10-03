"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, listMembers, type OsMember } from "@/lib/api-client";
import type { ChannelConnection } from "@/lib/channel-types";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

export function CompanyChannelConnections() {
  const { accessToken, profile, demo } = useSession();
  const [connections,setConnections]=useState<ChannelConnection[]>([]),[members,setMembers]=useState<OsMember[]>([]),[requests,setRequests]=useState<OsRecord[]>([]);
  const [mode,setMode]=useState("mock"),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const load=useCallback(async()=>{
    if(demo){setLoading(false);return;}
    try {
      const [channels,directory,tester]=await Promise.all([
        apiRequest<{connections:ChannelConnection[];mode:string}>(`/api/v1/channels${profile?.role==="admin"?"?scope=company":""}`,{token:accessToken}),listMembers(accessToken),
        apiRequest<{requests:OsRecord[]}>("/api/v1/meta/tester",{token:accessToken}),
      ]);
      setConnections(channels.connections);setMode(channels.mode);setMembers(directory.members);setRequests(tester.requests);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"채널 연결을 확인하지 못했습니다.");}finally{setLoading(false);}
  },[accessToken,demo,profile?.role]);
  useEffect(()=>{void load();},[load]);
  async function disconnect(connection:ChannelConnection){
    if(!window.confirm("이 사람의 OS 채널 연결을 해제할까요? 예약·게시물 기록은 남습니다. 다시 연결하려면 해당 계정의 본인이 로그인해야 합니다."))return;
    setBusy(true);try{
      if(connection.platform==="youtube")await apiRequest(`/api/v1/youtube/oauth?ownerId=${encodeURIComponent(connection.ownerId)}`,{token:accessToken,method:"DELETE"});
      else await apiRequest("/api/v1/meta/disconnect",{token:accessToken,method:"POST",body:JSON.stringify({platform:connection.platform,ownerId:connection.ownerId})});
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"연결 해제 실패");}finally{setBusy(false);}
  }
  const visibleMembers=profile?.role==="admin"?members:members.filter(member=>member.id===profile?.id||connections.some(row=>row.ownerId===member.id));
  return <section className="panel company-channel-directory">
    <header className="panel-header"><div><h2>채널 계정 — 사람별</h2><p>연결은 <Link href="/settings/account">내 계정</Link>에서 합니다. 전체 목록은 관리자만, 일반 직원은 본인·팀 공유 계정만 확인할 수 있습니다.</p></div><button className="secondary-button" disabled={busy||loading} onClick={load}>새로 확인</button></header>
    <div className="channel-app-summary"><span>Google 앱 — YouTube 연결용 · 앱 게시 상태는 Google 콘솔 확인 필요</span><span>Meta 앱 — 인스타·Threads 연결용 · {demo||mode==="mock"?"모의 모드":"개발 모드 · 테스터만 연결"}</span><span>테스터 요청 {loading?"확인 중":`${requests.filter(row=>row.status==="backlog").length}건${profile?.role!=="admin"?" (내 요청)":""}`}</span><Link href="/settings/account">테스터 요청 관리</Link></div>
    {error?<div role="alert" className="inline-alert danger">{error}</div>:loading?<div role="status" className="list-empty">채널 계정을 불러오는 중…</div>:<div className="channel-directory-scroll"><table><thead><tr><th>사람</th><th>YouTube</th><th>인스타그램</th><th>Threads</th></tr></thead><tbody>{visibleMembers.map(member=><tr key={member.id}><th>{member.display_name}</th>{(["youtube","instagram","threads"] as const).map(platform=>{const connection=connections.find(row=>row.ownerId===member.id&&row.platform===platform);return <td key={platform}>{connection?<><strong>{connection.accountName}</strong><small>{connection.mock?"모의 · ":""}{connection.status==="expired"?"만료 · ":connection.expiresSoon?"만료 임박 · ":""}{connection.teamShared?"팀 공유":"본인만"}</small>{profile?.role==="admin"?<button className="ghost-button" disabled={busy} aria-label={`${member.display_name} ${platform} 연결 해제`} onClick={()=>void disconnect(connection)}>해제</button>:null}</>:<span className="muted">{profile?.role==="admin"||member.id===profile?.id?"미연결":"공유 안 됨"}</span>}</td>;})}</tr>)}</tbody></table>{!visibleMembers.length?<p className="list-empty">{demo?"모의 화면 · 실제 회사 계정은 불러오지 않았습니다.":"표시할 계정이 없습니다."}</p>:null}</div>}
  </section>;
}

"use client";
import {useCallback,useEffect,useState} from "react";
import {getYoutubeOAuthStatus,startYoutubeOAuth,disconnectYoutubeOAuth,type YoutubeOAuthStatus} from "@/lib/api-client";
import {useSession} from "./session-provider";
export function YoutubeConnectionPanel(){
 const {accessToken,demo}=useSession();const [status,setStatus]=useState<YoutubeOAuthStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const load=useCallback(async()=>{if(demo||!accessToken)return;setStatus(await getYoutubeOAuthStatus(accessToken));},[accessToken,demo]);
 useEffect(()=>{void load().catch(()=>setError("채널 동의 상태를 확인하지 못했습니다."));},[load]);
 const connect=async()=>{setBusy(true);setError("");try{const {authorizationUrl}=await startYoutubeOAuth(accessToken);window.location.assign(authorizationUrl);}catch{setError("채널 연결을 시작하지 못했습니다.");setBusy(false);}};
 const disconnect=async()=>{if(!window.confirm("이 채널의 업로드 동의를 해제할까요?"))return;setBusy(true);setError("");try{await disconnectYoutubeOAuth(accessToken);await load();}catch{setError("채널 연결을 해제하지 못했습니다.");}finally{setBusy(false);}};
 return <section className="panel system-status-channel-card" aria-label="YouTube 채널 연결 관리"><div className="panel-header"><div><h2>YouTube 채널 연결</h2><p>내 계정의 채널 동의와 업로드 권한</p></div><span className={`status-pill ${status?.connected?"status-ready":"status-waiting"}`}>{status?.connected?"연결됨":"확인 필요"}</span></div><div className="system-status-channel-body"><p>{status?.connected?`${status.channelTitle||"선택 채널"} · 채널 동의 저장됨 · 실제 호출 결과는 위 연결 상태에서 확인하세요.`:demo?"데모에서는 계정 동의를 실행하지 않습니다.":status?.configured?"Google 계정 동의가 필요합니다.":"연결 설정 확인이 필요합니다."}</p>{error?<p className="inline-alert danger" role="alert">{error}</p>:null}<button className="secondary-button" disabled={demo||busy||!status?.canManage||(!status.connected&&!status.configured)} onClick={()=>void (status?.connected?disconnect():connect())}>{status?.connected?"채널 연결 해제":"Google 채널 연결"}</button></div></section>;
}

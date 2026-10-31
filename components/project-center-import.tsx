"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./session-provider";
import { createDocument, ApiRequestError, getDocument, apiRequest } from "@/lib/api-client";
import { allowedProjectCenterOrigin, parseProjectCenterDocument, type ProjectCenterDocument } from "@/lib/project-center-import";

export function ProjectCenterImport() {
 const { accessToken, profile, demo, loading } = useSession();
 const [document, setDocument] = useState<ProjectCenterDocument | null>(null);
 const [message, setMessage] = useState("Project Center에서 문서를 기다리고 있습니다.");
 const [savedId, setSavedId] = useState("");
 const busy = useRef(false), received = useRef(false);
 useEffect(() => {
  if (loading || (!accessToken && !demo)) return;
  const params = new URLSearchParams(window.location.search), origin = params.get("sender") || "", nonce = params.get("nonce") || "";
  if (!allowedProjectCenterOrigin(origin, process.env.NODE_ENV === "development") || !/^[a-f0-9-]{36}$/.test(nonce) || !window.opener) { setMessage("Project Center의 ‘리키 문서로 보내기’ 버튼에서 다시 열어 주세요."); return; }
  const opener = window.opener;
  const receive = (event: MessageEvent) => {
   if (event.origin !== origin || event.source !== opener) return;
   if(event.data?.type === "pc-document-ping" && event.data?.nonce === nonce){opener.postMessage({type:"pc-document-ready",nonce},origin);return;}
   const payload = parseProjectCenterDocument(event.data, nonce);
   if (payload && !received.current) { received.current=true; setDocument(payload); setMessage("문서 내용과 첨부 링크를 받았습니다. 원본은 Project Center에 유지됩니다."); }
  };
  window.addEventListener("message", receive);
  opener.postMessage({ type: "pc-document-ready", nonce }, origin);
  return () => window.removeEventListener("message", receive);
 }, [accessToken, demo, loading]);
 const save=useCallback(async () => {
  if (!document || busy.current || savedId || profile?.displayName !== "리키") return;
  busy.current = true; setMessage("리키 문서에 저장 중입니다…");
  try {
   if (demo) { setMessage("테스트 화면: 문서와 첨부 링크 수신 확인. 운영 문서는 생성하지 않습니다."); return; }
   const sourceRef=`project-center:${document.id}:${document.revision}`;
   let result;
   try { result = await createDocument(accessToken, {title:document.title,content:document.content,folder:"",source:"project-center",sourceRef}); }
   catch(error){
    if(!(error instanceof ApiRequestError)||error.code!=="DOCUMENT_SOURCE_EXISTS")throw error;
    const found=await apiRequest<{documents: Array<{id:string;source_ref:string|null}>}>(`/api/v1/documents?scope=mine&q=${encodeURIComponent(sourceRef)}&limit=20`,{token:accessToken});
    const existing=found.documents.find(row=>row.source_ref===sourceRef);
    if(!existing)throw new Error("이미 전송된 문서를 찾지 못했습니다. 문서보관함을 확인하세요.");
    result={document:existing};
   }
   const verified=await getDocument(accessToken,result.document.id);
   if(verified.document.content_md!==document.content||verified.document.title!==document.title)throw new Error("OS 문서 내용이 변경되어 있습니다. 기존 문서를 덮어쓰지 않았습니다.");
   setSavedId(result.document.id);setMessage("리키 문서에 저장했습니다. 분류 없음에서 확인할 수 있습니다.");
   const params=new URLSearchParams(window.location.search),origin=params.get("sender")||"";
   if(allowedProjectCenterOrigin(origin,process.env.NODE_ENV === "development"))window.opener?.postMessage({type:"pc-document-saved",nonce:params.get("nonce"),id:result.document.id},origin);
  } catch(error) {const params=new URLSearchParams(window.location.search),origin=params.get("sender")||"";if(allowedProjectCenterOrigin(origin,process.env.NODE_ENV === "development"))window.opener?.postMessage({type:"pc-document-error",nonce:params.get("nonce")},origin);setMessage(error instanceof ApiRequestError && error.code === "DOCUMENT_SOURCE_EXISTS" ? "같은 내용이 이미 전송되었습니다. 문서보관함에서 확인하세요." : error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해 주세요.");}
  finally {busy.current=false;}
 }, [document, savedId, profile?.displayName, demo, accessToken]);
 useEffect(()=>{if(document)void save();},[document,save]);
 return <section style={{maxWidth:800,margin:"32px auto",padding:24}}><h1>리키 문서로 받기</h1><p>저장 계정: {profile?.displayName || "로그인 확인 중"} · 개인 초안 · 분류 없음</p><p role="status">{message}</p>{profile && profile.displayName!=="리키"&&<p role="alert">리키 계정으로 로그인한 뒤 다시 보내 주세요.</p>}{document&&<><h2>{document.title}</h2><pre style={{whiteSpace:"pre-wrap",maxHeight:420,overflow:"auto"}}>{document.content}</pre><button disabled={!!savedId||profile?.displayName!=="리키"} onClick={save}>리키 문서에 저장</button></>}<p><a href={savedId?`/knowledge/doc/${savedId}`:"/knowledge/vault"}>{savedId?"저장한 문서 열기":"문서보관함 열기"}</a></p></section>;
}

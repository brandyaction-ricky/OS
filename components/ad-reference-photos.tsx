import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { MyinPhotoCandidate } from "@/lib/myin-photo-sources";
import { useSession } from "./session-provider";
import type { ImageProjectBundle } from "./image-creative-workspace";

export function AdReferencePhotos({ bundle, photoGuide, busy, run, receive, select }: {
  bundle: ImageProjectBundle; busy: boolean; run: (action: () => Promise<void>) => Promise<void>;
  photoGuide?: string;
  receive: (next: ImageProjectBundle) => void; select: (path: string) => void;
}) {
  const { accessToken, demo } = useSession();
  const [words, setWords] = useState("");
  const [results, setResults] = useState<{candidates: MyinPhotoCandidate[]; missing: string[]}>();
  const [connected, setConnected] = useState(false);
  const [copyState, setCopyState] = useState<"idle"|"copied"|"manual">("idle");
  const id = bundle.project.id;
  useEffect(() => {
    if (demo || !accessToken) return;
    const controller = new AbortController();
    void apiRequest<{myAi:{keys:number}}>("/api/v1/content/youtube-automation/ai-jobs?task=image-creative&sourceId="+encodeURIComponent(id),
      {token:accessToken,signal:controller.signal}).then(status=>{
        if (!controller.signal.aborted) setConnected(status.myAi.keys>0);
      }).catch(()=>{ if (!controller.signal.aborted) setConnected(false); });
    return ()=>controller.abort();
  },[id,demo,accessToken]);
  const prompt = ["광고 견본에 넣을 4:5 세로 사진 한 장을 만들어 주세요.", photoGuide,
    "대상 · "+bundle.state.brief.audience,
    "장면의 주제 · "+(bundle.state.formatRecommendation?.appeals?.[0]?.meaning || bundle.state.brief.product),
    "글자·로고·버튼 없이 사진만 제공합니다."].filter(Boolean).join("\n");
  const endpoint = "/api/v1/content/image-creatives/" + encodeURIComponent(bundle.project.id) + "/assets";
  const registered = [...bundle.assets].sort((a,b) => Math.abs(a.w/a.h - 0.8) - Math.abs(b.w/b.h - 0.8)).slice(0, 3);
  return <><details className="ic-details"><summary>추천 사진</summary>
    {registered.length > 0 && <div className="ic-row">{registered.map((asset, i) => <button type="button" className="secondary-button"
      key={asset.path} onClick={()=>select(asset.path)} disabled={busy}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private signed project asset */}
      <img alt="" width={48} height={48} src={asset.url}/> 등록 사진 {i+1} · {asset.w}×{asset.h}
    </button>)}</div>}
    {demo || !accessToken ? <p>공개 사진 검색은 로그인한 작업에서 사용할 수 있어요.</p> : <>
      <label className="ic-field">사진 검색어<input className="field" value={words} maxLength={100}
        placeholder="예: 사무실에서 메모하는 사람" onChange={e=>setWords(e.target.value)}/></label>
      <button className="secondary-button" type="button" disabled={busy || !words.trim()} onClick={()=>void run(async()=>{
        setResults(await apiRequest(endpoint, {method:"POST",token:accessToken,body:JSON.stringify({action:"search-photos",query:words.trim()})}));
      })}>공개 사진 찾기</button>
      {results && <div aria-live="polite">{results.candidates.length === 0 && <p>찾은 사진이 없어요. 검색어를 바꾸거나 원본을 올려 주세요.</p>}
        {results.missing.length>0 && <p>검색할 수 없는 출처 · {results.missing.join(", ")}</p>}
        {results.candidates.map(photo=><div className="ic-row" key={photo.provider + photo.id}>
          {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted attribution thumbnail */}
          <img src={photo.thumb} width={70} height={64} alt="" loading="lazy" referrerPolicy="no-referrer"/>
          <a href={photo.page} target="_blank" rel="noreferrer">{photo.author} · {photo.license}</a>
          <button type="button" className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{
            const saved=await apiRequest<{bundle:ImageProjectBundle;path:string}>(endpoint,{method:"POST",token:accessToken,
              body:JSON.stringify({action:"use-photo",provider:photo.provider,id:photo.id})});
            receive(saved.bundle);select(saved.path);
          })}>{photo.check ? "이용 조건 확인 후 사용" : "이 사진 사용"}</button>
        </div>)}
      </div>}
    </>}
  </details>
  {connected && !demo && <details className="ic-details" onToggle={()=>setCopyState("idle")}><summary>내 AI로 사진 만들기</summary>
    <label className="ic-field">사진 요청문<textarea readOnly className="field" value={prompt} rows={4} onFocus={e=>e.currentTarget.select()}/></label>
    <div className="ic-row"><button className="secondary-button" type="button" onClick={async()=>{
      try { await navigator.clipboard.writeText(prompt);setCopyState("copied"); } catch { setCopyState("manual"); }
    }}>{copyState==="copied" ? "복사함" : "요청문 복사"}</button><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">내 ChatGPT 열기</a></div>
    {copyState==="manual" && <p role="status">위 요청문 칸에서 직접 복사해 주세요.</p>}
    <p>요청문을 붙여넣어 사진을 만든 뒤 위의 ‘이미지 올리기’에서 선택하세요.</p>
  </details>}</>;
}

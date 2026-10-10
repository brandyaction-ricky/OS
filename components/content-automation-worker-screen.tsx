"use client";

import { useSearchParams } from "next/navigation";
import { useCallback,useEffect,useRef,useState } from "react";
import { apiRequest,ApiRequestError } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import "./content-automation-worker.css";

type WorkerState={browser:{id:string;name:string;registeredAt:string};rules:{per_run:number;daily_max:number;long_only_now:boolean};
  run:{id:string;job_ids:string[]}|null;pending:number;todayTaken:number};
type WorkerNext={end:boolean;reason?:string;runId:string;job?:OsRecord;target?:{title:string;brand:string;dueDate:string|null;brief:unknown}|null;
  instructions?:string;skill?:{title:string;slug:string;version:number;body:string};resultFormat?:string;remaining:number;todayTaken?:number};
const RULES=[
  "이 화면의 작업만 처리한다. 다른 메뉴·다른 사이트로 이동하지 않는다.",
  "[다음 작업 가져오기]를 누르고 ‘지시’ · ‘스킬’ · ‘결과 형식’을 끝까지 읽는다.",
  "결과를 ‘결과 형식’대로 결과 칸에 쓰고 [결과 제출]을 누른다. 못 하면 [못 함]을 누르고 이유를 쓴 뒤 [못 함으로 남기기]를 누른다.",
  "승인 · 예약 · 게시 · 삭제를 하지 않는다 (이 화면에는 그 버튼이 없다).",
  "‘이번 실행 끝’이 나오면 [실행 끝내기]를 누르고 마친다.",
  "로그인 화면이 나오면 아무것도 입력하지 않고, 비밀번호 관리자·로그인 요청도 하지 않고 마친다.",
] as const;
const END_REASON:Record<string,string>={
  empty:"대기 작업이 없습니다.",per_run:"한 번에 최대 작업 수를 처리했습니다. 남은 작업은 다음 실행 때 가져옵니다.",
  daily_max:"오늘 최대 작업 수를 처리했습니다. 내일 다시 실행합니다.",
};

export function ContentAutomationWorkerScreen(){
  const {accessToken,loading,demo}=useSession();
  const search=useSearchParams();
  const via=search.get("via")==="sched"?"sched":search.get("via")==="now"?"now":null;
  const [state,setState]=useState<WorkerState|null>(null);
  const [work,setWork]=useState<WorkerNext|null>(null);
  const [currentRunId,setCurrentRunId]=useState<string|null>(null);
  const [unregistered,setUnregistered]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState("");
  const [reason,setReason]=useState("");
  const [failing,setFailing]=useState(false);
  const [finished,setFinished]=useState(false);
  const started=useRef(false);
  useEffect(()=>{
    if(loading||started.current)return;
    if(demo){setUnregistered(true);return;}
    if(!accessToken)return;
    started.current=true;
    void apiRequest<WorkerState>(`/api/v1/content/automation/worker/state${via?`?via=${via}`:""}`,{token:accessToken})
      .then(setState).catch((issue:unknown)=>{
        if(issue instanceof ApiRequestError&&issue.code==="BROWSER_NOT_REGISTERED")setUnregistered(true);
        else setError(issue instanceof Error?issue.message:"작업 화면을 불러오지 못했습니다.");
      });
  },[accessToken,demo,loading,via]);
  const runId=work?.runId??currentRunId??state?.run?.id;
  const next=useCallback(async()=>{
    if(!accessToken||!via||busy||finished)return;
    setBusy(true);setError("");
    try{
      const response=await apiRequest<WorkerNext>("/api/v1/content/automation/worker/next",{
        method:"POST",token:accessToken,body:JSON.stringify({via,runId})});
      setCurrentRunId(response.runId);
      setWork(response);setResult("");setReason("");setFailing(false);
    }catch(issue){setError(issue instanceof Error?issue.message:"다음 작업을 가져오지 못했습니다.");}
    finally{setBusy(false);}
  },[accessToken,busy,finished,runId,via]);
  async function complete(failed:boolean){
    if(!accessToken||!work?.job||!runId||busy)return;
    let parsed:unknown;
    if(!failed){try{parsed=JSON.parse(result);}catch{setError("결과 칸에 JSON 형식으로 입력해 주세요.");return;}}
    if(failed&&!reason.trim()){setError("못 한 이유를 입력해 주세요.");return;}
    setBusy(true);setError("");
    try{
      await apiRequest(`/api/v1/content/automation/worker/jobs/${work.job.id}/${failed?"fail":"result"}`,{
        method:"POST",token:accessToken,body:JSON.stringify({runId,...(failed?{reason}:{result:parsed})})});
      setWork(null);setResult("");setReason("");setFailing(false);
      setState(old=>old?{...old,todayTaken:old.todayTaken+1}:old);
    }catch(issue){setError(issue instanceof Error?issue.message:"결과를 저장하지 못했습니다.");}
    finally{setBusy(false);}
  }
  async function finish(){
    if(!accessToken||!runId||busy)return;
    setBusy(true);setError("");
    try{
      await apiRequest("/api/v1/content/automation/worker/finish",{
        method:"POST",token:accessToken,body:JSON.stringify({runId})});
      setFinished(true);
    }catch(issue){setError(issue instanceof Error?issue.message:"실행을 끝내지 못했습니다.");}
    finally{setBusy(false);}
  }
  return <main className="ca-worker">
    <header><h1>AI 작업 화면</h1><p>Claude in Chrome 바로가기 /브랜디예약 · /브랜디작업에서 엽니다. 이 화면에는 다른 메뉴로 가는 링크가 없습니다 — 사람은 탭을 닫으면 됩니다.</p></header>
    <section aria-label="Claude에게" className="ca-worker-rules"><h2>Claude에게 — 이 화면의 규칙</h2><ol>{RULES.map(rule=><li key={rule}>{rule}</li>)}</ol></section>
    {unregistered?<section className="ca-worker-panel" role="status"><h2>등록되지 않은 브라우저입니다.</h2><p>이 Chrome에서는 작업을 내주지 않습니다. Claude라면 여기서 마칩니다.</p><p>사람은 AI 작업함 › 내 컴퓨터 › 설정 순서 2단계에서 등록합니다.</p></section>
      :error&&!state?<section className="ca-worker-panel" role="alert">{error}</section>
      :!state?<section className="ca-worker-panel" role="status">작업 상태를 확인하는 중입니다…</section>
      :<>
        <section className="ca-worker-status" aria-label="실행 상태">
          <span>컴퓨터: {state.browser.name}</span><span>등록: {new Date(state.browser.registeredAt).toLocaleDateString("ko-KR")}</span>
          <span>실행 방법: {via==="sched"?"예약 실행":via==="now"?"지금 실행":"보기만"}</span>
          <span>이번 실행: {work?.job?"진행 중":state.run?.job_ids.length??0}/{state.rules.per_run}</span>
          <span>오늘: {work?.todayTaken??state.todayTaken}/{state.rules.daily_max}</span>
          <span>남은 대기: {work?.remaining??state.pending}{via==="sched"&&state.rules.long_only_now?" · 긴 작업 제외":""}</span>
        </section>
        {finished?<section className="ca-worker-panel" role="status"><h2>실행을 끝냈습니다.</h2><p>이 탭을 닫아도 됩니다.</p></section>
        :work?.end?<section className="ca-worker-panel" role="status"><h2>이번 실행 끝</h2><p>{END_REASON[work.reason??""]??"이번 실행을 마쳤습니다."}</p></section>
        :work?.job?<section className="ca-worker-panel" aria-label="지금 작업">
          <h2>작업 #{String(work.job.metadata.jobNo??"—")} · {work.job.title}</h2>
          <p>공정: {String(work.job.metadata.proc)} · 대상: {work.target?.title??"주제 후보"} · 마감: {work.target?.dueDate??"없음"} · 상태: 처리 중</p>
          <h3>1. 지시</h3><pre>{work.instructions}</pre>
          <h3>2. 스킬</h3><p>{work.skill?.title} · {work.skill?.slug} v{work.skill?.version}</p><pre>{work.skill?.body}</pre>
          <h3>3. 결과 형식</h3><pre>{work.resultFormat}</pre>
          <h3>4. 결과</h3><label htmlFor="ca-worker-result">결과 JSON</label>
          <textarea id="ca-worker-result" value={result} onChange={event=>setResult(event.target.value)} rows={12} disabled={busy||failing}/>
          {failing?<><label htmlFor="ca-worker-reason">못 한 이유</label><textarea id="ca-worker-reason" value={reason} onChange={event=>setReason(event.target.value)} rows={3} disabled={busy}/></>:null}
        </section>
        :<section className="ca-worker-panel"><h2>{via?"다음 작업을 가져오세요.":"바로가기로 화면을 다시 열어 주세요."}</h2><p>순서와 한 번에 가져갈 양은 OS가 정합니다.</p></section>}
        {error?<p className="ca-worker-error" role="alert">{error}</p>:null}
        <div className="ca-worker-actions">
          <button type="button" onClick={()=>void next()} disabled={busy||!via||finished||Boolean(work?.job)||Boolean(work?.end)}>다음 작업 가져오기</button>
          <button type="button" onClick={()=>void complete(false)} disabled={busy||!work?.job||failing}>결과 제출</button>
          <button type="button" onClick={()=>setFailing(true)} disabled={busy||!work?.job||failing}>못 함</button>
          <button type="button" onClick={()=>void complete(true)} disabled={busy||!work?.job||!failing}>못 함으로 남기기</button>
          <button type="button" onClick={()=>void finish()} disabled={busy||!work?.end}>실행 끝내기</button>
        </div>
      </>}
  </main>;
}

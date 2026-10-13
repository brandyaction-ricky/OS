"use client";
import {useRef,useState} from "react";
import {transcribeMeeting} from "@/lib/api-client";
import {useKnowledge} from "./provider";
import {Card,Modal} from "./ui";
import {useMeetingRecording} from "@/components/meeting-recording-provider";
import {MEETING_RETENTION} from "@/lib/knowledge/meetings";

export function MeetingCapture({meetingId,title,append}:{meetingId:string;title:string;append:(text:string)=>boolean}){
  const {demo,token}=useKnowledge(),input=useRef<HTMLInputElement>(null);
  const {snapshot,controller}=useMeetingRecording();
  const recording=snapshot.meetingId===meetingId&&["connecting","recording"].includes(snapshot.phase);
  const occupied=snapshot.phase!=="idle";
  const [consent,setConsent]=useState(false),[audio,setAudio]=useState<Blob|null>(null),[preview,setPreview]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function record(){
    setConsent(false);setError("");
    if(demo){setError("로컬 데모에서는 녹음·AI 전사를 실행하지 않습니다. 텍스트 파일로 가져오기를 검증할 수 있습니다.");return;}
    try{await controller.start(meetingId,title);}catch(e){setError((e as Error).message);}
  }
  async function file(file:File){setError("");if(file.size>4000000){setError("4MB 이하 파일을 선택해 주세요.");return;}if(/\.(txt|md)$/i.test(file.name)){const text=await file.text();if(text.length>20000){setError("본문은 20,000자 이하로 나누어 주세요.");return;}setPreview(text);}else if(file.type.startsWith("audio/"))setAudio(file);else setError("TXT, Markdown 또는 음성 파일을 선택해 주세요.");}
  async function transcribe(blob:Blob,automatic=false){if(demo){setError("로컬 데모에서는 실제 AI 전사를 호출하지 않습니다.");return;}setBusy(true);setError("");try{const result=await transcribeMeeting(token,blob);if(automatic&&append(result.transcript))setPreview("");else setPreview(result.transcript);setAudio(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="kw-meeting-capture"><Card title="녹음·전사 / 파일 가져오기"><div className="kw-actions"><button disabled={busy||(!recording&&occupied)} onClick={()=>recording?controller.stop():setConsent(true)}>{recording?"녹음 종료":"녹음 시작"}</button><button disabled={recording||busy} onClick={()=>input.current?.click()}>파일·Zoom 요약</button></div><input ref={input} hidden type="file" accept=".txt,.md,audio/*" onChange={e=>{const selected=e.target.files?.[0];if(selected)void file(selected);e.currentTarget.value="";}}/>
    <small>녹음 전 참석자 동의를 확인합니다. 음성은 서버에 보관하지 않고 전사 후 브라우저에서도 폐기합니다. 다른 메뉴에서도 녹음이 이어집니다. 실패한 전사는 하단 표시줄에서 재시도할 수 있습니다.</small>
    <details><summary>녹음·전사 보존 기준</summary><p>저장형 녹음 도입 시 원본 {MEETING_RETENTION.audioDays}일, 전사본 {MEETING_RETENTION.transcriptDays}일을 기본 보존 기간으로 적용하고 결정 근거 구간은 별도로 보존합니다.</p><small>현재는 음성 저장·자동 파기를 실행하지 않습니다. 메모에 추가한 전사 글은 회의록과 함께 보관됩니다.</small></details>
    {recording&&<p className="kw-recording-indicator" role="status">녹음 중 · 받아쓴 내용은 회의 메모에 표시됩니다.</p>}
    {busy&&<p role="status">음성을 전사하는 중입니다…</p>}
    {audio&&!busy&&<button onClick={()=>void transcribe(audio,true)}>{error?"전사 다시 시도":"AI 전사 요청 · 외부 전송"}</button>}
    {preview&&<><label>가져온 원문 미리보기<textarea rows={6} value={preview} onChange={e=>setPreview(e.target.value)}/></label><button disabled={!preview.trim()} onClick={()=>{if(append(preview))setPreview("");}}>기존 메모 뒤에 추가</button></>}
    {error&&<p className="kw-error" role="alert">{error}</p>}{consent&&<Modal title="참석자에게 녹음을 알렸나요?" onClose={()=>setConsent(false)}><div className="kw-modal-body"><p>참석자 모두에게 녹음과 OpenAI 자동 전사 전송 목적을 알리고 동의를 받은 뒤 시작하세요. 녹음 중 음성을 OpenAI 실시간 전사 API로 전송하고, 받아쓴 내용을 회의 메모에 추가합니다. 연결 실패 시 녹음 종료 후 음성 파일을 OpenAI 전사 API로 보내 복구합니다. 음성 원본은 서버에 저장하지 않습니다. 한 번에 최대 15분까지 녹음하며, 결과 확인 후 이어서 녹음할 수 있습니다.</p><footer><button onClick={()=>setConsent(false)}>취소</button><button onClick={()=>void record()}>동의 확인 · 녹음 시작</button></footer></div></Modal>}
  </Card></div>;
}

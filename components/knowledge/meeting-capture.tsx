"use client";
import {useEffect,useRef,useState} from "react";
import {transcribeMeeting} from "@/lib/api-client";
import {RecorderProgress} from "@/components/meeting-recorder";
import {useMeetingRecording} from "@/components/meeting-recording-provider";
import {audioMinutes,CostTag,fileAsk,recordAsk,useCostConfirm,useCostModels} from "@/components/cost-notice";
import {useKnowledge} from "./provider";
import {Card} from "./ui";
import {MEETING_RETENTION} from "@/lib/knowledge/meetings";

export function MeetingCapture({meeting,append}:{meeting:{id:string;title:string;href:string};append:(text:string)=>boolean}){
  const {demo,token}=useKnowledge(),input=useRef<HTMLInputElement>(null);
  const appendRef=useRef(append);appendRef.current=append;
  const cost=useCostConfirm(),{transcribe}=useCostModels();
  const [audio,setAudio]=useState<Blob|null>(null),[preview,setPreview]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  // The app-wide recorder keeps going in other menus; this screen takes its transcripts while open,
  // and those that came in meanwhile on return. A segment the notes cannot take waits in the preview.
  const provided=useMeetingRecording();
  if(!provided)throw new Error("MeetingCapture must be inside MeetingRecordingProvider");
  const shared=provided;
  const {recorder,attach}=shared,mine=shared.meeting?.id===meeting.id,elsewhere=recorder.recording&&!mine;
  useEffect(()=>attach(meeting.id,text=>{if(!appendRef.current(text))setPreview(value=>value?`${value}\n\n${text}`:text);return true;}),[attach,meeting.id]);
  // Recording and transcription are paid OpenAI calls: the one dialog asks for consent and shows the model and the estimate.
  async function record(){setError("");if(!await cost.confirm({...recordAsk(transcribe),ok:"동의 확인 · 녹음 시작"}))return;if(demo){setError("로컬 데모에서는 녹음·받아쓰기를 하지 않습니다. 텍스트 파일 가져오기는 해 볼 수 있습니다.");return;}void shared.start(meeting);}
  async function file(file:File){setError("");if(file.size>4000000){setError("음성 파일은 4MB 이하만 가져올 수 있습니다. 긴 회의는 이 화면에서 바로 녹음해 주세요. 시간 제한 없이 자동으로 나눠 받아씁니다.");return;}if(/\.(txt|md)$/i.test(file.name)){const text=await file.text();if(text.length>20000){setError("본문은 20,000자 이하로 나누어 주세요.");return;}setPreview(text);}else if(file.type.startsWith("audio/"))setAudio(file);else setError("TXT, Markdown 또는 음성 파일을 선택해 주세요.");}
  async function transcribeFile(blob:Blob){if(!await cost.confirm({...fileAsk(transcribe,await audioMinutes(blob)),ok:"확인하고 받아쓰기"}))return;if(demo){setError("로컬 데모에서는 실제 받아쓰기를 하지 않습니다.");return;}setBusy(true);setError("");try{const result=await transcribeMeeting(token,blob);if(appendRef.current(result.transcript))setPreview("");else setPreview(result.transcript);setAudio(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const shownError=error||recorder.error;
  return <div className="kw-meeting-capture"><Card title="녹음·받아쓰기 / 파일 가져오기"><div className="kw-actions"><button disabled={busy||elsewhere} onClick={()=>recorder.recording?recorder.stop():void record()}>{recorder.recording&&mine?"녹음 종료":"녹음 시작"}</button><CostTag kind="paid"/><button disabled={recorder.recording||busy} onClick={()=>input.current?.click()}>파일·Zoom 기록 가져오기</button></div><input ref={input} hidden type="file" accept=".txt,.md,audio/*" onChange={e=>{const selected=e.target.files?.[0];if(selected)void file(selected);e.currentTarget.value="";}}/>
    <small>녹음 전 참석자 동의를 확인합니다. 시간 제한 없이 녹음되며 10분마다 나눠 받아써서 메모 뒤에 차례로 붙입니다. 음성은 서버에 보관하지 않습니다.</small>
    <details><summary>녹음·받아쓰기 보관 기준</summary><p>저장형 녹음 도입 시 원본 {MEETING_RETENTION.audioDays}일, 전사본 {MEETING_RETENTION.transcriptDays}일을 기본 보존 기간으로 적용하고 결정 근거 구간은 별도로 보존합니다.</p><small>현재는 음성 저장·자동 파기를 실행하지 않습니다. 메모에 추가한 받아쓴 글은 회의록과 함께 보관됩니다.</small></details>
    {elsewhere?<p role="status">다른 회의 「{shared.meeting?.title}」를 녹음 중이에요. 그 녹음을 끝내면 여기서 녹음할 수 있어요.</p>:null}
    {mine?<RecorderProgress recorder={recorder}/>:null}
    {busy&&<p role="status">음성을 받아쓰는 중입니다…</p>}
    {audio&&!busy&&<div className="kw-actions"><button onClick={()=>void transcribeFile(audio)}>{error?"받아쓰기 다시 시도":"AI로 받아쓰기"}</button><CostTag kind="paid"/></div>}
    {preview&&<><label>가져온 원문 미리보기<textarea rows={6} value={preview} onChange={e=>setPreview(e.target.value)}/></label><button disabled={!preview.trim()} onClick={()=>{if(append(preview))setPreview("");}}>기존 메모 뒤에 추가</button></>}
    {shownError&&<p className="kw-error" role="alert">{shownError}</p>}{cost.element}
  </Card></div>;
}

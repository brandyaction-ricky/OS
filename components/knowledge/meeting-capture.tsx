"use client";
import {useEffect,useRef,useState} from "react";
import {transcribeMeeting} from "@/lib/api-client";
import {useKnowledge} from "./provider";
import {Card,Modal} from "./ui";
import {MEETING_RETENTION} from "@/lib/knowledge/meetings";

export function MeetingCapture({append}:{append:(text:string)=>boolean}){
  const {demo,token}=useKnowledge(),recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),chunks=useRef<Blob[]>([]),input=useRef<HTMLInputElement>(null);
  const [recording,setRecording]=useState(false),[consent,setConsent]=useState(false),[audio,setAudio]=useState<Blob|null>(null),[preview,setPreview]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>()=>{if(recorder.current){recorder.current.onstop=null;if(recorder.current.state!=="inactive")recorder.current.stop();}stream.current?.getTracks().forEach(t=>t.stop());},[]);
  async function record(){
    setConsent(false);setError("");
    if(demo){setError("로컬 데모에서는 녹음·AI 전사를 실행하지 않습니다. 텍스트 파일로 가져오기를 검증할 수 있습니다.");return;}
    try{stream.current=await navigator.mediaDevices.getUserMedia({audio:true});const supported=["audio/webm;codecs=opus","audio/webm","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type));
      const instance=new MediaRecorder(stream.current,{...(supported?{mimeType:supported}:{}),audioBitsPerSecond:32000});recorder.current=instance;chunks.current=[];setAudio(null);
      instance.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data);if(chunks.current.reduce((sum,b)=>sum+b.size,0)>3900000&&instance.state==="recording")instance.stop();};
      instance.onstop=()=>{stream.current?.getTracks().forEach(t=>t.stop());setRecording(false);setAudio(new Blob(chunks.current,{type:instance.mimeType}));chunks.current=[];};instance.start(1000);setRecording(true);
    }catch{stream.current?.getTracks().forEach(t=>t.stop());setError("마이크를 사용할 수 없습니다. 권한 또는 텍스트 가져오기를 확인하세요.");}
  }
  async function file(file:File){setError("");if(file.size>4000000){setError("4MB 이하 파일을 선택해 주세요.");return;}if(/\.(txt|md)$/i.test(file.name)){const text=await file.text();if(text.length>20000){setError("본문은 20,000자 이하로 나누어 주세요.");return;}setPreview(text);}else if(file.type.startsWith("audio/"))setAudio(file);else setError("TXT, Markdown 또는 음성 파일을 선택해 주세요.");}
  async function transcribe(){if(!audio)return;if(demo){setError("로컬 데모에서는 실제 AI 전사를 호출하지 않습니다.");return;}setBusy(true);setError("");try{const result=await transcribeMeeting(token,audio);setPreview(result.transcript);setAudio(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Card title="녹음·전사 / 파일 가져오기"><div className="kw-actions"><button disabled={busy} onClick={()=>recording?recorder.current?.stop():setConsent(true)}>{recording?"녹음 종료":"녹음 시작"}</button><button disabled={recording||busy} onClick={()=>input.current?.click()}>파일·Zoom 요약</button></div><input ref={input} hidden type="file" accept=".txt,.md,audio/*" onChange={e=>{const selected=e.target.files?.[0];if(selected)void file(selected);e.currentTarget.value="";}}/>
    <small>녹음 전 참석자 동의를 확인합니다. 음성은 서버에 보관하지 않고 전사 후 브라우저에서도 폐기합니다. 전사 실패 시 이 화면에서 재시도할 수 있습니다.</small>
    <details><summary>녹음·전사 보존 기준</summary><p>저장형 녹음 도입 시 원본 {MEETING_RETENTION.audioDays}일, 전사본 {MEETING_RETENTION.transcriptDays}일을 기본 보존 기간으로 적용하고 결정 근거 구간은 별도로 보존합니다.</p><small>현재는 음성 저장·자동 파기를 실행하지 않습니다. 메모에 추가한 전사 글은 회의록과 함께 보관됩니다.</small></details>
    {audio&&<button disabled={busy} onClick={()=>void transcribe()}>{busy?"전사 중…":"AI 전사 요청 · 외부 전송"}</button>}
    {preview&&<><label>가져온 원문 미리보기<textarea rows={6} value={preview} onChange={e=>setPreview(e.target.value)}/></label><button disabled={!preview.trim()} onClick={()=>{if(append(preview))setPreview("");}}>기존 메모 뒤에 추가</button></>}
    {error&&<p className="kw-error" role="alert">{error}</p>}{consent&&<Modal title="참석자에게 녹음을 알렸나요?" onClose={()=>setConsent(false)}><div className="kw-modal-body"><p>참석자 모두에게 녹음 목적을 알리고 동의를 받은 뒤 시작하세요. 전사는 별도 버튼을 눌러 요청합니다.</p><footer><button onClick={()=>setConsent(false)}>취소</button><button onClick={()=>void record()}>동의 확인 · 녹음 시작</button></footer></div></Modal>}
  </Card>;
}

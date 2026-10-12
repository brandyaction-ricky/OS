"use client";
import {useEffect,useRef,useState} from "react";
import {transcribeMeeting} from "@/lib/api-client";
import {useKnowledge} from "./provider";
import {Card,Modal} from "./ui";
import {MEETING_RETENTION} from "@/lib/knowledge/meetings";

const SEGMENT_MS=6000;
const MAX_SEGMENT_BYTES=3_900_000;

export function MeetingCapture({append}:{append:(text:string)=>boolean}){
  const {demo,token}=useKnowledge();
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const input=useRef<HTMLInputElement>(null),appendRef=useRef(append),wanted=useRef(false),alive=useRef(true);
  const queue=useRef<Promise<void>>(Promise.resolve()),failed=useRef<Blob[]>([]);
  appendRef.current=append;
  const [recording,setRecording]=useState(false),[consent,setConsent]=useState(false),[audio,setAudio]=useState<Blob|null>(null);
  const [preview,setPreview]=useState(""),[busy,setBusy]=useState(false),[pending,setPending]=useState(0),[failedCount,setFailedCount]=useState(0),[error,setError]=useState("");
  useEffect(()=>{alive.current=true;return()=>{
    alive.current=false;wanted.current=false;
    if(timer.current)clearTimeout(timer.current);
    if(recorder.current){recorder.current.onstop=null;recorder.current.ondataavailable=null;if(recorder.current.state!=="inactive")recorder.current.stop();}
    stream.current?.getTracks().forEach(track=>track.stop());
  };},[]);

  function enqueue(blob:Blob){
    setPending(count=>count+1);
    queue.current=queue.current.then(async()=>{
      try{
        const result=await transcribeMeeting(token,blob,{liveSegment:true});
        if(!alive.current)return;
        const text=result.transcript.trim();
        if(text&&!appendRef.current(text))setPreview(previous=>[previous,text].filter(Boolean).join("\n\n"));
      }catch(reason){
        if(!alive.current)return;
        failed.current.push(blob);
        setFailedCount(failed.current.length);
        setError((reason as Error).message+" · 해당 녹음 구간은 다시 전사할 수 있습니다.");
      }finally{if(alive.current)setPending(count=>Math.max(0,count-1));}
    });
  }

  function stopRecording(){
    wanted.current=false;
    if(timer.current)clearTimeout(timer.current);
    if(recorder.current?.state==="recording")recorder.current.stop();
  }

  function startSegment(mimeType?:string){
    if(!wanted.current||!stream.current)return;
    let instance:MediaRecorder;
    try{instance=new MediaRecorder(stream.current,{...(mimeType?{mimeType}:{}),audioBitsPerSecond:32000});}
    catch{
      wanted.current=false;stream.current.getTracks().forEach(track=>track.stop());stream.current=null;
      setRecording(false);setError("녹음 구간을 시작하지 못했습니다. 다시 시도해 주세요.");return;
    }
    recorder.current=instance;
    const chunks:Blob[]=[];
    let size=0,broken=false;
    instance.ondataavailable=event=>{
      if(!event.data.size)return;
      chunks.push(event.data);size+=event.data.size;
      if(size>MAX_SEGMENT_BYTES&&instance.state==="recording")instance.stop();
    };
    instance.onerror=()=>{broken=true;wanted.current=false;setError("녹음이 중단됐습니다. 마이크 권한을 확인해 주세요.");if(instance.state==="recording")instance.stop();};
    instance.onstop=()=>{
      if(timer.current)clearTimeout(timer.current);
      const blob=new Blob(chunks,{type:instance.mimeType||mimeType||"audio/webm"});
      if(wanted.current)startSegment(mimeType);
      else{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;setRecording(false);}
      if(!broken&&blob.size)enqueue(blob);
    };
    instance.start();
    timer.current=setTimeout(()=>{if(instance.state==="recording")instance.stop();},SEGMENT_MS);
  }

  async function record(){
    setConsent(false);setError("");
    if(demo){setError("로컬 데모에서는 녹음·AI 전사를 실행하지 않습니다. 텍스트 파일로 가져오기를 검증할 수 있습니다.");return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setError("이 브라우저에서 녹음을 지원하지 않습니다. 파일 가져오기를 이용해 주세요.");return;}
    try{
      stream.current=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!alive.current){stream.current.getTracks().forEach(track=>track.stop());stream.current=null;return;}
      const supported=["audio/webm;codecs=opus","audio/webm","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type));
      wanted.current=true;failed.current=[];setFailedCount(0);setAudio(null);
      startSegment(supported);setRecording(wanted.current);
    }catch{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;setError("마이크를 사용할 수 없습니다. 권한 또는 텍스트 가져오기를 확인하세요.");}
  }

  async function file(file:File){
    setError("");
    if(file.size>4_000_000){setError("4MB 이하 파일을 선택해 주세요.");return;}
    if(/\.(txt|md)$/i.test(file.name)){
      const text=await file.text();
      if(text.length>20000){setError("본문은 20,000자 이하로 나누어 주세요.");return;}
      setPreview(text);
    }else if(file.type.startsWith("audio/"))setAudio(file);
    else setError("TXT, Markdown 또는 음성 파일을 선택해 주세요.");
  }
  async function transcribe(blob:Blob){
    if(demo){setError("로컬 데모에서는 실제 AI 전사를 호출하지 않습니다.");return;}
    setBusy(true);setError("");
    try{
      const result=await transcribeMeeting(token,blob);
      if(!appendRef.current(result.transcript))setPreview(result.transcript);
      setAudio(null);
    }catch(reason){setError((reason as Error).message);}finally{setBusy(false);}
  }
  function retryFailed(){
    const retry=failed.current.splice(0);
    setFailedCount(0);setError("");
    retry.forEach(enqueue);
  }
  return <div className="kw-meeting-capture"><Card title="녹음·전사 / 파일 가져오기"><div className="kw-actions">
    <button disabled={busy||(!recording&&pending>0)} onClick={()=>recording?stopRecording():setConsent(true)}>{recording?"녹음 종료":"녹음 시작"}</button>
    <button disabled={recording||busy||pending>0} onClick={()=>input.current?.click()}>파일·Zoom 요약</button>
  </div><input ref={input} hidden type="file" accept=".txt,.md,audio/*" onChange={event=>{const selected=event.target.files?.[0];if(selected)void file(selected);event.currentTarget.value="";}}/>
    <small>참석자 동의 후 녹음 중 짧은 구간씩 OpenAI로 전송해 회의 메모에 표시합니다. 음성 원본은 서버에 저장하지 않습니다.</small>
    <details><summary>녹음·전사 보존 기준</summary><p>저장형 녹음 도입 시 원본 {MEETING_RETENTION.audioDays}일, 전사본 {MEETING_RETENTION.transcriptDays}일을 기본 보존 기간으로 적용하고 결정 근거 구간은 별도로 보존합니다.</p><small>현재는 음성 저장·자동 파기를 실행하지 않습니다. 메모에 추가한 전사 글은 회의록과 함께 보관됩니다.</small></details>
    {recording&&<p className="kw-recording-indicator" role="status">● 녹음 중 · 약 6초 간격으로 전사해 회의 메모에 표시합니다.</p>}
    {pending>0&&<p role="status">음성 {pending}구간을 전사하는 중입니다…</p>}
    {busy&&<p role="status">음성을 전사하는 중입니다…</p>}
    {audio&&!busy&&<button onClick={()=>void transcribe(audio)}>AI 전사 요청 · 외부 전송</button>}
    {failedCount>0&&<button disabled={recording||pending>0} onClick={retryFailed}>실패한 {failedCount}구간 다시 전사</button>}
    {preview&&<><label>가져온 원문 미리보기<textarea rows={6} value={preview} onChange={event=>setPreview(event.target.value)}/></label><button disabled={!preview.trim()} onClick={()=>{if(append(preview))setPreview("");}}>기존 메모 뒤에 추가</button></>}
    {error&&<p className="kw-error" role="alert">{error}</p>}
    {consent&&<Modal title="참석자에게 녹음을 알렸나요?" onClose={()=>setConsent(false)}><div className="kw-modal-body"><p>참석자 모두에게 녹음과 OpenAI 전사 전송 목적을 알리고 동의를 받은 뒤 시작하세요. 녹음 중 약 6초 간격으로 음성이 전사 API에 전송되고 결과가 회의 메모에 표시됩니다. 음성 원본은 서버에 저장하지 않습니다.</p><footer><button onClick={()=>setConsent(false)}>취소</button><button onClick={()=>void record()}>동의 확인 · 녹음 시작</button></footer></div></Modal>}
  </Card></div>;
}

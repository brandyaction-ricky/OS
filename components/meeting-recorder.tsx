"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {transcribeMeeting} from "@/lib/api-client";
import "./meeting-recorder.css";

// A meeting is recorded in back-to-back segments so it can run as long as it needs: the
// transcription endpoint takes one request under 4MB (about 16 minutes at 32kbps). Each segment
// is transcribed in order while recording continues and handed to onTranscript.
const SEGMENT_MS=10*60_000,SEGMENT_MAX_BYTES=3_600_000;
export type RecorderSegment={no:number;blob:Blob;seconds:number;state:"waiting"|"working"|"done"|"failed"};

export function useSegmentedRecorder({token,onTranscript}:{token:string|null;onTranscript:(text:string)=>void}){
  const stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null),active=useRef(false);
  const queue=useRef<Promise<void>>(Promise.resolve()),segmentNo=useRef(0),rotateTimer=useRef<number|null>(null);
  const deliver=useRef(onTranscript);deliver.current=onTranscript;
  const tokenRef=useRef(token);tokenRef.current=token;
  const [recording,setRecording]=useState(false),[startedAt,setStartedAt]=useState(0),[now,setNow]=useState(0);
  const [segments,setSegments]=useState<RecorderSegment[]>([]),[error,setError]=useState("");
  const mark=(no:number,state:RecorderSegment["state"])=>setSegments(list=>list.map(s=>s.no===no?{...s,state}:s));

  const stopAll=useCallback(()=>{active.current=false;if(rotateTimer.current)window.clearTimeout(rotateTimer.current);rotateTimer.current=null;
    if(recorder.current&&recorder.current.state!=="inactive")recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;},[]);
  useEffect(()=>()=>stopAll(),[stopAll]);
  useEffect(()=>{if(!recording)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[recording]);

  // Strictly in order, so the notes read in meeting order.
  const transcribe=useCallback((segment:RecorderSegment)=>{
    setSegments(list=>[...list.filter(s=>s.no!==segment.no),{...segment,state:"waiting" as const}].sort((a,b)=>a.no-b.no));
    queue.current=queue.current.then(async()=>{
      mark(segment.no,"working");
      try{const result=await transcribeMeeting(tokenRef.current,segment.blob);deliver.current(result.transcript);mark(segment.no,"done");}
      catch(e){mark(segment.no,"failed");setError(`${segment.no}구간 전사 실패: ${(e as Error).message} · 다시 시도할 수 있습니다.`);}
    });
  },[]);
  // Plain functions: everything they touch lives in refs, so a closure from any render works.
  function startSegment(){
    if(!stream.current)return;
    const supported=["audio/webm;codecs=opus","audio/webm","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type));
    const instance=new MediaRecorder(stream.current,{...(supported?{mimeType:supported}:{}),audioBitsPerSecond:32000});
    const chunks:Blob[]=[],no=++segmentNo.current,began=Date.now();let size=0;
    instance.ondataavailable=e=>{if(!e.data.size)return;chunks.push(e.data);size+=e.data.size;if(size>SEGMENT_MAX_BYTES&&active.current)rotate();};
    instance.onerror=()=>{setError("녹음이 중단됐습니다. 마이크 권한을 확인해 주세요.");stopAll();setRecording(false);};
    instance.onstop=()=>{const blob=new Blob(chunks,{type:instance.mimeType||"audio/webm"});
      if(blob.size>2000)transcribe({no,blob,seconds:Math.round((Date.now()-began)/1000),state:"waiting"});};
    instance.start(1000);recorder.current=instance;
    if(rotateTimer.current)window.clearTimeout(rotateTimer.current);rotateTimer.current=window.setTimeout(rotate,SEGMENT_MS);
  }
  // Start the next segment first, then close the previous one, so no words fall between them.
  function rotate(){if(!active.current)return;const previous=recorder.current;startSegment();if(previous&&previous.state!=="inactive")previous.stop();}

  async function start(){
    setError("");
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setError("이 브라우저에서 녹음을 지원하지 않습니다. 파일 가져오기를 이용해 주세요.");return;}
    try{stream.current=await navigator.mediaDevices.getUserMedia({audio:true});active.current=true;segmentNo.current=0;setSegments([]);
      startSegment();setStartedAt(Date.now());setNow(Date.now());setRecording(true);}
    catch{stopAll();setError("마이크를 사용할 수 없습니다. 권한을 확인하거나 녹음 파일을 올려 주세요.");}
  }
  function stop(){stopAll();setRecording(false);}
  return {recording,start,stop,error,segments,retry:(s:RecorderSegment)=>{setError("");transcribe(s);},
    minutes:Math.floor(Math.max(0,now-startedAt)/60_000)};
}

// What the person sees during and after a recording: elapsed time, and for every 10-minute
// segment whether it is transcribed, being transcribed, waiting or failed, with a progress bar.
export function RecorderProgress({recorder}:{recorder:ReturnType<typeof useSegmentedRecorder>}){
  const {recording,segments,minutes}=recorder;
  if(!recording&&!segments.length)return null;
  const done=segments.filter(s=>s.state==="done").length,failed=segments.filter(s=>s.state==="failed");
  const total=segments.length+(recording?1:0),finished=!recording&&done===segments.length;
  const label={waiting:"대기",working:"전사 중…",done:"완료",failed:"실패"} as const;
  const clock=(seconds:number)=>`${Math.floor(seconds/60)}분${seconds%60?` ${seconds%60}초`:""}`;
  return <div className="meeting-recorder-progress" role="status" aria-live="polite">
    <strong>{recording?`● 녹음 중 · ${minutes}분 경과`:finished?"✓ 전사 완료 · 메모에 모두 붙였습니다. 저장해 주세요.":failed.length?"일부 구간 전사 실패":"녹음 종료 · 남은 구간을 전사하는 중"}</strong>
    <div className="meeting-recorder-bar" aria-label={`전사 ${done}/${total}구간`}><i style={{width:`${total?done/total*100:0}%`}}/></div>
    <ol>{segments.map(s=><li key={s.no} data-state={s.state}><span>{s.no}구간 · {clock(s.seconds)}</span><span>{label[s.state]}</span>
      {s.state==="failed"?<button type="button" onClick={()=>recorder.retry(s)}>다시 시도</button>:null}</li>)}
      {recording?<li data-state="recording"><span>{segments.length+1}구간</span><span>녹음 중</span></li>:null}</ol>
    {!finished?<small>다른 메뉴로 옮겨도 녹음은 이어져요. 브라우저 탭을 닫거나 새로고침하면 멈춰요. 10분마다 한 구간씩 받아써요.</small>:null}
  </div>;
}

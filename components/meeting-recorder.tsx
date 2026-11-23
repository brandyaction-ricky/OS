"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {transcribeMeeting} from "@/lib/api-client";
import "./meeting-recorder.css";

// A meeting is recorded in back-to-back segments so it can run as long as it needs: the
// transcription endpoint takes one request under 4MB, and gpt-4o-mini-transcribe writes at most
// 2,000 tokens per request, which ten minutes of Korean speech can exceed (the rest is cut off).
// Five-minute segments stay well inside both. Each is transcribed in order and handed to onTranscript.
const SEGMENT_MS=5*60_000,SEGMENT_MAX_BYTES=3_600_000;
// A failed segment is tried again on its own (a token refresh or a network blip) before it asks the person.
const RETRY_DELAYS_MS=[5_000,30_000];
// 마이인 회의 2026-11-23: a 25-minute recording came back as one segment of near silence, transcribed as 「Дякую!」.
// The screen had gone off (or the device slept): the microphone stopped and the 5-minute timer froze while the clock ran.
// So the screen is kept on while recording, segments rotate by the clock, a silent microphone is shown within seconds,
// and a segment with no sound (or a speech-to-text guess with no Korean in it) is never added to the notes.
// SOUND_PEAK: 4 of 128 is just above a quiet room's floor; a segment is skipped only if not one sample in it passed.
const QUIET_WARN_MS=30_000,SOUND_PEAK=4;
export type RecorderSegment={no:number;blob:Blob;seconds:number;state:"waiting"|"working"|"done"|"failed"|"silent"};
/** Speech-to-text invents a short foreign phrase (「Дякую!」, "Thank you.") for a silent segment: no Korean, few letters. */
export const looksInvented=(text:string)=>!/[가-힣]/.test(text)&&text.replace(/\s/g,"").length<40;

export function useSegmentedRecorder({token,onTranscript}:{token:string|null;onTranscript:(text:string)=>void}){
  const stream=useRef<MediaStream|null>(null),recorder=useRef<MediaRecorder|null>(null),active=useRef(false);
  const queue=useRef<Promise<void>>(Promise.resolve()),segmentNo=useRef(0),rotateTimer=useRef<number|null>(null);
  const deliver=useRef(onTranscript);deliver.current=onTranscript;
  const tokenRef=useRef(token);tokenRef.current=token;
  const [recording,setRecording]=useState(false),[startedAt,setStartedAt]=useState(0),[now,setNow]=useState(0);
  const [segments,setSegments]=useState<RecorderSegment[]>([]),[error,setError]=useState("");
  // Sound check: lastSound feeds the 「소리가 안 들려요」 warning; heard is the current segment's own 'any sound at all'.
  const audio=useRef<{ctx:AudioContext;read:()=>number}|null>(null),lastSound=useRef(0),heard=useRef({sound:false}),wake=useRef<WakeLockSentinel|null>(null);
  const [quiet,setQuiet]=useState(false),[paused,setPaused]=useState(false);
  const mark=(no:number,state:RecorderSegment["state"])=>setSegments(list=>list.map(s=>s.no===no?{...s,state}:s));

  const stopAll=useCallback(()=>{active.current=false;if(rotateTimer.current)window.clearTimeout(rotateTimer.current);rotateTimer.current=null;
    if(recorder.current&&recorder.current.state!=="inactive")recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;
    void audio.current?.ctx.close().catch(()=>{});audio.current=null;void wake.current?.release().catch(()=>{});wake.current=null;setQuiet(false);setPaused(false);},[]);
  useEffect(()=>()=>stopAll(),[stopAll]);
  // Every 250 ms: listen for sound. Also rotate by the clock, since a timer stands still while the device sleeps.
  useEffect(()=>{if(!recording)return;const timer=window.setInterval(()=>{const at=Date.now();setNow(Math.floor(at/1000)*1000);// same second: no re-render

    const a=audio.current;if(a&&a.ctx.state==="running"&&a.read()>SOUND_PEAK){lastSound.current=at;heard.current.sound=true;}
    setQuiet(Boolean(a&&a.ctx.state==="running")&&at-lastSound.current>QUIET_WARN_MS);
  },250);return()=>window.clearInterval(timer);},[recording]);
  // Keep the screen on while recording (it is released when the page is hidden, so take it again on return).
  useEffect(()=>{if(!recording)return;const hold=()=>{if(document.visibilityState==="visible"&&!wake.current)void navigator.wakeLock?.request("screen").then(lock=>{wake.current=lock;lock.addEventListener("release",()=>{if(wake.current===lock)wake.current=null;});}).catch(()=>{});};
    hold();document.addEventListener("visibilitychange",hold);return()=>document.removeEventListener("visibilitychange",hold);},[recording]);

  // Strictly in order, so the notes read in meeting order.
  const transcribe=useCallback((segment:RecorderSegment)=>{
    setSegments(list=>[...list.filter(s=>s.no!==segment.no),{...segment,state:"waiting" as const}].sort((a,b)=>a.no-b.no));
    queue.current=queue.current.then(async()=>{
      mark(segment.no,"working");
      for(let attempt=0;;attempt++){
        try{const result=await transcribeMeeting(tokenRef.current,segment.blob);
          if(looksInvented(result.transcript)){mark(segment.no,"silent");return;}
          deliver.current(result.transcript);mark(segment.no,"done");return;}
        catch(e){
          if(attempt<RETRY_DELAYS_MS.length){await new Promise(resolve=>window.setTimeout(resolve,RETRY_DELAYS_MS[attempt]));continue;}
          mark(segment.no,"failed");setError(`${segment.no}구간 받아쓰기 실패: ${(e as Error).message} · 「다시 시도」를 눌러 주세요.`);return;
        }
      }
    });
  },[]);
  // Plain functions: everything they touch lives in refs, so a closure from any render works.
  function startSegment(){
    if(!stream.current)return;
    const supported=["audio/webm;codecs=opus","audio/webm","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type));
    const instance=new MediaRecorder(stream.current,{...(supported?{mimeType:supported}:{}),audioBitsPerSecond:32000});
    const chunks:Blob[]=[],no=++segmentNo.current,began=Date.now();let size=0;
    // Each segment keeps its own record of sound; judged only when the sound check runs.
    const checking=audio.current?.ctx.state==="running",ears={sound:false};heard.current=ears;
    instance.ondataavailable=e=>{if(!e.data.size)return;chunks.push(e.data);size+=e.data.size;
      if(active.current&&recorder.current===instance&&(size>SEGMENT_MAX_BYTES||Date.now()-began>=SEGMENT_MS))rotate();};
    instance.onerror=()=>{setError("녹음이 중단됐습니다. 마이크 권한을 확인해 주세요.");stopAll();setRecording(false);};
    instance.onstop=()=>{const blob=new Blob(chunks,{type:instance.mimeType||"audio/webm"}),seconds=Math.round((Date.now()-began)/1000);
      // No sound in the whole segment: nothing to transcribe (and nothing to pay for).
      if(checking&&!ears.sound){setSegments(list=>[...list,{no,blob,seconds,state:"silent" as const}].sort((a,b)=>a.no-b.no));return;}
      if(blob.size>2000)transcribe({no,blob,seconds,state:"waiting"});};
    instance.start(1000);recorder.current=instance;
    if(rotateTimer.current)window.clearTimeout(rotateTimer.current);rotateTimer.current=window.setTimeout(rotate,SEGMENT_MS);
  }
  // Start the next segment first, then close the previous one, so no words fall between them.
  function rotate(){if(!active.current)return;const previous=recorder.current;startSegment();if(previous&&previous.state!=="inactive")previous.stop();}

  async function start(){
    setError("");
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setError("이 브라우저에서 녹음을 지원하지 않습니다. 파일 가져오기를 이용해 주세요.");return;}
    try{const media=await navigator.mediaDevices.getUserMedia({audio:true});stream.current=media;active.current=true;segmentNo.current=0;setSegments([]);
      try{const ctx=new AudioContext(),analyser=ctx.createAnalyser(),wave=new Uint8Array(1024);analyser.fftSize=1024;ctx.createMediaStreamSource(media).connect(analyser);void ctx.resume().catch(()=>{});
        audio.current={ctx,read:()=>{analyser.getByteTimeDomainData(wave);let peak=0;for(const v of wave)peak=Math.max(peak,Math.abs(v-128));return peak;}};}catch{audio.current=null;}
      lastSound.current=Date.now();
      // The microphone goes quiet when the screen locks or another app takes it; it ends when it is unplugged or taken away.
      const track=media.getAudioTracks()[0];
      if(track){track.onmute=()=>setPaused(true);track.onunmute=()=>setPaused(false);
        track.onended=()=>{if(!active.current)return;setError("마이크가 꺼져서 녹음이 멈췄어요. 여기까지 녹음한 건 받아써요. 이어서 하려면 「녹음 시작」을 다시 눌러 주세요.");stopAll();setRecording(false);};}
      startSegment();setStartedAt(Date.now());setNow(Date.now());setRecording(true);}
    catch{stopAll();setError("마이크를 사용할 수 없습니다. 권한을 확인하거나 녹음 파일을 올려 주세요.");}
  }
  function stop(){stopAll();setRecording(false);}
  return {recording,start,stop,error,segments,quiet,paused,retry:(s:RecorderSegment)=>{setError("");transcribe(s);},
    minutes:Math.floor(Math.max(0,now-startedAt)/60_000)};
}

// What the person sees during and after a recording: elapsed time, and for every 5-minute
// segment whether it is transcribed, being transcribed, waiting or failed, with a progress bar.
export function RecorderProgress({recorder}:{recorder:ReturnType<typeof useSegmentedRecorder>}){
  const {recording,segments,minutes,quiet,paused}=recorder;
  if(!recording&&!segments.length)return null;
  const silent=segments.filter(s=>s.state==="silent").length,done=segments.filter(s=>s.state==="done").length+silent,failed=segments.filter(s=>s.state==="failed");
  const total=segments.length+(recording?1:0),finished=!recording&&done===segments.length;
  const label={waiting:"대기",working:"전사 중…",done:"완료",failed:"실패",silent:"소리 없음"} as const;
  const clock=(seconds:number)=>`${Math.floor(seconds/60)}분${seconds%60?` ${seconds%60}초`:""}`;
  return <div className="meeting-recorder-progress" role="status" aria-live="polite">
    <strong>{recording?`● 녹음 중 · ${minutes}분 경과`:finished?(silent===segments.length?"녹음에 소리가 담기지 않았어요":silent?`✓ 받아쓰기 완료 · 소리 없는 구간 ${silent}개는 빼고 메모에 붙였어요`:"✓ 받아쓰기 완료 · 메모에 모두 붙였어요"):failed.length?"일부 구간 전사 실패":"녹음 종료 · 남은 구간을 전사하는 중"}</strong>
    {recording&&paused?<p className="meeting-recorder-warn" role="alert">녹음이 멈춰 있어요. 화면이 꺼졌거나 다른 앱이 마이크를 쓰고 있어요. 이 화면을 켜 둔 채로 회의해 주세요.</p>
      :recording&&quiet?<p className="meeting-recorder-warn" role="alert">30초째 소리가 안 들려요. 마이크가 켜져 있는지, 맞는 마이크인지 확인해 주세요.</p>:null}
    {finished&&silent?<p className="meeting-recorder-warn">소리 없는 구간은 받아쓰지 않았어요. 화면이 꺼지거나 기기가 잠들면 녹음이 멈춰요.</p>:null}
    <div className="meeting-recorder-bar" aria-label={`전사 ${done}/${total}구간`}><i style={{width:`${total?done/total*100:0}%`}}/></div>
    <ol>{segments.map(s=><li key={s.no} data-state={s.state}><span>{s.no}구간 · {clock(s.seconds)}</span><span>{label[s.state]}</span>
      {s.state==="failed"?<button type="button" onClick={()=>recorder.retry(s)}>다시 시도</button>:s.state==="silent"&&!recording?<button type="button" onClick={()=>recorder.retry(s)}>그래도 받아쓰기</button>:null}</li>)}
      {recording?<li data-state="recording"><span>{segments.length+1}구간</span><span>녹음 중</span></li>:null}</ol>
    {!finished?<small>다른 메뉴로 옮겨도 녹음은 이어져요. 탭을 닫거나 새로고침하거나 화면이 꺼지면 멈춰요. 5분마다 한 구간씩 받아써요.</small>:null}
  </div>;
}

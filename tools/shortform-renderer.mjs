import { spawn,execFileSync } from "node:child_process";
import { readFileSync,writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const captionTool=fileURLToPath(new URL("./shortform-caption.py",import.meta.url));
// 9:16 for Shorts · Reels, 1:1 for feed ads (owner request 2026-10-25). A wide original keeps its own band; the caption plate sits below it.
export const SHORTFORM_LAYOUTS={
  "9:16":{w:720,h:1280,bgW:180,bgH:320,wideH:600,wideY:220,maxrate:"2500k",caption:{font:38,line:52,maxWidth:600,margin:36,compactTop:840,bottom:1100}},
  "1:1":{w:1080,h:1080,bgW:270,bgH:270,wideH:608,wideY:80,maxrate:"3000k",caption:{font:52,line:70,maxWidth:940,margin:50,compactTop:752,bottom:1040}},
};
const fail=(code)=>Object.assign(new Error(code),{code});
export function checkShortformRuntime(){
  try{
    execFileSync(process.env.SHORTFORM_FFMPEG||"ffmpeg",["-version"],{stdio:"ignore"});
    execFileSync(process.env.SHORTFORM_FFPROBE||"ffprobe",["-version"],{stdio:"ignore"});
    execFileSync(process.env.MINDMAP_PYTHON||"python3",["-c",
      "import os; from PIL import ImageFont; ImageFont.truetype(os.environ.get('SHORTFORM_FONT_FILE', '/System/Library/Fonts/AppleSDGothicNeo.ttc'), 38)"],
    {stdio:"ignore"});
  }catch{throw fail("SHORTFORM_RUNTIME_MISSING");}
}
async function run(command,args){
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:["ignore","ignore","pipe"]});let stderr="";
    const timer=setTimeout(()=>{child.kill("SIGKILL");reject(fail("SHORTFORM_RENDER_TIMEOUT"));},10*60_000);
    child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-4000);});
    child.on("error",error=>{clearTimeout(timer);reject(error);});
    child.on("close",code=>{clearTimeout(timer);if(code===0)resolve();else reject(fail(stderr.includes("SHORTFORM_CAPTION_TOO_LONG")?"SHORTFORM_CAPTION_TOO_LONG":"SHORTFORM_RENDER_FAILED"));});
  });
}
export function probeShortform(file,ffprobe=process.env.SHORTFORM_FFPROBE||"ffprobe"){
  const value=JSON.parse(execFileSync(ffprobe,["-v","error","-show_streams","-show_format","-of","json",file],{encoding:"utf8",timeout:20_000}));
  return {duration:Number(value.format.duration),video:value.streams.find(stream=>stream.codec_type==="video"),
    audio:value.streams.find(stream=>stream.codec_type==="audio")};
}
/** Local files only. URL fetching and credentials stay in the worker. */
export async function renderShortform({mode,scenes,sourceFile,dir,aspect="9:16",ffmpeg=process.env.SHORTFORM_FFMPEG||"ffmpeg",python=process.env.MINDMAP_PYTHON||"python3"}){
  const L=SHORTFORM_LAYOUTS[aspect];
  if(!L||!["direct","reuse"].includes(mode)||!Array.isArray(scenes)||!scenes.length||scenes.length>20)throw fail("SHORTFORM_PLAN_INVALID");
  const segments=[];let total=0;
  const source=mode==="reuse"?probeShortform(sourceFile):null;
  if(source&&!source.audio)throw fail("SHORTFORM_SOURCE_AUDIO_MISSING");
  for(const [index,scene] of scenes.entries()){
    const duration=scene.end-scene.start;
    if(!Number.isFinite(duration)||duration<=0||scene.start<0||duration>60||source&&scene.end>source.duration+0.1)
      throw fail("SHORTFORM_RANGE_INVALID");
    total+=duration;if(total>60)throw fail("SHORTFORM_DURATION_INVALID");
    if(mode==="direct"&&scene.audioFile&&probeShortform(scene.audioFile).duration>duration+0.1)
      throw fail("SHORTFORM_VOICE_TOO_LONG");
    if(mode==="direct"&&scene.hasVoice&&!scene.audioFile)throw fail("SHORTFORM_VOICE_MISSING");
    const visual=source?.video??probeShortform(scene.imageFile).video;
    if(!visual?.width||!visual?.height)throw fail("SHORTFORM_IMAGE_INVALID");
    const wide=visual.width/visual.height>1;
    const caption=path.join(dir,`caption-${index}.png`),data=path.join(dir,`caption-${index}.json`),output=path.join(dir,`scene-${index}.mov`);
    writeFileSync(data,JSON.stringify({text:scene.text,compact:wide,width:L.w,height:L.h,...L.caption}));
    await run(python,[captionTool,data,caption]);
    const inputs=mode==="reuse"?["-ss",String(scene.start),"-t",String(duration),"-i",sourceFile]:
      ["-loop","1","-framerate","30","-i",scene.imageFile];
    inputs.push("-loop","1","-framerate","30","-i",caption);
    if(mode==="direct"){
      if(scene.audioFile)inputs.push("-i",scene.audioFile);
      else inputs.push("-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=48000");
    }
    // Never crop the readable foreground. A low-resolution, blurred duplicate fills unused space.
    const composition="[0:v]split=2[back][front];"+
      `[back]scale=${L.bgW}:${L.bgH}:force_original_aspect_ratio=increase,crop=${L.bgW}:${L.bgH},boxblur=12:2,eq=brightness=-0.18:saturation=0.55,scale=${L.w}:${L.h},setsar=1[bg];`+
      `[front]scale=${L.w}:${wide?L.wideH:L.h}:force_original_aspect_ratio=decrease,setsar=1[fg];`+
      `[bg][fg]overlay=(W-w)/2:${wide?`${L.wideY}+(${L.wideH}-h)/2`:"(H-h)/2"}[base];`+
      "[base][1:v]overlay=0:0,format=yuv420p[v]";
    await run(ffmpeg,["-v","error","-y",...inputs,"-filter_complex",composition,
      "-map","[v]","-map",mode==="reuse"?"0:a:0":"2:a:0","-af","apad","-t",String(duration),"-r","30",
      "-c:v","libx264","-preset","veryfast","-crf","23","-maxrate",L.maxrate,"-bufsize","5000k","-threads","2",
      "-c:a","pcm_s16le","-ar","48000","-ac","2","-movflags","+faststart",output]);
    segments.push({file:output,duration});
  }
  const list=path.join(dir,"segments.txt"),output=path.join(dir,"shortform.mp4");
  // Generated basenames avoid quoting user-supplied filenames in the concat manifest.
  // PCM intermediates avoid AAC priming at every cut. Use editorial durations
  // for the next cut's timestamp, then encode audio once on the joined timeline.
  writeFileSync(list,segments.map(({file,duration})=>`file '${path.basename(file)}'\nduration ${duration}`).join("\n"));
  await run(ffmpeg,["-v","error","-y","-f","concat","-safe","1","-i",list,
    "-af","aresample=async=1:first_pts=0","-t",String(total),"-r","30",
    "-c:v","libx264","-preset","veryfast","-crf","23","-threads","2",
    "-c:a","aac","-ar","48000","-ac","2","-b:a","128k","-movflags","+faststart",output]);
  const result=probeShortform(output);
  if(result.video?.width!==L.w||result.video?.height!==L.h||!result.audio||Math.abs(result.duration-total)>0.2
    ||readFileSync(output).length>50_000_000)throw fail("SHORTFORM_OUTPUT_INVALID");
  return {file:output,duration:result.duration};
}

/** Offline bridge to a separately installed, reviewed Logan portrait package.
 * Scene clocks are local to each cut; narration cues must already be resolved.
 * No downloads, account credentials, paid synthesis, or worker registration here.
 */
import { spawn,execFileSync } from "node:child_process";
import { mkdirSync,writeFileSync,existsSync,readFileSync } from "node:fs";
import path from "node:path";
export const SHORTFORM_DIAGRAM_TYPES=new Set(JSON.parse(readFileSync(new URL("../lib/shortform-diagram-catalog.json",import.meta.url),"utf8")).map(row=>row.type));

/** Advertise only when the opt-in package and local dependencies can be loaded. */
export function shortformDiagramCapabilities(){
  const root=process.env.SHORTFORM_DIAGRAM_PACKAGE,fonts=process.env.MYIN_FONT_DIR;
  if(!root||!path.isAbsolute(root)||!fonts||!existsSync(path.join(root,"portrait","render_job.py"))||!existsSync(path.join(fonts,"Pretendard-Bold.otf")))return [];
  try{
    const available=JSON.parse(execFileSync(process.env.MINDMAP_PYTHON||"python3",["-c","import PIL,json,sys; sys.path.insert(0,sys.argv[1]); import render_job; print(json.dumps([\"lib_\"+r[0] for r in render_job.V.L.REGISTRY]))",path.join(root,"portrait")],{encoding:"utf8",timeout:10000}));
    execFileSync(process.execPath,["-e","const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('fs');if(!fs.existsSync(process.env.CHROME_PATH||chromium.executablePath()))process.exit(1)"],{stdio:"ignore",timeout:10000});
    return [...SHORTFORM_DIAGRAM_TYPES].filter(type=>available.includes(type));
  }catch{return [];}
}

const fail=code=>Object.assign(new Error(code),{code});
async function run(command,args){
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:"ignore"});
    const timer=setTimeout(()=>{child.kill("SIGKILL");reject(fail("SHORTFORM_DIAGRAM_TIMEOUT"));},10*60_000);
    child.once("error",()=>{clearTimeout(timer);reject(fail("SHORTFORM_DIAGRAM_FAILED"));});
    child.once("close",code=>{clearTimeout(timer);if(code===0)resolve();else reject(fail("SHORTFORM_DIAGRAM_FAILED"));});
  });
}
export async function prepareShortformDiagrams({scenes,dir,mode,aspect="9:16",packageRoot=process.env.SHORTFORM_DIAGRAM_PACKAGE,
  python=process.env.MINDMAP_PYTHON||"python3",ffmpeg=process.env.SHORTFORM_FFMPEG||"ffmpeg"}){
  if(!scenes.some(scene=>scene.diagram))return scenes;
  if(mode!=="direct"||aspect!=="9:16")throw fail("SHORTFORM_DIAGRAM_ASPECT_UNSUPPORTED");
  let total=0;
  for(const scene of scenes){
    const duration=scene.end-scene.start;
    if(!Number.isFinite(scene.start)||!Number.isFinite(scene.end)||scene.start<0||duration<=0||duration>60||(total+=duration)>60)throw fail("SHORTFORM_RANGE_INVALID");
    if(!scene.diagram)continue;
    if(!SHORTFORM_DIAGRAM_TYPES.has(scene.diagram.type))throw fail("SHORTFORM_DIAGRAM_UNSUPPORTED");
    if(!scene.diagram.scene||typeof scene.diagram.scene!=="object"||Array.isArray(scene.diagram.scene)||scene.imageFile||scene.diagramFile)
      throw fail("SHORTFORM_DIAGRAM_INVALID");
  }
  if(!packageRoot||!path.isAbsolute(packageRoot))throw fail("SHORTFORM_DIAGRAM_PACKAGE_MISSING");
  const script=path.join(packageRoot,"portrait","render_job.py");
  if(!existsSync(script))throw fail("SHORTFORM_DIAGRAM_PACKAGE_MISSING");
  const result=[];
  for(const [index,scene] of scenes.entries()){
    if(!scene.diagram){result.push(scene);continue;}
    const root=path.join(dir,`diagram-${index}`);mkdirSync(root); // Never reuse stale frames.
    const job=path.join(root,"job.json"),frames=path.join(root,"frames"),video=path.join(root,"diagram.mp4");
    const duration=scene.end-scene.start;
    writeFileSync(job,JSON.stringify({type:scene.diagram.type,scene:scene.diagram.scene,duration,aspectRatio:"9:16",fps:30,caption:"",png:true}));
    await run(python,[script,job,frames]);
    await run(ffmpeg,["-v","error","-y","-framerate","30","-i",path.join(frames,"%04d.png"),"-t",String(duration),
      "-an","-c:v","libx264","-preset","veryfast","-crf","18","-threads","2","-pix_fmt","yuv420p",video]);
    const rest={...scene};delete rest.diagram;result.push({...rest,diagramFile:video});
  }
  return result;
}

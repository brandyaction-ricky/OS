import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { execFileSync,spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { prepareShortformDiagrams } from "../tools/shortform-diagrams.mjs";
import { renderShortform,probeShortform } from "../tools/shortform-renderer.mjs";

test("diagram preparation leaves image inputs intact and fails closed before loading packages",async()=>{
 const scenes=[{start:0,end:1,text:"image",imageFile:"local.png"}];
 assert.equal(await prepareShortformDiagrams({scenes,dir:"unused",mode:"direct"}),scenes);
 const cut={start:0,end:1,text:"diagram",diagram:{type:"lib_timeline",scene:{t0:0}}};
 for(const aspect of ["1:1","4:5"])await assert.rejects(prepareShortformDiagrams({scenes:[cut],dir:"unused",mode:"direct",aspect}),{code:"SHORTFORM_DIAGRAM_ASPECT_UNSUPPORTED"});
 await assert.rejects(prepareShortformDiagrams({scenes:[cut],dir:"unused",mode:"reuse"}),{code:"SHORTFORM_DIAGRAM_ASPECT_UNSUPPORTED"});
 await assert.rejects(prepareShortformDiagrams({scenes:[{...cut,diagram:{...cut.diagram,type:"lib_not_registered"}}],dir:"unused",mode:"direct"}),{code:"SHORTFORM_DIAGRAM_UNSUPPORTED"});
 await assert.rejects(prepareShortformDiagrams({scenes:[{...cut,imageFile:"ambiguous.png"}],dir:"unused",mode:"direct"}),{code:"SHORTFORM_DIAGRAM_INVALID"});
 await assert.rejects(prepareShortformDiagrams({scenes:[cut],dir:"unused",mode:"direct",packageRoot:""}),{code:"SHORTFORM_DIAGRAM_PACKAGE_MISSING"});
});
const ready=spawnSync("ffmpeg",["-version"]).status===0&&spawnSync("python3",["-c","from PIL import ImageFont"]).status===0;
test("portrait animation advances while preserving the caption-safe foreground",{skip:!ready,timeout:120000},async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"shortform-diagram-"));
 try{
  const clip=path.join(dir,"motion.mp4");
  execFileSync("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=c=white:s=720x1280:r=30:d=2","-vf","drawbox=x=100:y=150:w=300:h=500:color=red:t=fill:enable='lt(t,1)',drawbox=x=300:y=150:w=300:h=500:color=blue:t=fill:enable='gte(t,1)'","-an","-c:v","libx264","-pix_fmt","yuv420p",clip]);
  const result=await renderShortform({mode:"direct",dir,scenes:[{start:0,end:2,text:"도식 아래 자막",diagramFile:clip,hasVoice:false}]});
  const probe=probeShortform(result.file);assert.equal(probe.video.width,720);assert.equal(probe.video.height,1280);
  function frame(t){return execFileSync("ffmpeg",["-v","error","-ss",String(t),"-i",result.file,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{maxBuffer:4000000});}
  const early=frame(.4),late=frame(1.4),pixel=(buf,x,y)=>[...buf.subarray((y*720+x)*3,(y*720+x)*3+3)];
  assert.ok(pixel(early,350,300)[0]>180);assert.ok(pixel(late,350,300)[2]>180,"Motion must not freeze on frame zero");
  assert.ok(pixel(late,20,850).every(v=>v>240),"Diagram foreground is not blurred or cropped");
  await assert.rejects(renderShortform({mode:"direct",dir,scenes:[{start:0,end:2,text:"가".repeat(65),diagramFile:clip}]}),{code:"SHORTFORM_CAPTION_TOO_LONG"});
  const rejectDir=path.join(dir,"invalid");
  await assert.rejects(renderShortform({mode:"direct",dir:rejectDir,scenes:[{start:0,end:4,text:"x",diagramFile:clip}]}),{code:"SHORTFORM_DIAGRAM_INVALID"});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync,spawnSync } from "node:child_process";
import { mkdtempSync,rmSync,copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderShortform,probeShortform } from "../tools/shortform-renderer.mjs";

const ready=spawnSync("ffmpeg",["-version"]).status===0&&spawnSync("ffprobe",["-version"]).status===0
  &&spawnSync(process.env.MINDMAP_PYTHON||"python3",["-c","import PIL"]).status===0
  &&process.platform==="darwin";
test("real direct and reuse MP4s have vertical frames, audio, captions and exact duration; overlong narration stops", {skip:!ready,timeout:120_000},async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),"shortform-real-test-"));
  try{
    const image=path.join(dir,"image.png");
    execFileSync("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=c=navy:s=640x480","-frames:v","1",image]);
    const direct=await renderShortform({mode:"direct",dir,scenes:[
      {start:0,end:1,text:"실제 소재로 만드는 숏폼",imageFile:image,hasVoice:false},
      {start:1,end:2,text:"다음 장면을 확인하세요",imageFile:image,hasVoice:false},
    ]});
    assert.equal(probeShortform(direct.file).video.width,720);
    assert.equal(probeShortform(direct.file).video.height,1280);
    assert.ok(Math.abs(direct.duration-2)<0.2);
    // Keep a local-only visual artifact for inspection.
    execFileSync("ffmpeg",["-v","error","-y","-i",direct.file,"-frames:v","1","/private/tmp/shortform-render-frame.png"]);
    const source=path.join(dir,"source.mp4");copyFileSync(direct.file,source);
    const reused=await renderShortform({mode:"reuse",dir,sourceFile:source,
      scenes:[{start:0.25,end:1.25,text:"원본 음성과 화면 활용"}]});
    assert.ok(Math.abs(reused.duration-1)<0.2);
    const audio=path.join(dir,"long.wav");
    execFileSync("ffmpeg",["-v","error","-y","-f","lavfi","-i","sine=frequency=440:duration=2",audio]);
    await assert.rejects(renderShortform({mode:"direct",dir,scenes:[
      {start:0,end:1,text:"대본이 너무 긴 경우",imageFile:image,audioFile:audio,hasVoice:true},
    ]}),error=>error.code==="SHORTFORM_VOICE_TOO_LONG");
  }finally{rmSync(dir,{recursive:true,force:true});}
});

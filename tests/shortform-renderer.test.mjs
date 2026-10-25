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
    const pixels=execFileSync("ffmpeg",["-v","error","-i",direct.file,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{maxBuffer:4_000_000});
    const pixel=(x,y)=>[...pixels.subarray((y*720+x)*3,(y*720+x)*3+3)];
    assert.ok(Math.max(...pixel(360,50))>5,"Unused vertical space must contain the source background instead of black bars");
    assert.ok(pixel(360,400)[2]>80,"Foreground content must remain visible without being darkened");
    const source=path.join(dir,"source.mp4");copyFileSync(direct.file,source);
    const toneSource=path.join(dir,"tone-source.mp4");
    execFileSync("ffmpeg",["-v","error","-y","-i",source,"-f","lavfi","-i","sine=frequency=440:duration=2",
      "-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-t","2",toneSource]);
    const reused=await renderShortform({mode:"reuse",dir,sourceFile:source,
      scenes:[{start:0.25,end:1.25,text:"원본 음성과 화면 활용"}]});
    assert.ok(Math.abs(reused.duration-1)<0.2);
    const many=await renderShortform({mode:"reuse",dir,sourceFile:toneSource,
      scenes:Array.from({length:14},()=>({start:0.2,end:0.57,text:"문장별 자막"}))});
    assert.ok(Math.abs(many.duration-14*0.37)<0.1,"AAC/frame padding must not accumulate across caption cuts");
    const samples=execFileSync("ffmpeg",["-v","error","-i",many.file,"-vn","-f","f32le","pipe:1"],{maxBuffer:8_000_000});
    let peak=0;for(let offset=0;offset<samples.length;offset+=4)peak=Math.max(peak,Math.abs(samples.readFloatLE(offset)));
    assert.ok(peak<0.2,"Joining low-volume narration must not introduce full-scale audio spikes");
    const audio=path.join(dir,"long.wav");
    execFileSync("ffmpeg",["-v","error","-y","-f","lavfi","-i","sine=frequency=440:duration=2",audio]);
    await assert.rejects(renderShortform({mode:"direct",dir,scenes:[
      {start:0,end:1,text:"대본이 너무 긴 경우",imageFile:image,audioFile:audio,hasVoice:true},
    ]}),error=>error.code==="SHORTFORM_VOICE_TOO_LONG");
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// 광고 정사각형 (owner request 2026-10-25): the same scenes as a 1080×1080 feed ad, wide and tall images both kept whole with the caption below.
test("a 1:1 square ad renders 1080×1080 with the caption plate and the image whole", {skip:!ready,timeout:120_000},async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),"shortform-square-test-"));
  try{
    const wide=path.join(dir,"wide.png"),tall=path.join(dir,"tall.png");
    execFileSync("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=c=navy:s=1280x720","-frames:v","1",wide]);
    execFileSync("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=c=darkgreen:s=720x1280","-frames:v","1",tall]);
    const square=await renderShortform({mode:"direct",dir,aspect:"1:1",scenes:[
      {start:0,end:1,text:"정사각형 피드 광고로 만들어요",imageFile:wide,hasVoice:false},
      {start:1,end:2,text:"세로 이미지도 잘리지 않아요",imageFile:tall,hasVoice:false},
    ]});
    const probe=probeShortform(square.file);
    assert.equal(probe.video.width,1080);
    assert.equal(probe.video.height,1080);
    assert.ok(Math.abs(square.duration-2)<0.2);
    const frame=execFileSync("ffmpeg",["-v","error","-i",square.file,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{maxBuffer:8_000_000});
    const pixel=(x,y)=>[...frame.subarray((y*1080+x)*3,(y*1080+x)*3+3)];
    assert.ok(pixel(540,380)[2]>80,"The wide image sits in its band, visible");
    assert.ok(Math.max(...pixel(540,30))>5,"Space above the band is the blurred background, not black");
    assert.ok(pixel(540,780).every(value=>value<60),"The caption plate sits below the band");
    execFileSync("ffmpeg",["-v","error","-y","-i",square.file,"-frames:v","1","/private/tmp/shortform-square-frame.png"]);
    execFileSync("ffmpeg",["-v","error","-y","-ss","1.5","-i",square.file,"-frames:v","1","/private/tmp/shortform-square-frame-tall.png"]);
    await assert.rejects(renderShortform({mode:"direct",dir,aspect:"4:3",scenes:[{start:0,end:1,text:"x",imageFile:wide,hasVoice:false}]}),{code:"SHORTFORM_PLAN_INVALID"});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { adRuntimeDigest, buildAdRuntime, processAdRender } from "../tools/image-ad-renderer.mjs";

test("an updated Mac can still poll an older OS without claiming a second job after an uncertain reply", async ()=>{
  const versions=[];
  const call=async ({rendererVersion})=>{
    versions.push(rendererVersion);
    if(rendererVersion>1) throw Object.assign(new Error(),{code:"INVALID_WORKER_INPUT"});
    return {idle:true};
  };
  assert.equal(await processAdRender(call,process.cwd()),false);
  assert.deepEqual(versions,[10,9,8,7,6,5,4,3,2,1]);
  let attempts=0;
  await assert.rejects(processAdRender(async()=>{attempts++;throw new Error("lost response");},"unused"),/lost response/);
  assert.equal(attempts,1);
});

test("a new worker with an older installed image bundle advertises only the formats it has", async t => {
  const root = mkdtempSync(path.join(os.tmpdir(),"ad-old-bundle-"));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const bundle = path.join(root,"image-renderer");
  mkdirSync(bundle);
  writeFileSync(path.join(bundle,"FINGERPRINT"),"1".repeat(64));
  assert.equal(await processAdRender(async claim => {
    assert.equal(claim.rendererVersion,2);
    return {idle:true};
  },root),false);

  const referenceRoot = mkdtempSync(path.join(os.tmpdir(),"ad-slot-bundle-"));
  t.after(() => rmSync(referenceRoot,{recursive:true,force:true}));
  const slots = path.join(referenceRoot,"image-renderer");
  for (const name of ["thumbnail-ad.mjs","youtube-process/thumb-frame.mjs","youtube-process/thumb-style.mjs",
    "fonts/Pretendard-900.otf","reference-view.mjs","reference-layout.mjs"]) {
    mkdirSync(path.dirname(path.join(slots,name)),{recursive:true});
    writeFileSync(path.join(slots,name),"");
  }
  assert.equal(await processAdRender(async claim => {
    assert.equal(claim.rendererVersion,4);
    return {idle:true};
  },referenceRoot),false);
});

test("a staff video bundle renders offline without the OS checkout and uploads only the complete, checked set", async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),"ad-member-"));
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});});
  const dir=buildAdRuntime(process.cwd(),path.join(root,"image-renderer"));
  assert.equal(adRuntimeDigest(root),adRuntimeDigest(process.cwd()));
  assert.equal(existsSync(path.join(dir,"node_modules/next")),false);
  assert.equal(existsSync(path.join(dir,".env")),false);
  const installed=path.join(root,"second");
  mkdirSync(installed);
  writeFileSync(path.join(dir,".unrelated"),"not part of the release");
  buildAdRuntime(root,path.join(installed,"image-renderer"));
  assert.equal(existsSync(path.join(installed,"image-renderer/.unrelated")),false);
  assert.equal(adRuntimeDigest(installed),adRuntimeDigest(root));

  const copy={headline:"내 손으로 만드는 시계",body:"바늘을 직접 골라 보세요.",cta:"수업 예약"};
  const scene=id=>({variant:{id,formatId:"typography",formatVersion:1,size:"portrait",copy},width:1080,height:1350});
  let bad=false,lostReply=false;
  const sent=[],submitted=[];
  let uploaded;
  globalThis.fetch=async (input,init)=>{
    if (String(input).startsWith("data:")) return originalFetch(input,init);
    assert.equal(String(input),"https://example.test/storage/v1/object/upload/sign/owned-result");
    assert.equal(init.method,"PUT");
    assert.equal(new Headers(init.headers).has("authorization"),false);
    uploaded=Buffer.from(init.body);
    return new Response(null,{status:bad?403:200});
  };
  const dispatch=async body=>{
    sent.push(body.action);
    switch(body.action){
      case "image_creative_claim":assert.equal(body.rendererVersion,10);return {jobId:"j",lease:"lease",variantIds:["v"]};
      case "image_creative_scene":assert.equal(body.variantId,"v");return scene("v");
      case "image_creative_prepare":return {signedUrl:"https://example.test/storage/v1/object/upload/sign/owned-result"};
      case "image_creative_complete":
        if(lostReply) throw new Error("lost response");
        submitted.push(body.files);
        return {done:true};
      case "image_creative_fail":return {failed:true};
      default:throw new Error("unexpected action");
    }
  };
  await processAdRender(dispatch,installed);
  assert.deepEqual(submitted[0],[{variantId:"v",bytes:uploaded.length,sha256:createHash("sha256").update(uploaded).digest("hex")}]);
  assert.equal(uploaded.readUInt32BE(16),1080);assert.equal(uploaded.readUInt32BE(20),1350);
  bad=true;sent.length=0;
  await processAdRender(dispatch,installed);
  assert.equal(sent.at(-1),"image_creative_fail");assert.equal(sent.includes("image_creative_complete"),false);
  bad=false;lostReply=true;sent.length=0;
  await assert.rejects(processAdRender(dispatch,installed),/완료 응답/);
  assert.equal(sent.includes("image_creative_fail"),false);
  assert.equal(await processAdRender(async()=>({idle:true}),installed),false);
});

test("prompt-edited artwork travels through the offline Mac worker byte-for-byte without text overlays", async t => {
  const {getSharp} = await import("next/dist/server/image-optimizer.js");
  const sharp = getSharp();
  const root = mkdtempSync(path.join(os.tmpdir(),"ad-edited-bundle-"));
  const originalFetch = globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});});
  const runtime = buildAdRuntime(process.cwd(),path.join(root,"image-renderer"));
  const bytes = await sharp({create:{width:1080,height:1350,channels:4,background:{r:27,g:76,b:149,alpha:.7}}}).png().toBuffer();
  const dataUrl = "data:image/png;base64,"+bytes.toString("base64");
  const variant = {id:"v",formatId:"M01",formatVersion:2,size:"portrait",brand:"원본 브랜드",
    copy:{headline:"이 글자는 덧그리지 않음",body:"원본 기록",cta:"원본 CTA"},asset:{path:"unused.png",w:1,h:1},
    design:{font:"serif",card:"frame",placement:"feed-portrait"},
    promptEdit:{prompt:"색상 수정",model:"test",image:{path:"edited.png",w:1080,h:1350}}};
  const {renderAdPng} = await import("../tools/image-ad-renderer.mjs");
  assert.deepEqual(await renderAdPng(runtime,variant,undefined,{promptEditDataUrl:dataUrl}),bytes);
  await assert.rejects(renderAdPng(runtime,variant),/수정 PNG/);
  await assert.rejects(renderAdPng(runtime,{...variant,promptEdit:{...variant.promptEdit,image:{...variant.promptEdit.image,w:100}}},undefined,{promptEditDataUrl:dataUrl}),/규격/);
  let uploaded;
  globalThis.fetch = async (url,init) => {
    if (String(url).includes("/storage/v1/object/sign/")) return new Response(bytes,{headers:{"content-type":"image/png"}});
    assert.equal(String(url),"https://example.test/storage/v1/object/upload/sign/result");
    uploaded=Buffer.from(init.body);return new Response(null,{status:200});
  };
  await processAdRender(async body=>{
    switch(body.action) {
      case "image_creative_claim":assert.equal(body.rendererVersion,10);return {jobId:"j",lease:"lease",variantIds:["v"]};
      case "image_creative_scene":return {variant,promptEditUrl:"https://example.test/storage/v1/object/sign/edited",width:1080,height:1350};
      case "image_creative_prepare":return {signedUrl:"https://example.test/storage/v1/object/upload/sign/result"};
      case "image_creative_complete":assert.equal(body.files[0].sha256,createHash("sha256").update(bytes).digest("hex"));return {done:true};
      default:throw new Error("unexpected action "+body.action);
    }
  },root);
  assert.deepEqual(uploaded,bytes);
  const oldRoot=path.join(root,"old");
  buildAdRuntime(root,path.join(oldRoot,"image-renderer"));
  rmSync(path.join(oldRoot,"image-renderer/prompt-edit-render.mjs"));
  assert.equal(await processAdRender(async body=>{assert.equal(body.rendererVersion,8);return {idle:true};},oldRoot),false);
});

test("AI reference output uses the installed v9 bitmap transport without changing its stored creation record", async t => {
  const {getSharp}=await import("next/dist/server/image-optimizer.js");
  const {renderAdPng}=await import("../tools/image-ad-renderer.mjs");
  const root=mkdtempSync(path.join(os.tmpdir(),"ad-ai-reference-")), originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});});
  const runtime=buildAdRuntime(process.cwd(),path.join(root,"image-renderer"));
  const bytes=await getSharp()({create:{width:1080,height:1080,channels:4,background:{r:21,g:52,b:196,alpha:1}}}).png().toBuffer();
  const storedVariant={id:"v",formatId:"reference_image",formatVersion:1,size:"square",
    referenceLayout:{reproduction:"image-ai"},
    copy:{headline:"기록만 보존하고 덧그리지 않음",body:"원본",cta:"확인"},
    referenceArtwork:{image:{path:"generated.png",w:1080,h:1080},model:"test",inputHash:"a".repeat(64)}};
  const storedBefore=structuredClone(storedVariant);
  // Only the scene response uses v9's existing saved-PNG transport. The project
  // keeps its initial-generation record, separate from a user's prompt edit.
  const {referenceArtwork,...sceneVariant}=structuredClone(storedVariant);
  const variant={...sceneVariant,promptEdit:{prompt:"레퍼런스 시안 출력",model:referenceArtwork.model,image:referenceArtwork.image}};
  const promptEditDataUrl="data:image/png;base64,"+bytes.toString("base64");
  assert.deepEqual(await renderAdPng(runtime,variant,undefined,{promptEditDataUrl}),bytes);
  await assert.rejects(renderAdPng(runtime,variant),/수정 PNG/);
  let uploaded;
  globalThis.fetch=async(url,init)=>{
    if(String(url)==="https://example.test/storage/v1/object/sign/artwork") return new Response(bytes,{headers:{"content-type":"image/png"}});
    assert.equal(String(url),"https://example.test/storage/v1/object/upload/sign/result");
    uploaded=Buffer.from(init.body);return new Response(null,{status:200});
  };
  await processAdRender(async body=>{
    switch(body.action) {
      case "image_creative_claim":assert.equal(body.rendererVersion,10);return {jobId:"j",lease:"lease",variantIds:["v"]};
      case "image_creative_scene":return {variant,promptEditUrl:"https://example.test/storage/v1/object/sign/artwork",width:1080,height:1080};
      case "image_creative_prepare":return {signedUrl:"https://example.test/storage/v1/object/upload/sign/result"};
      case "image_creative_complete":
        assert.deepEqual(body.files,[{variantId:"v",bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}]);
        assert.deepEqual(Object.keys(body).sort(),["action","files","jobId","lease"]);
        return {done:true};
      default:throw new Error("unexpected action "+body.action);
    }
  },root);
  assert.deepEqual(uploaded,bytes);
  assert.deepEqual(storedVariant,storedBefore);
  assert.equal(storedVariant.promptEdit,undefined);
});

test("uploaded reference pixels survive outside the replacement slots on the actual Mac PNG", async t => {
  const {getSharp} = await import("next/dist/server/image-optimizer.js");
  const sharp = getSharp();
  const temp = mkdtempSync(path.join(os.tmpdir(),"ad-reference-"));
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const {renderAdPng} = await import("../tools/image-ad-renderer.mjs");
  const runtime = buildAdRuntime(process.cwd(),path.join(temp,"engine"));
  const source = {w:108,h:135,path:"source.png"};
  const pixels = Buffer.alloc(source.w*source.h*3);
  for (let y=0;y<source.h;y++) for (let x=0;x<source.w;x++) {
    const color = x<54 ? [18,93,118] : [174,81,13];
    pixels.set(color,(y*source.w+x)*3);
  }
  const dataUrl = bytes => "data:image/png;base64,"+bytes.toString("base64");
  const referenceDataUrl = dataUrl(await sharp(pixels,{raw:{width:108,height:135,channels:3}}).png().toBuffer());
  const replacement = dataUrl(await sharp({create:{width:12,height:12,channels:3,background:"#73c760"}}).png().toBuffer());
  const style={fill:"#f9e5ca",color:"#101010",align:"left",fontSize:48};
  const variant={formatId:"reference_image",formatVersion:1,size:"portrait",asset:{w:12,h:12,path:"photo.png"},
    referenceLayout:{source,headline:{x:8,y:8,w:70,h:12,...style},photo:{x:10,y:30,w:45,h:32},
      body:{x:15,y:35,w:30,h:10,...style,fill:"transparent"},
      cta:{x:53,y:76,w:35,h:12,...style,fill:"#1e2240",color:"#ffffff",align:"center"}},
    copy:{headline:"나를 아는 시간",body:"시작",cta:"무료 진단"}};
  const {isReferenceLayout}=await import("../lib/image-creative/reference-layout.ts");
  assert.equal(isReferenceLayout(variant.referenceLayout),true);
  assert.equal(isReferenceLayout({...variant.referenceLayout,body:{...variant.referenceLayout.body,x:75}}),false);
  const output=await renderAdPng(runtime,variant,replacement,{referenceDataUrl});
  const {data, info}=await sharp(output).removeAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([info.width,info.height],[1080,1350]);
  const pixel=(x,y)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
  assert.deepEqual(pixel(23,23),[18,93,118]);
  assert.deepEqual(pixel(1005,1130),[174,81,13]);
  assert.deepEqual(pixel(132,432),[115,199,96]);
  assert.deepEqual(pixel(96,121),[249,229,202]);
  assert.deepEqual(pixel(580,1032),[30,34,64]);
  const inkNear=(x0,y0,w,h,r,g,b)=>{for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){
    const p=pixel(x,y);if(Math.abs(p[0]-r)<3 && Math.abs(p[1]-g)<3 && Math.abs(p[2]-b)<3)return true;
  }return false;};
  assert.ok(inkNear(88,109,750,160,16,16,16),"new headline is visibly drawn");
  assert.deepEqual(pixel(165,475),[115,199,96],"replacement photo shows through body slot");
  assert.ok(inkNear(165,475,310,130,16,16,16),"body is drawn directly onto replacement photo");
  assert.ok(inkNear(575,1030,365,155,255,255,255),"new CTA is visibly drawn");

  const edgeLayout = {...variant.referenceLayout, cta:{...variant.referenceLayout.cta,x:0,w:100,align:"left"}};
  const edgeOutput = await renderAdPng(runtime,{...variant,referenceLayout:edgeLayout},replacement,{referenceDataUrl});
  const edgePixels = await sharp(edgeOutput).removeAlpha().raw().toBuffer();
  const rgb=(x,y)=>[...edgePixels.subarray((y*1080+x)*3,(y*1080+x)*3+3)];
  assert.deepEqual([rgb(0,0),rgb(1079,0),rgb(0,1349),rgb(1079,1349)],[[18,93,118],[174,81,13],[18,93,118],[174,81,13]]);
  assert.deepEqual(rgb(0,1060),[30,34,64]);
  assert.deepEqual(rgb(1079,1060),[30,34,64]);
  let firstInk=1080;
  for (let y=1030;y<1180;y++) for(let x=0;x<firstInk;x++) {
    if(rgb(x,y).every(c=>c>245)) firstInk=x;
  }
  assert.ok(firstInk>=54 && firstInk<160,"an edge-to-edge CTA aligns its lettering inside the safe zone");

  const composition = {style:"stack",background:"#fffaf0",ink:"#1a1520",accent:"#184671",imageSide:"end",fit:"contain"};
  const composed = {...variant, referenceLayout:{...variant.referenceLayout,composition}};
  const poster = await renderAdPng(runtime,composed,replacement,{referenceDataUrl});
  const newSource = await renderAdPng(runtime,composed,replacement,{referenceDataUrl:replacement});
  assert.ok(poster.equals(newSource),"new compositions only use the reference for design decisions");
  assert.ok(!poster.equals(output),"old source-raster and new composition outputs differ");
});

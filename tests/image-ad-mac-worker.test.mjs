import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { adRuntimeDigest, buildAdRuntime, processAdRender } from "../tools/image-ad-renderer.mjs";

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
      case "image_creative_claim":assert.equal(body.rendererVersion,1);return {jobId:"j",lease:"lease",variantIds:["v"]};
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

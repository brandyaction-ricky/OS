import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import { imageFileInfo, IMAGE_FILE_MAX } from "../lib/image-creative/storage.ts";

const sharpModule=createRequire(import.meta.url)("next/dist/server/image-optimizer"),sharp=sharpModule.getSharp();
class ApiError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }
const source=readFileSync(new URL("../lib/server/image-reference-generate.ts",import.meta.url),"utf8");
const owner="11111111-1111-4111-8111-111111111111",projectId="22222222-2222-4222-8222-222222222222";
const actor={type:"user",id:owner,ownerId:owner,supabase:{}};
const input={variantId:"base",version:1};
const digest=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");

// Public-free coloured PNGs test transport/layout fidelity, not provider-generated advertising quality.
async function harness({approved=true,key=true,photo=true,detail=false,guide=false,preview=false,active,
  providerError=false,mutateDuringCall=false,cancelDuringUpload=false,deleteDuringCall=false,
  holdProvider=false,missingSource=false,badUpload=false,followup,winningKind="artwork",missingControl=false}={}) {
  const png=(w,h,background)=>sharp({create:{width:w,height:h,channels:3,background}}).png().toBuffer();
  const original=await png(20,20,"#102a59"),product=await png(20,10,"#ffff00"),extra=await png(10,10,"#ff00ff"),previous=await png(20,25,"#0055ff"),winning=await png(20,25,"#80ff80"),edited=await png(20,25,"#ff8000");
  const generated=await sharp(await png(30,10,"#00ff00")).composite([
    {input:await png(3,10,"#ff0000"),left:0,top:0},{input:await png(3,10,"#0000ff"),left:27,top:0},
  ]).png().toBuffer();
  const path=name=>`image-creatives/${projectId}/${name}.png`;
  const assets=[{path:path("source"),w:20,h:20},{path:path("product"),w:20,h:10},{path:path("detail"),w:10,h:10},{path:path("guide"),w:20,h:25},{path:path("winner"),w:20,h:25},{path:path("edited-winner"),w:20,h:25}];
  const files=new Map(assets.map((asset,i)=>[asset.path,[original,product,extra,previous,winning,edited][i]]));
  const base={id:"base",formatId:"reference_image",formatVersion:1,size:"portrait",appeal:{id:"a",meaning:"기준"},
    copy:{headline:"승인한 제목",body:"승인한 본문",cta:"확인하기"},referenceLayout:{source:assets[0],composition:{style:"overlay"}},
    ...(photo?{asset:assets[1]}:{}),...(detail?{detailAsset:assets[2]}:{})};
  const guideVariant={...base,id:"first",referenceArtwork:{image:assets[3],model:"configured-model",inputHash:"0".repeat(64)}};
  const winner={...base,id:"winner",copy:{headline:"승리한 제목",body:"승리한 본문",cta:"승리한 CTA"},
    asset:followup==="image"?assets[2]:base.asset,
    ...(!missingControl?{referenceArtwork:{image:assets[4],model:"configured-model",inputHash:"1".repeat(64)}}:{}),
    ...(winningKind==="promptEdit"&&!missingControl?{promptEdit:{image:assets[5],model:"configured-model",prompt:"승인한 수정"}}:{})};
  if(followup)base.copy={...winner.copy,...(followup==="copy"?{headline:"변경할 제목"}:{})};
  let record={id:projectId,owner_id:owner,version:1,metadata:{state:{brief:{brand:"테스트",product:"상품",offer:"제공 내용"},
    variants:[...(followup?[winner]:[]),...(guide?[guideVariant]:[]),base],batches:[...(followup?[{id:"winning-batch",mode:"appeal",copyFields:[],variantIds:["winner"],review:{final:{by:owner,runId:"winner-final"}}}]:[]),{id:"batch",mode:followup||"appeal",...(followup?{baseId:"winner"}:{}),copyFields:followup==="copy"?["headline"]:[],variantIds:guide?["first","base"]:["base"],review:{copy:{by:owner},...(preview?{preview:{runId:"run"}}:{})}}]},assets,
    ...(active?{[active]:{id:"existing",status:"active",expiresAt:Date.now()+60_000}}:{})}};
  let calls=0,registered,providerArgs,deleted=false;
  let release,started;
  const providerGate=new Promise(resolve=>{release=resolve;}),providerStarted=new Promise(resolve=>{started=resolve;});
  const modules={"node:crypto":crypto,"next/dist/server/image-optimizer":sharpModule,zod,"@/lib/http":{ApiError},
    "@/lib/supabase/server":{createServiceSupabase:()=>({})},"@/lib/image-creative/storage":{imageFileInfo,IMAGE_FILE_MAX},
    "@/lib/image-creative/placement":{resolvePlacement:()=>({width:20,height:25})},
    "./image-prompt-edit":{promptEditProviderSize:()=>"1024x1280"},
    "./card-draw":{drawImageBytes:async args=>{
      calls++;providerArgs=args;started();if(holdProvider)await providerGate;
      if(providerError)throw new ApiError(504,"CARD_DRAW_TIMEOUT","시간 초과");
      if(mutateDuringCall)record={...record,version:record.version+1,metadata:{...record.metadata,state:{...record.metadata.state,note:"concurrent change"}}};
      if(deleteDuringCall)deleted=true;
      return {bytes:generated,model:"configured-provider-model"};
    }},
    "./image-creatives":{
      imageRecord:async()=>{if(deleted)throw new ApiError(404,"IMAGE_NOT_FOUND","deleted");return structuredClone(record);},
      imageMeta:row=>row.metadata,canPreviewVariant:()=>approved,
      readOwnedImageBytes:async(_record,asset)=>{if(missingSource || !files.has(asset.path))throw new ApiError(422,"IMAGE_ASSET_MISSING","원본 없음");return files.get(asset.path);},
      registerImageBytes:async(row,bytes,_path,_upload,options)=>{
        assert.equal(options.strictVersion,true,"new artwork must not merge into changed/restored work");
        if(cancelDuringUpload){record={...record,version:record.version+2,metadata:{...record.metadata,lifecycleRevision:"restored",referenceRun:{...record.metadata.referenceRun,status:"failed"}}};throw new ApiError(409,"IMAGE_VERSION_CONFLICT","restored during upload");}
        if(row.version!==record.version)throw new ApiError(409,"IMAGE_VERSION_CONFLICT","changed");
        registered=bytes;
        const asset={path:path("output"),w:20,h:25,sha256:badUpload?"0".repeat(64):digest(bytes)};
        files.set(asset.path,bytes);
        record={...row,version:row.version+1,metadata:{...row.metadata,assets:[...row.metadata.assets,asset]}};
        return structuredClone(record);
      },
      saveImageMeta:async(_db,row,metadata)=>{if(deleted || row.version!==record.version)throw new ApiError(409,"IMAGE_VERSION_CONFLICT","changed");record={...row,version:row.version+1,metadata};return structuredClone(record);},
      imageBundle:async row=>({project:{id:projectId,version:row.version},state:row.metadata.state,assets:row.metadata.assets}),
    }};
  const compiled={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:name=>{assert.ok(name in modules,name);return modules[name];},process:{env:key?{OPENAI_API_KEY:"unit-test-only"}:{}},Buffer,File,Uint8Array,Date});
  return {api:compiled.exports,getRecord:()=>record,getCalls:()=>calls,getBytes:()=>registered,getArgs:()=>providerArgs,
    original,product,extra,previous,winning,edited,providerStarted,release};
}

test("selected original is first provider input unchanged, product second, and approved copy/design constraints are sent",async()=>{
  const h=await harness(),before=structuredClone(h.getRecord().metadata.state);
  const result=await h.api.generateReferenceArtwork(actor,projectId,input),args=h.getArgs();
  assert.equal(h.getCalls(),1);assert.equal(args.quality,"high");assert.equal(args.size,"1024x1280");assert.equal(args.files.length,2);
  assert.match(args.files[0].name,/selected-reference/);assert.match(args.files[1].name,/product-source/);
  assert.deepEqual(Buffer.from(await args.files[0].arrayBuffer()),h.original,"selected source must not be replaced with the generic overlay preview");
  assert.deepEqual(Buffer.from(await args.files[1].arrayBuffer()),h.product);
  for(const text of ["다른 템플릿으로 다시 디자인하지 마세요","검정 그라데이션을 임의로 얹지 마세요","가장자리와 상품 자료를 자르지 마세요","승인한 제목","승인한 본문","확인하기"])
    assert.ok(args.prompt.includes(text),text);
  const after=result.state.variants[0],prior=before.variants[0];
  assert.deepEqual(after.copy,prior.copy);assert.deepEqual(after.asset,prior.asset);assert.deepEqual(after.referenceLayout.source,prior.referenceLayout.source);
  assert.deepEqual(result.state.batches,before.batches,"generating artwork does not approve preview or final output");
  assert.equal(after.promptEdit,undefined,"initial generation is not a fabricated prompt revision");
  assert.equal(after.referenceLayout.reproduction,"image-ai");assert.equal(after.referenceArtwork.model,"configured-provider-model");
  assert.match(after.referenceArtwork.inputHash,/^[a-f0-9]{64}$/);assert.equal(h.getRecord().metadata.referenceRun.status,"done");
});

test("generated picture is fitted to exact output size with both edges retained and no crop",async()=>{
  const h=await harness();await h.api.generateReferenceArtwork(actor,projectId,input);
  assert.deepEqual(imageFileInfo(h.getBytes()),{mime:"image/png",ext:"png",w:20,h:25});
  const {data,info}=await sharp(h.getBytes()).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const rgb=(x,y)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
  assert.deepEqual(rgb(0,0),[255,255,255]);assert.deepEqual(rgb(0,12),[255,0,0]);assert.deepEqual(rgb(19,12),[0,0,255]);
});

test("no product photo is required and an existing batch design is supplied last for consistent variants",async()=>{
  const noPhoto=await harness({photo:false});await noPhoto.api.generateReferenceArtwork(actor,projectId,input);
  assert.equal(noPhoto.getArgs().files.length,1);assert.ok(noPhoto.getArgs().prompt.includes("별도 상품 사진은 없습니다"));
  const h=await harness({guide:true,detail:true});await h.api.generateReferenceArtwork(actor,projectId,input);
  const args=h.getArgs();assert.equal(args.files.length,4);
  for(const [index,expected] of [h.original,h.product,h.extra,h.previous].entries())assert.deepEqual(Buffer.from(await args.files[index].arrayBuffer()),expected);
  assert.match(args.files[3].name,/same-test-design/);assert.ok(args.prompt.includes("같은 테스트 묶음에서 먼저 만든 시안"));
});

test("copy tests send their selected winner as the control instead of another candidate and only allow selected copy fields",async()=>{
  const h=await harness({followup:"copy",guide:true}),before=structuredClone(h.getRecord().metadata.state);
  const result=await h.api.generateReferenceArtwork(actor,projectId,input),args=h.getArgs();
  assert.equal(args.files.length,3);
  for(const [index,expected] of [h.original,h.product,h.winning].entries())assert.deepEqual(Buffer.from(await args.files[index].arrayBuffer()),expected);
  assert.match(args.files[2].name,/winning-ad/);
  assert.ok(!args.prompt.includes("같은 테스트 묶음에서 먼저 만든 시안"),"a follow-up cannot use the first candidate as a new design control");
  assert.match(args.prompt,/변경 가능한 문구 칸은 headline뿐입니다/);
  assert.match(args.prompt,/참고 상품 자료로 사진을 교체하지 마세요/);
  assert.deepEqual(JSON.parse(args.prompt.trim().split("\n").at(-1)),{brand:"테스트",product:"상품",offer:"제공 내용",copyChanges:{headline:"변경할 제목"}});
  assert.deepEqual(result.state.variants.find(v=>v.id==="winner"),before.variants.find(v=>v.id==="winner"));
  assert.deepEqual(result.state.variants.find(v=>v.id==="base").copy,before.variants.find(v=>v.id==="base").copy);
  assert.deepEqual(result.state.batches,before.batches);
});

test("image tests keep the winning design and copy while supplying the current candidate photo, not the first candidate photo",async()=>{
  const h=await harness({followup:"image",guide:true}),record=h.getRecord();
  record.metadata.state.variants.find(v=>v.id==="first").asset=record.metadata.assets[2];
  const before=structuredClone(record.metadata.state);
  const result=await h.api.generateReferenceArtwork(actor,projectId,input),args=h.getArgs();
  assert.equal(args.files.length,3);
  for(const [index,expected] of [h.original,h.product,h.winning].entries())assert.deepEqual(Buffer.from(await args.files[index].arrayBuffer()),expected);
  assert.match(args.files[2].name,/winning-ad/);
  assert.ok(!args.prompt.includes("사진·배경·카드·장식·색과 배치를 이 시안과 같게 유지"),"image tests must permit replacing the photo");
  assert.match(args.prompt,/승리 광고의 제목·본문·CTA·브랜드와 모든 문구/);
  assert.match(args.prompt,/이번 후보로 지정한 상품 자료 이미지만 해당 이미지 영역에서 교체/);
  assert.deepEqual(JSON.parse(args.prompt.trim().split("\n").at(-1)),{brand:"테스트",product:"상품",offer:"제공 내용"},"stale copy metadata must not overwrite the approved winning bitmap");
  const after=result.state.variants.find(v=>v.id==="base"),prior=before.variants.find(v=>v.id==="base");
  assert.deepEqual(after.copy,prior.copy);assert.deepEqual(after.asset,prior.asset);
  assert.deepEqual(result.state.variants.find(v=>v.id==="winner"),before.variants.find(v=>v.id==="winner"));
});

test("an approved prompt-edited winner is the latest control even if its earlier generated artwork remains",async()=>{
  for(const followup of ["copy","image"]){
    const h=await harness({followup,guide:true,winningKind:"promptEdit"});
    await h.api.generateReferenceArtwork(actor,projectId,input);
    const args=h.getArgs();assert.match(args.files.at(-1).name,/winning-ad/);
    assert.deepEqual(Buffer.from(await args.files.at(-1).arrayBuffer()),h.edited);
  }
});

test("copy tests can change the CTA alone without sending or changing the other copy fields",async()=>{
  const h=await harness({followup:"copy"}),state=h.getRecord().metadata.state;
  state.batches.find(b=>b.id==="batch").copyFields=["cta"];
  state.variants.find(v=>v.id==="base").copy={headline:"승리한 제목",body:"승리한 본문",cta:"다른 CTA"};
  await h.api.generateReferenceArtwork(actor,projectId,input);
  const prompt=h.getArgs().prompt;
  assert.match(prompt,/변경 가능한 문구 칸은 cta뿐입니다/);
  assert.ok(!prompt.includes("나머지 문구·CTA"),"the permitted CTA change must not conflict with a blanket CTA lock");
  assert.deepEqual(JSON.parse(prompt.trim().split("\n").at(-1)).copyChanges,{cta:"다른 CTA"});
});

test("follow-up tests without their winning bitmap reject before paid calls even when a first-candidate guide exists",async()=>{
  for(const followup of ["copy","image"]){
    const h=await harness({followup,guide:true,missingControl:true}),before=structuredClone(h.getRecord());
    await assert.rejects(h.api.generateReferenceArtwork(actor,projectId,input),e=>e.code==="IMAGE_REFERENCE_CONTROL_REQUIRED");
    assert.equal(h.getCalls(),0);assert.equal(h.getBytes(),undefined);assert.deepEqual(h.getRecord(),before);
  }
});

test("follow-up tests require a confirmed winning output, and image tests require the candidate source",async()=>{
  for(const [options,mutate] of [
    [{followup:"copy"},state=>{delete state.batches.find(b=>b.id==="winning-batch").review.final;}],
    [{followup:"image"},state=>{delete state.batches.find(b=>b.id==="winning-batch").review.final;}],
    [{followup:"image",photo:false},()=>{}],
  ]){
    const h=await harness(options);mutate(h.getRecord().metadata.state);
    const before=structuredClone(h.getRecord());
    await assert.rejects(h.api.generateReferenceArtwork(actor,projectId,input),e=>e.code==="IMAGE_REFERENCE_CONTROL_REQUIRED");
    assert.equal(h.getCalls(),0);assert.equal(h.getBytes(),undefined);assert.deepEqual(h.getRecord(),before);
  }
});

test("owner, version, approval, final lock, provider configuration and active-job gates stop before paid requests",async()=>{
  for(const [options,who,request,code] of [
    [{},{...actor,type:"agent"},input,"IMAGE_HUMAN_REQUIRED"],
    [{},{...actor,id:"different-owner"},input,"IMAGE_HUMAN_REQUIRED"],
    [{},actor,{...input,version:2},"IMAGE_VERSION_CONFLICT"],
    [{approved:false},actor,input,"IMAGE_COPY_APPROVAL_REQUIRED"],
    [{preview:true},actor,input,"IMAGE_PREVIEW_LOCKED"],
    [{key:false},actor,input,"OPENAI_NOT_CONFIGURED"],
    [{active:"referenceRun"},actor,input,"IMAGE_REFERENCE_BUSY"],
    [{active:"promptEditRun"},actor,input,"IMAGE_REFERENCE_BUSY"],
    [{missingSource:true},actor,input,"IMAGE_ASSET_MISSING"],
  ]){
    const h=await harness(options),before=structuredClone(h.getRecord());
    await assert.rejects(h.api.generateReferenceArtwork(who,projectId,request),e=>e.code===code);
    assert.equal(h.getCalls(),0);assert.equal(h.getBytes(),undefined);assert.deepEqual(h.getRecord(),before);
  }
});

test("simultaneous requests reserve the source version once and never duplicate a provider call",{timeout:3000},async()=>{
  const h=await harness({holdProvider:true});
  const results=Promise.allSettled([h.api.generateReferenceArtwork(actor,projectId,input),h.api.generateReferenceArtwork(actor,projectId,input)]);
  await h.providerStarted;assert.equal(h.getCalls(),1);h.release();
  const settled=await results;assert.equal(settled.filter(v=>v.status==="fulfilled").length,1);
  assert.equal(settled.find(v=>v.status==="rejected").reason.code,"IMAGE_VERSION_CONFLICT");assert.equal(h.getCalls(),1);
});

test("unchanged inputs reuse the stored artwork without a new paid call",async()=>{
  const h=await harness();await h.api.generateReferenceArtwork(actor,projectId,input);
  const before=structuredClone(h.getRecord());
  const reused=await h.api.generateReferenceArtwork(actor,projectId,{...input,version:before.version});
  assert.equal(h.getCalls(),1);assert.deepEqual(structuredClone(h.getRecord()),before);assert.deepEqual(structuredClone(reused.state),before.metadata.state);
});

test("provider failure does not retry, change approved content or attach a substitute preview",async()=>{
  const h=await harness({providerError:true}),before=structuredClone(h.getRecord().metadata.state);
  await assert.rejects(h.api.generateReferenceArtwork(actor,projectId,input),e=>e.code==="CARD_DRAW_TIMEOUT");
  assert.equal(h.getCalls(),1);assert.equal(h.getBytes(),undefined);assert.deepEqual(h.getRecord().metadata.state,before);
  assert.equal(h.getRecord().metadata.referenceRun.status,"failed");
});

test("a concurrent input change or deletion cannot receive a late generated asset",async()=>{
  for(const [options,code] of [[{mutateDuringCall:true},"IMAGE_VERSION_CONFLICT"],[{deleteDuringCall:true},"IMAGE_NOT_FOUND"]]){
    const h=await harness(options),before=structuredClone(h.getRecord().metadata.state.variants);
    await assert.rejects(h.api.generateReferenceArtwork(actor,projectId,input),e=>e.code===code);
    assert.equal(h.getCalls(),1);assert.equal(h.getBytes(),undefined);assert.deepEqual(h.getRecord().metadata.state.variants,before);
  }
});

test("strict upload prevents a cancelled/restored project from receiving artwork",async()=>{
  const h=await harness({cancelDuringUpload:true}),before=structuredClone(h.getRecord().metadata.state);
  await assert.rejects(h.api.generateReferenceArtwork(actor,projectId,input),e=>e.code==="IMAGE_VERSION_CONFLICT");
  assert.equal(h.getCalls(),1);assert.equal(h.getBytes(),undefined);assert.deepEqual(h.getRecord().metadata.state,before);
  assert.equal(h.getRecord().metadata.lifecycleRevision,"restored");assert.equal(h.getRecord().metadata.referenceRun.status,"failed");
});

test("a mismatched stored image receipt is never bound to the variant",async()=>{
  const h=await harness({badUpload:true}),before=structuredClone(h.getRecord().metadata.state);
  await assert.rejects(h.api.generateReferenceArtwork(actor,projectId,input),e=>e.code==="IMAGE_VERSION_CONFLICT");
  assert.deepEqual(h.getRecord().metadata.state,before);assert.equal(h.getRecord().metadata.referenceRun.status,"failed");
});

test("route requires human authentication and rejects malformed ids, arbitrary source URLs and unknown fields",async()=>{
  const h=await harness(),compiled={exports:{}};let called=0;
  const modules={zod,"@/lib/http":{ApiError,parseJson:async(r,limit)=>{assert.equal(limit,8192);return r.json();},apiErrorResponse:e=>Response.json({code:e.code},{status:e.status??500})},
    "@/lib/server/auth":{authenticateRequest:async(_r,options)=>{assert.equal(options.allowAgent,false);return actor;}},
    "@/lib/server/image-creatives":{imageError:e=>e},
    "@/lib/server/image-reference-generate":{referenceGenerateRequest:h.api.referenceGenerateRequest,generateReferenceArtwork:async(who,id,value)=>{
      called++;assert.equal(who,actor);assert.equal(id,projectId);assert.deepEqual(value,input);return {ok:true};
    }}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/v1/content/image-creatives/[id]/reference-generate/route.ts",import.meta.url),"utf8"),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:name=>modules[name],Response});
  const call=(value,id=projectId)=>compiled.exports.POST(new Request(`http://localhost/api/v1/content/image-creatives/${id}/reference-generate`,
    {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(value)}),{params:Promise.resolve({id})});
  assert.equal((await call(input)).status,200);assert.equal(called,1);
  for(const value of [{...input,sourceUrl:"https://example.test/unbound.png"},{...input,model:"unapproved-model"},{...input,version:0}])assert.equal((await call(value)).status,422);
  assert.equal((await call(input,"not-a-project-id")).status,422);assert.equal(called,1);
});

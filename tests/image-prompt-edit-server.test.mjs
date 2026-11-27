import * as adSchemas from "../lib/ad-production-schema.ts";
import * as adProduction from "../lib/ad-production.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import { imageFileInfo, IMAGE_FILE_MAX, IMAGE_CREATIVE_KIND, ownsImageAsset } from "../lib/image-creative/storage.ts";
import * as imageModel from "../lib/image-creative/model.ts";
import * as imageDirection from "../lib/image-creative/direction.ts";
import * as imageFormats from "../lib/image-creative/formats.ts";

const sharpModule=createRequire(import.meta.url)("next/dist/server/image-optimizer"),sharp=sharpModule.getSharp();
class ApiError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }
const source=readFileSync(new URL("../lib/server/image-prompt-edit.ts",import.meta.url),"utf8");
const owner="11111111-1111-4111-8111-111111111111",projectId="22222222-2222-4222-8222-222222222222";
const actor={type:"user",id:owner,ownerId:owner,supabase:{},name:"검토자"};
const input={variantId:"base",version:1,prompt:"실행은 85점으로 바꾸고 견본 문구를 제거해줘"};
async function harness({approved=true,key=true,providerError,mutateDuringCall=false,warehouse=false,holdProvider=false,cancelDuringUpload=false}={}) {
  const original=await sharp({create:{width:20,height:25,channels:3,background:"#333333"}}).png().toBuffer();
  const generated=await sharp({create:{width:30,height:10,channels:3,background:"#00ff00"}}).composite([
    {input:await sharp({create:{width:3,height:10,channels:3,background:"#ff0000"}}).png().toBuffer(),left:0,top:0},
    {input:await sharp({create:{width:3,height:10,channels:3,background:"#0000ff"}}).png().toBuffer(),left:27,top:0},
  ]).png().toBuffer();
  let release,started;
  const providerGate=new Promise(resolve=>{release=resolve;}),providerStarted=new Promise(resolve=>{started=resolve;});
  let record={id:projectId,owner_id:owner,version:1,metadata:{state:{variants:[{id:"base",formatId:warehouse?"M01":"typography",size:"portrait",copy:{headline:"원본"}}],batches:[]},assets:[]}},calls=0,registered;
  const modules={"@/lib/ad-production-schema":adSchemas,"@/lib/ad-production":adProduction,"next/dist/server/image-optimizer":sharpModule,"node:crypto":crypto,zod,"@/lib/http":{ApiError},
    "@/lib/cardnews/draw":{CARD_DRAW_SIZE:{width:1024,height:1280}},"@/lib/image-creative/storage":{imageFileInfo,IMAGE_FILE_MAX},
    "@/lib/image-creative/formats":{isWarehouseFormat:id=>id==="M01"},"@/lib/image-creative/placement":{resolvePlacement:()=>({width:20,height:25})},"./youtube-process-stages":{},
    "@/lib/supabase/server":{createServiceSupabase:()=>({})},"./card-draw":{drawImageBytes:async args=>{
      calls++;started();if(holdProvider)await providerGate;assert.equal(args.files.length,1);assert.deepEqual(Buffer.from(await args.files[0].arrayBuffer()),original);
      assert.ok(args.prompt.includes(input.prompt));if(providerError)throw new ApiError(504,"CARD_DRAW_TIMEOUT","시간 초과");
      if(mutateDuringCall)record.version++;return {bytes:generated,model:"configured-provider-model"};
    }},"./image-creatives":{
      imageRecord:async()=>structuredClone(record),imageMeta:row=>row.metadata,canPreviewVariant:()=>approved,
      imagePromptSourceHash:row=>crypto.createHash("sha256").update(JSON.stringify(row)).digest("hex"),
      savedDesignPreview:async()=>{assert.ok(!warehouse,"warehouse must use the bound browser PNG, not the unsupported server renderer");return original;},
      registerImageBytes:async(row,bytes,_path,_upload,options)=>{
        assert.equal(options.strictVersion,true,"prompt candidates cannot use additive upload retries");
        if(cancelDuringUpload) {
          record={...record,version:record.version+2,metadata:{...record.metadata,lifecycleRevision:"restored-generation",
            promptEditRun:{...record.metadata.promptEditRun,status:"failed",expiresAt:0}}};
          throw new ApiError(409,"IMAGE_VERSION_CONFLICT","cancelled during upload");
        }
        registered=bytes;record={...row,version:row.version+1,metadata:{...row.metadata,assets:[...row.metadata.assets,
        {path:`image-creatives/${projectId}/33333333-3333-4333-8333-333333333333.png`,w:20,h:25,sha256:crypto.createHash("sha256").update(bytes).digest("hex")} ]}};return structuredClone(record);},
      saveImageMeta:async(_db,row,metadata)=>{if(row.version!==record.version)throw new ApiError(409,"IMAGE_VERSION_CONFLICT","changed");record={...row,version:row.version+1,metadata};return structuredClone(record);},
      imageBundle:async row=>({project:{id:projectId,version:row.version},state:row.metadata.state,assets:row.metadata.assets.map(a=>({...a,url:"https://example.test/new-candidate.png"}))}),
    }};
  const compiled={exports:{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:name=>{assert.ok(name in modules,name);return modules[name];},process:{env:key?{OPENAI_API_KEY:"unit-test-only"}:{}},Buffer,File,Uint8Array,Date});
  return {api:compiled.exports,getRecord:()=>record,getCalls:()=>calls,getBytes:()=>registered,getOriginal:()=>original,providerStarted,release};
}
test("owner/version/approval/key checks happen before any image provider request",async()=>{
  for(const [options,who,request,code] of [
    [{},{...actor,type:"agent"},input,"IMAGE_HUMAN_REQUIRED"],
    [{},actor,{...input,version:2},"IMAGE_VERSION_CONFLICT"],
    [{approved:false},actor,input,"IMAGE_COPY_APPROVAL_REQUIRED"],
    [{key:false},actor,input,"OPENAI_NOT_CONFIGURED"],
  ]) {
    const h=await harness(options);await assert.rejects(h.api.proposeImagePromptEdit(who,projectId,request),error=>error.code===code);
    assert.equal(h.getCalls(),0);assert.equal(h.getRecord().version,1);assert.equal(h.getBytes(),undefined);
  }
});
test("a proposed PNG retains the full picture, exact ad dimensions, a server binding and untouched original",async()=>{
  const h=await harness(),before=structuredClone(h.getRecord().metadata.state);
  const result=await h.api.proposeImagePromptEdit(actor,projectId,input);
  assert.equal(h.getCalls(),1);assert.deepEqual(h.getRecord().metadata.state,before);
  assert.deepEqual(imageFileInfo(h.getBytes()),{mime:"image/png",ext:"png",w:20,h:25});
  const {data,info}=await sharp(h.getBytes()).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const rgb=(x,y)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
  assert.deepEqual(rgb(0,0),[255,255,255],"ratio mismatch is padded, never cropped");
  assert.deepEqual(rgb(0,12),[255,0,0]);assert.deepEqual(rgb(19,12),[0,0,255],"both edges of the AI picture remain");
  assert.equal(result.proposal.model,"configured-provider-model");assert.equal(result.proposal.image.w,20);assert.equal(result.proposal.image.h,25);
  assert.match(result.proposal.sizeNote,/여백/);
  const proof=h.getRecord().metadata.promptEditProposals[0];assert.equal(proof.prompt,input.prompt);assert.equal(proof.image.path,result.proposal.image.path);assert.ok(proof.sourceHash);
  assert.equal(proof.inputSha256,crypto.createHash("sha256").update(h.getOriginal()).digest("hex"));
  assert.equal(h.getRecord().metadata.promptEditRun.status,"done");
});
test("failed provider or a concurrent source change never applies or stores a generated asset",async()=>{
  for(const [options,code] of [[{providerError:true},"CARD_DRAW_TIMEOUT"],[{mutateDuringCall:true},"IMAGE_VERSION_CONFLICT"]]) {
    const h=await harness(options);await assert.rejects(h.api.proposeImagePromptEdit(actor,projectId,input),error=>error.code===code);
    assert.equal(h.getCalls(),1);assert.equal(h.getBytes(),undefined);assert.equal(h.getRecord().metadata.state.variants.length,1);
    assert.equal(h.getRecord().metadata.promptEditRun.status,"failed","failure releases the reservation without changing the source");
  }
});

test("two simultaneous requests for the same project/version consume the image provider once",{timeout:3000},async()=>{
  const h=await harness({holdProvider:true});
  const results=Promise.allSettled([h.api.proposeImagePromptEdit(actor,projectId,input),h.api.proposeImagePromptEdit(actor,projectId,input)]);
  await h.providerStarted;assert.equal(h.getCalls(),1);h.release();
  const settled=await results;
  assert.equal(settled.filter(row=>row.status==="fulfilled").length,1);
  assert.equal(settled.find(row=>row.status==="rejected").reason.code,"IMAGE_VERSION_CONFLICT");
  assert.equal(h.getCalls(),1);
});

test("pre-final warehouse edits use a real PNG bound to the current owner, source and dimensions",async()=>{
  const h=await harness({warehouse:true});
  const sourceHash=crypto.createHash("sha256").update(JSON.stringify(h.getRecord().metadata.state.variants[0])).digest("hex");
  const sourcePng=new File([h.getOriginal()],"current-ad.png",{type:"image/png"});
  await assert.rejects(h.api.proposeImagePromptEdit(actor,projectId,{...input,sourceHash:"a".repeat(64)},sourcePng),e=>e.code==="IMAGE_PROMPT_SOURCE_REQUIRED");
  const wrong=await sharp({create:{width:10,height:10,channels:3,background:"#333333"}}).png().toBuffer();
  await assert.rejects(h.api.proposeImagePromptEdit(actor,projectId,{...input,sourceHash},new File([wrong],"wrong.png",{type:"image/png"})),e=>e.code==="IMAGE_PROMPT_SOURCE_INVALID");
  assert.equal(h.getCalls(),0);assert.equal(h.getRecord().version,1);
  await h.api.proposeImagePromptEdit(actor,projectId,{...input,sourceHash},sourcePng);
  assert.equal(h.getCalls(),1);
  const proof=h.getRecord().metadata.promptEditProposals[0];assert.equal(proof.inputKind,"owner-browser-preview");assert.equal(proof.sourceHash,sourceHash);
  assert.equal(proof.inputSha256,crypto.createHash("sha256").update(h.getOriginal()).digest("hex"));
  assert.equal(h.getRecord().metadata.state.variants.length,1,"source input is not a new approval or applied revision");
});

test("the authenticated endpoint accepts bound multipart PNGs and rejects oversized bodies and arbitrary source URLs",async()=>{
  const h=await harness({warehouse:true}),compiled={exports:{}};let called=0;
  const modules={"@/lib/ad-production-schema":adSchemas,"@/lib/ad-production":adProduction,zod,"@/lib/http":{ApiError,parseJson:r=>r.json(),apiErrorResponse:error=>Response.json({code:error.code},{status:error.status ?? 500})},
    "@/lib/server/auth":{authenticateRequest:async(_request,options)=>{assert.equal(options.allowAgent,false);return actor;}},
    "@/lib/server/image-creatives":{imageError:error=>error},"@/lib/image-creative/storage":{IMAGE_FILE_MAX},
    "@/lib/server/image-prompt-edit":{imagePromptEditRequest:h.api.imagePromptEditRequest,proposeImagePromptEdit:async(who,id,value,file)=>{
      called++;assert.equal(who,actor);assert.equal(id,projectId);assert.equal(value.sourceHash,"a".repeat(64));
      assert.deepEqual(Buffer.from(await file.arrayBuffer()),h.getOriginal());return {ok:true};
    }}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/v1/content/image-creatives/[id]/prompt-edit/route.ts",import.meta.url),"utf8"),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:name=>modules[name],Buffer,Uint8Array,TextEncoder,Response});
  const path=`http://localhost/api/v1/content/image-creatives/${projectId}/prompt-edit`,context={params:Promise.resolve({id:projectId})};
  const form=new FormData();form.set("metadata",JSON.stringify({...input,sourceHash:"a".repeat(64)}));form.set("sourcePng",new File([h.getOriginal()],"current.png",{type:"image/png"}));
  assert.equal((await compiled.exports.POST(new Request(path,{method:"POST",body:form}),context)).status,200);assert.equal(called,1);
  const tooLarge=new Request(path,{method:"POST",body:"x",headers:{"content-type":"multipart/form-data; boundary=a","content-length":String(IMAGE_FILE_MAX+64_001)}});
  assert.equal((await compiled.exports.POST(tooLarge,context)).status,413);
  const remote=new Request(path,{method:"POST",body:JSON.stringify({...input,sourceUrl:"https://example.test/unbound.png"}),headers:{"content-type":"application/json"}});
  assert.equal((await compiled.exports.POST(remote,context)).status,422);assert.equal(called,1);
});

test("applying requires the exact server proposal and ownership; a saved request can be retried after its version changes",async()=>{
  const editId="55555555-5555-4555-8555-555555555555";
  const image={path:`image-creatives/${projectId}/66666666-6666-4666-8666-666666666666.png`,w:1080,h:1350};
  const brief={objective:"확인",funnel:"무료",audience:"직장인",product:"강점",offer:"결과",landingUrl:"",facts:""};
  let state={...imageModel.emptyImageCreative(),brief};
  const request={mode:"standalone",count:1,size:"portrait",formatIds:["typography"]};
  const prepared=imageModel.createImageBatch(state,request,{variants:[{formatId:"typography",formatVersion:1,size:"portrait",appeal:{id:"a",meaning:"강점 확인"},copy:{headline:"내 강점",body:"",cta:"확인하기"}}]},
    {now:new Date().toISOString(),by:"owner",newId:()=>crypto.randomUUID(),assets:[]});
  state=prepared;
  state=imageModel.reviewImageBatch(state,prepared.batches[0].id,"format",{by:owner,at:new Date().toISOString()});
  state=imageModel.reviewImageBatch(state,prepared.batches[0].id,"copy",{by:owner,at:new Date().toISOString()});
  const base=state.variants[0],edit={prompt:input.prompt,model:"configured-provider-model",image};
  const proof={baseId:base.id,...edit,sourceHash:crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex"),at:new Date().toISOString()};
  let record={id:projectId,owner_id:owner,version:4,metadata:{kind:IMAGE_CREATIVE_KIND,state,assets:[image],appliedJobs:{},promptEditProposals:[proof]}},writes=0;
  const db={from(){let update;const q={update(value){update=value;return q;},eq(){return q;},is(){return q;},select(){return q;},async maybeSingle(){writes++;record={...record,...update,version:record.version+1};return {data:record,error:null};}};return q;}};
  const modules={"@/lib/ad-production-schema":adSchemas,"@/lib/ad-production":adProduction,"node:crypto":crypto,"next/dist/server/image-optimizer":sharpModule,zod,"@/lib/http":{ApiError},
    "@/lib/supabase/server":{createServiceSupabase:()=>db},"@/lib/image-creative/model":imageModel,"@/lib/image-creative/direction":imageDirection,
    "@/lib/image-creative/formats":imageFormats,"@/lib/image-creative/storage":{IMAGE_FILE_MAX,IMAGE_CREATIVE_KIND,imageFileInfo,ownsImageAsset}};
  const compiled={exports:{}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/server/image-creatives.ts",import.meta.url),"utf8"),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:name=>modules[name] ?? {},Buffer,Uint8Array,Date,TextEncoder,console});
  const api=compiled.exports,requestBody=api.imagePatchSchema.parse({action:"apply-prompt-edit",version:4,baseId:base.id,id:editId,edit});
  for(const patch of [{model:"forged-model"},{prompt:"다른 요청"},{image:{...image,path:image.path.replace(projectId,owner)}}])
    await assert.rejects(api.patchImageProject(actor,record,{...requestBody,edit:{...edit,...patch}}),error=>error.code==="IMAGE_PROMPT_PROPOSAL_CHANGED");
  await assert.rejects(api.patchImageProject({...actor,type:"agent"},record,requestBody),error=>error.code==="IMAGE_HUMAN_REQUIRED");
  await assert.rejects(api.patchImageProject(actor,record,{...requestBody,version:3}),error=>error.code==="IMAGE_VERSION_CONFLICT");
  assert.equal(writes,0);
  await api.patchImageProject(actor,record,requestBody);
  assert.equal(writes,1);assert.equal(record.metadata.state.variants.length,2);
  assert.deepEqual(record.metadata.state.variants[0],base);
  const retry=await api.patchImageProject(actor,record,requestBody);
  assert.equal(retry.version,5);assert.equal(writes,1,"the old version is safe only for the identical already-applied operation");
});


test("cancellation during generated-image upload cannot resurrect a prompt proposal after restore",async()=>{
  const h=await harness({cancelDuringUpload:true});
  await assert.rejects(h.api.proposeImagePromptEdit(actor,projectId,input),error=>error.code==="IMAGE_VERSION_CONFLICT");
  assert.equal(h.getCalls(),1);assert.equal(h.getBytes(),undefined);
  assert.equal(h.getRecord().metadata.lifecycleRevision,"restored-generation");
  assert.equal(h.getRecord().metadata.promptEditRun.status,"failed");
  assert.equal(h.getRecord().metadata.promptEditProposals,undefined);
});

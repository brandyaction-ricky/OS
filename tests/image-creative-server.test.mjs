import * as placements from '../lib/image-creative/placement.ts';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";
import * as zod from "zod";
import * as model from "../lib/image-creative/model.ts";
import * as formats from "../lib/image-creative/formats.ts";
import * as formatTest from "../lib/image-creative/format-test.ts";
import * as storage from "../lib/image-creative/storage.ts";

const sharpModule=createRequire(import.meta.url)("next/dist/server/image-optimizer");
const sharp=sharpModule.getSharp();

class ApiError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
const owner="11111111-1111-4111-8111-111111111111", other="22222222-2222-4222-8222-222222222222", projectId="33333333-3333-4333-8333-333333333333";
const brief={objective:"진단",funnel:"무료",audience:"직장인",product:"강점",offer:"결과",landingUrl:"",facts:""};
const initial={mode:"initial",count:1,formatIds:["photo_headline"],size:"portrait"};
const baseAsset={path:`image-creatives/${projectId}/44444444-4444-4444-8444-444444444444.png`,w:1,h:1};
const candidate={formatId:"photo_headline",formatVersion:1,size:"portrait",asset:baseAsset,appeal:{id:"a",meaning:"시작의 어려움"},copy:{headline:"시작이 어렵다면",body:"일상 속 선택",cta:"자세히 보기"}};
let stored;
function reset(){modules["@/lib/supabase/server"].createServiceSupabase=db;stored={id:projectId,owner_id:owner,version:1,record_type:"content_package",archived_at:null,title:"테스트",metadata:{kind:storage.IMAGE_CREATIVE_KIND,state:{...model.emptyImageCreative(),brief},assets:[{...baseAsset,sha256:"a".repeat(64)}],appliedJobs:{}}};}
function db() { return {from(){let filters=[],update;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},update(v){update=v;return q},async maybeSingle(){const ok=filters.every(([key,value])=>key==="metadata->>kind"?stored.metadata.kind===value:stored[key]===value);if(!ok)return {data:null,error:null};if(update)stored={...stored,...update,version:stored.version+1};return {data:structuredClone(stored),error:null};}};return q;}};}
const source=readFileSync(new URL("../lib/server/image-creatives.ts",import.meta.url),"utf8");
const modules={"@/lib/image-creative/placement":placements,"@/lib/image-creative/format-test":formatTest,"node:crypto":crypto,"next/dist/server/image-optimizer":sharpModule,"node:fs/promises":{},"node:path":{},react:{createElement:()=>({})},"next/og":{ImageResponse:class { async arrayBuffer(){return new ArrayBuffer(0);} }},zod,"@/lib/http":{ApiError},"@/lib/supabase/server":{},"@/lib/cardnews/zip":{},"@/lib/image-creative/formats":formats,"@/lib/image-creative/format-test-fonts.json":{default:JSON.parse(readFileSync(new URL("../lib/image-creative/format-test-fonts.json",import.meta.url),"utf8"))},"@/lib/image-creative/model":model,"@/lib/image-creative/storage":storage,"@/lib/image-creative/view":{},"./youtube-process-stages":{}};
const compiled={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:compiled,exports:compiled.exports,require:n=>{if(!(n in modules))throw Error(n);return modules[n];},Buffer,URL,Date,Uint8Array,TextEncoder,console});
const server=compiled.exports;

const ownerActor = () => ({type:"user", id:owner, ownerId:owner, name:"owner", supabase:db()});
const decision = input => server.patchImageProject(ownerActor(),stored,server.imagePatchSchema.parse({version:stored.version,...input}));
const approveRequest = request => decision({action:"approve-format",request});
async function reviewedFixture(variantId) {
  const batchId = stored.metadata.state.batches.find(b => b.variantIds.includes(variantId)).id;
  await decision({action:"approve-copy",batchId});
  await decision({action:"confirm-preview",batchId,target:"local"});
  const run=stored.metadata.renders.at(-1);
  run.status="done"; run.leaseHash="a".repeat(64);
  run.files=run.variantIds.map(variantId=>({variantId, bytes:10, sha256:"b".repeat(64)}));
  await decision({action:"approve-final",batchId,runId:run.id});
}
test("warehouse worker instructions, import and persistence use the same project photo, brand and controlled copy", async () => {
  reset();
  stored.metadata.state.brief = {...stored.metadata.state.brief, brand:"새 브랜드"};
  const request = server.imageRequestSchema.parse({ mode:"initial", count:2, formatIds:["M01","M09"], compareFormats:true, assetPaths:[baseAsset.path] });
  await approveRequest(request);
  const instructions = server.imageJobInstructions(stored,request);
  assert.match(instructions,/M09:.*formatVersion 2.*손끝/);
  assert.ok(instructions.includes(baseAsset.path));
  assert.ok(instructions.includes("새 브랜드"));
  const candidates = request.formatIds.map(formatId=>({...candidate,formatId,formatVersion:2}));
  await assert.rejects(server.importImageResults(db(),stored,request,{variants:candidates.map(row=>({...row,asset:{...baseAsset,w:2}}))},"worker"),e=>e.code==="IMAGE_ASSET_NOT_OWNED");
  await assert.rejects(server.importImageResults(db(),stored,request,{variants:[candidates[0],{...candidates[1],copy:{...candidate.copy,cta:"다른 버튼"}}]},"worker"),/모두 같아야/);
  assert.equal(stored.version,2);
  const result=await server.importImageResults(db(),stored,request,{variants:candidates},"worker","warehouse-job");
  assert.equal(result.record.metadata.state.batches[0].compareFormats,true);
  assert.ok(result.record.metadata.state.variants.every(row=>row.brand==="새 브랜드" && row.formatVersion===2 && row.asset.path===baseAsset.path));
  const replay=await server.importImageResults(db(),stored,request,{variants:candidates},"worker","warehouse-job");
  assert.equal(replay.batchId,result.batchId); assert.equal(stored.metadata.state.variants.length,2);
});

test("owner and version boundaries prevent reads and stale writes",async()=>{reset();await assert.rejects(server.imageRecord(db(),other,projectId),e=>e.code==="IMAGE_PROJECT_NOT_FOUND");const snapshot=structuredClone(stored);stored.version++;await assert.rejects(server.saveImageMeta(db(),snapshot,snapshot.metadata),e=>e.code==="IMAGE_VERSION_CONFLICT");assert.equal(stored.version,2);assert.equal(stored.metadata.state.variants.length,0);});

test("fake or other-project asset cannot be imported",async()=>{reset();await approveRequest(initial);const alien={...candidate,asset:{...baseAsset,path:`image-creatives/${other}/44444444-4444-4444-8444-444444444444.png`}};await assert.rejects(server.importImageResults(db(),stored,initial,{variants:[alien]},"tester"),e=>e.code==="IMAGE_ASSET_NOT_OWNED");const fake={...candidate,asset:{...baseAsset,path:`image-creatives/${projectId}/55555555-5555-4555-8555-555555555555.png`}};await assert.rejects(server.importImageResults(db(),stored,initial,{variants:[fake]},"tester"),e=>e.code==="IMAGE_ASSET_NOT_OWNED");const wrongSize={...candidate,asset:{...baseAsset,w:2}};await assert.rejects(server.importImageResults(db(),stored,initial,{variants:[wrongSize]},"tester"),e=>e.code==="IMAGE_ASSET_NOT_OWNED");assert.equal(stored.metadata.state.variants.length,0);});

test("rejected changes cannot cross allowed delta; retried receipt does not add again",async()=>{reset();await approveRequest(initial);const first=await server.importImageResults(db(),structuredClone(stored),initial,{variants:[candidate]},"tester","job-1");assert.equal(stored.metadata.state.variants.length,1);const again=await server.importImageResults(db(),structuredClone(stored),initial,{variants:[candidate]},"tester","job-1");assert.equal(again.batchId,first.batchId);assert.equal(stored.metadata.state.variants.length,1);const base=stored.metadata.state.variants[0];await reviewedFixture(base.id);await approveRequest({mode:"appeal",count:1,baseId:base.id});const illegal={appeal:{id:"b",meaning:"새로운 관점"},copy:{...base.copy,cta:"지금 신청"},formatId:"typography"};await assert.rejects(server.importImageResults(db(),structuredClone(stored),{mode:"appeal",count:1,baseId:base.id},{variants:[illegal]},"tester"),e=>e.status===422);const changedCta={appeal:{id:"c",meaning:"다른 이유"},copy:{...base.copy,cta:"지금 신청"}};await assert.rejects(server.importImageResults(db(),structuredClone(stored),{mode:"appeal",count:1,baseId:base.id},{variants:[changedCta]},"tester"),e=>e.status===422);assert.equal(stored.metadata.state.variants.length,1);});

const workerSource=readFileSync(new URL("../lib/server/youtube-ai-jobs.ts",import.meta.url),"utf8");
const workerJobId="66666666-6666-4666-8666-666666666666", lease="77777777-7777-4777-8777-777777777777";
let workerRow={id:workerJobId,owner_id:owner,record_type:"ai_job",archived_at:null,status:"active",metadata:{kind:"youtube_staff_ai_v1",task:"image-creative",sourceId:projectId,inputKey:"x".repeat(64),requestedAt:new Date().toISOString(),lease:{token:lease,expiresAt:"2000-01-01T00:00:00Z"}}};
function jobDb(){return {from(){let filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},async maybeSingle(){return {data:filters.every(([k,v])=>(k==="metadata->>kind"?workerRow.metadata.kind:workerRow[k])===v)?workerRow:null,error:null}},then(resolve){const value=k=>k==="metadata->>kind"?workerRow.metadata.kind:k==="metadata->>task"?workerRow.metadata.task:workerRow[k];return Promise.resolve(resolve({data:filters.every(([k,v])=>Array.isArray(v)?v.includes(value(k)):value(k)===v)?[workerRow]:[],error:null}));}};return q;}};}
const workerModules={"node:crypto":crypto,zod,"@/lib/http":{ApiError},"@/lib/supabase/server":{createServiceSupabase:jobDb},"./image-creatives":server,"@/lib/youtube-automation-gate":{canUseYoutubeStaffScript:()=>true},"@/lib/youtube-process/stages":{SLOTS:["A","B","C"]},"./youtube-process-card-job":{cardFormatsSchema:zod.z.array(zod.z.string())}};
const workerCompiled={exports:{}};
vm.runInNewContext(ts.transpileModule(workerSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:workerCompiled,exports:workerCompiled.exports,require:n=>workerModules[n]??{},process:{env:{}},Date,URL,console});
const worker=workerCompiled.exports;
test("paid GPT path is refused and expired worker lease cannot submit or upload",async()=>{
  await assert.rejects(worker.requestStaffJob({ownerId:owner},{task:"image-creative",sourceId:projectId,request:initial},{tier:"precise"}),e=>e.code==="IMAGE_SUBSCRIPTION_ONLY");
  await assert.rejects(worker.completeStaffJob({ownerId:owner,name:"tester"},{action:"complete",jobId:workerJobId,lease,model:"test",result:{variants:[candidate]}}),e=>e.code==="STAFF_AI_JOB_LEASE");
  await assert.rejects(worker.imageAssetForJob({ownerId:owner},{action:"prepare",jobId:workerJobId,lease,mimeType:"image/png",fileSize:1}),e=>e.code==="IMAGE_JOB_LEASE");
  await assert.rejects(worker.failStaffJob({ownerId:owner},{action:"fail",jobId:workerJobId,lease,reason:"expired"}),e=>e.code==="STAFF_AI_JOB_LEASE");
  await assert.rejects(worker.imageAssetForJob({ownerId:other},{action:"prepare",jobId:workerJobId,lease,mimeType:"image/png",fileSize:1}),e=>e.code==="STAFF_AI_JOB_NOT_FOUND");
});

const mcpSource=readFileSync(new URL("../lib/server/mcp.ts",import.meta.url),"utf8"), mcpCompiled={exports:{}};
vm.runInNewContext(ts.transpileModule(mcpSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mcpCompiled,exports:mcpCompiled.exports,require:n=>n==="zod"?zod:n==="../kosis.ts"?{}:(()=>{throw Error(n)})(),URLSearchParams,encodeURIComponent});
test("MCP prepare/commit converts public names to worker route and rejects malformed input",async()=>{
  const sent=[];const call=async(path,init)=>{sent.push({path,body:JSON.parse(init.body)});return {ok:true};};
  await mcpCompiled.exports.callMcpTool({name:"image_creative_asset",arguments:{action:"prepare",job_id:workerJobId,lease,mime_type:"image/png",file_size:123}},"org",call);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])),{path:"/api/v1/content/image-creatives/assets/worker",body:{action:"prepare",jobId:workerJobId,lease,mimeType:"image/png",fileSize:123}});
  await mcpCompiled.exports.callMcpTool({name:"image_creative_asset",arguments:{action:"commit",job_id:workerJobId,lease,path:baseAsset.path,receipt:other}},"org",call);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1])),{path:"/api/v1/content/image-creatives/assets/worker",body:{action:"commit",jobId:workerJobId,lease,path:baseAsset.path,receipt:other}});
  await assert.rejects(mcpCompiled.exports.callMcpTool({name:"image_creative_asset",arguments:{action:"prepare",job_id:workerJobId,lease,mime_type:"image/gif",file_size:123}},"org",call));
  assert.equal(sent.length,2);
});

test("active image job is reused for identical input and never replaced by different input",async()=>{
  reset();await approveRequest(initial);workerRow={...workerRow,parent_id:projectId,metadata:{...workerRow.metadata,inputKey:server.imageInputKey(stored,initial),lease:{token:lease,expiresAt:"2999-01-01T00:00:00Z"}}};
  const actor={id:owner,ownerId:owner,supabase:db()};const same=await worker.requestStaffJob(actor,{task:"image-creative",sourceId:projectId,request:initial});
  assert.equal(same.id,workerJobId);
  await assert.rejects(worker.requestStaffJob(actor,{task:"image-creative",sourceId:projectId,request:{...initial,count:2}}),e=>e.code==="IMAGE_FORMAT_APPROVAL_REQUIRED");
  assert.equal(workerRow.status,"active");
});

test("asset commit saves once and retried receipt is bound to same lease",async()=>{
  reset();const receipt="88888888-8888-4888-8888-888888888888";const hash=x=>crypto.createHash("sha256").update(x).digest("hex");
  const bytes=new Uint8Array(await sharp({create:{width:1,height:1,channels:3,background:"#ff0000"}}).png().toBuffer());
  stored.metadata.assets=[];stored.metadata.pendingAssets=[{path:baseAsset.path,receipt,leaseHash:hash(lease),size:bytes.length,mimeType:"image/png",expiresAt:Date.now()+60000}];
  let downloads=0;modules["@/lib/supabase/server"].createServiceSupabase=()=>({...db(),storage:{from:()=>({download:async()=>{downloads++;return {data:new Blob([bytes],{type:"image/png"}),error:null};}})}});
  const saved=await server.commitImageAsset(structuredClone(stored),baseAsset.path,receipt,lease);
  assert.equal(saved.path,baseAsset.path);assert.equal(saved.w,1);assert.equal(stored.metadata.assets.length,1);assert.equal(stored.metadata.assets[0].sha256,crypto.createHash("sha256").update(bytes).digest("hex"));assert.equal(downloads,1);
  const retried=await server.commitImageAsset(structuredClone(stored),baseAsset.path,receipt,lease);
  assert.deepEqual(JSON.parse(JSON.stringify(retried)),JSON.parse(JSON.stringify(saved)));assert.equal(downloads,1);assert.equal(stored.metadata.assets.length,1);
  await assert.rejects(server.commitImageAsset(structuredClone(stored),baseAsset.path,receipt,other),e=>e.code==="IMAGE_UPLOAD_RECEIPT");
  await assert.rejects(server.commitImageAsset(structuredClone(stored),baseAsset.path,other,lease),e=>e.code==="IMAGE_UPLOAD_RECEIPT");
});

test("actual decoder rejects a forged PNG header and honors JPEG orientation",async()=>{
  reset();const bad=new Uint8Array(33);bad.set([137,80,78,71,13,10,26,10]);const view=new DataView(bad.buffer);view.setUint32(8,13);view.setUint32(12,0x49484452);view.setUint32(16,1);view.setUint32(20,1);
  await assert.rejects(server.registerImageBytes(structuredClone(stored),bad),e=>e.code==="IMAGE_FILE_INVALID");
  const jpeg=new Uint8Array(await sharp({create:{width:2,height:3,channels:3,background:"#123456"}}).jpeg().withMetadata({orientation:6}).toBuffer());
  const jpegPath=baseAsset.path.replace(/\.png$/, ".jpg"),receipt="99999999-9999-4999-8999-999999999999",hash=x=>crypto.createHash("sha256").update(x).digest("hex");
  stored.metadata.pendingAssets=[{path:jpegPath,receipt,leaseHash:hash(lease),size:jpeg.length,mimeType:"image/jpeg",expiresAt:Date.now()+60000}];
  modules["@/lib/supabase/server"].createServiceSupabase=()=>({...db(),storage:{from:()=>({download:async()=>({data:new Blob([jpeg],{type:"image/jpeg"}),error:null})})}});
  const saved=await server.commitImageAsset(structuredClone(stored),jpegPath,receipt,lease);
  assert.equal(saved.w,3);assert.equal(saved.h,2);
});

test("private export uses a content-addressed key and a 15-minute named download",async()=>{
  reset();const calls=[];let failUpload=false;
  modules["@/lib/supabase/server"].createServiceSupabase=()=>({storage:{from:(bucket)=>({
    upload:async(path,bytes,options)=>{calls.push({op:"upload",bucket,path,bytes:[...bytes],options});return {error:failUpload?new Error("down"):null};},
    createSignedUrl:async(path,seconds,options)=>{calls.push({op:"sign",bucket,path,seconds,options});return {data:{signedUrl:"https://storage.example/private"},error:null};},
  })}});
  const body=new TextEncoder().encode("01234567890123456789"),file={body,type:"application/zip",name:"test.zip"};
  const first=await server.signedImageExport(stored,file);await server.signedImageExport(stored,file);
  const key=`image-creatives/${projectId}/exports/${crypto.createHash("sha256").update(body).digest("hex")}.zip`;
  assert.equal(first.url,"https://storage.example/private");assert.equal(first.name,"test.zip");
  assert.equal(calls[0].path,key);assert.deepEqual(calls[0].bytes,[...body]);assert.equal(calls[0].options.contentType,"application/zip");
  assert.equal(calls[1].path,key);assert.equal(calls[1].seconds,900);assert.equal(calls[1].options.download,"test.zip");
  assert.equal(calls[2].path,key);assert.equal(calls[3].path,key);
  failUpload=true;await assert.rejects(server.signedImageExport(stored,file),e=>e.code==="IMAGE_EXPORT_UPLOAD");assert.equal(calls.length,5);
});

test("image test rejects same content at another path or twice in a batch and accepts distinct content",async()=>{
  reset();const second={...baseAsset,path:baseAsset.path.replace("44444444-4444-4444-8444-444444444444","55555555-5555-4555-8555-555555555555")};
  const third={...baseAsset,path:baseAsset.path.replace("44444444-4444-4444-8444-444444444444","66666666-6666-4666-8666-666666666666")};
  const fourth={...baseAsset,path:baseAsset.path.replace("44444444-4444-4444-8444-444444444444","77777777-7777-4777-8777-777777777777")};
  stored.metadata.assets.push({...second,sha256:"a".repeat(64)},{...third,sha256:"b".repeat(64)},{...fourth,sha256:"b".repeat(64)});
  await approveRequest(initial);
  await server.importImageResults(db(),structuredClone(stored),initial,{variants:[candidate]},"tester");
  const start=stored.metadata.state.variants.at(-1);
  await reviewedFixture(start.id);
  await approveRequest({mode:"appeal",count:1,baseId:start.id});
  await server.importImageResults(db(),structuredClone(stored),{mode:"appeal",count:1,baseId:start.id},{variants:[{appeal:{id:"b",meaning:"다른 고객 상황"},copy:{...start.copy,headline:"일이 자꾸 미뤄진다면"}}]},"tester");
  const appeal=stored.metadata.state.variants.at(-1);
  await reviewedFixture(appeal.id);
  await approveRequest({mode:"copy",count:1,baseId:appeal.id,copyFields:["headline"]});
  await server.importImageResults(db(),structuredClone(stored),{mode:"copy",count:1,baseId:appeal.id,copyFields:["headline"]},{variants:[{copy:{headline:"시작이 자꾸 늦어진다면"}}]},"tester");
  const base=stored.metadata.state.variants.at(-1), before=stored.metadata.state.variants.length;
  await reviewedFixture(base.id);
  await approveRequest({mode:"image",count:1,baseId:base.id,assetPaths:[second.path]});
  await assert.rejects(server.importImageResults(db(),structuredClone(stored),{mode:"image",count:1,baseId:base.id,assetPaths:[second.path]},{variants:[{asset:second}]},"tester"),e=>e.code==="IMAGE_DUPLICATE_FILE");
  await approveRequest({mode:"image",count:2,baseId:base.id,assetPaths:[third.path,fourth.path]});
  await assert.rejects(server.importImageResults(db(),structuredClone(stored),{mode:"image",count:2,baseId:base.id,assetPaths:[third.path,fourth.path]},{variants:[{asset:third},{asset:fourth}]},"tester"),e=>e.code==="IMAGE_DUPLICATE_FILE");
  assert.equal(stored.metadata.state.variants.length,before);
  await approveRequest({mode:"image",count:1,baseId:base.id,assetPaths:[third.path]});
  await server.importImageResults(db(),structuredClone(stored),{mode:"image",count:1,baseId:base.id,assetPaths:[third.path]},{variants:[{asset:third}]},"tester");
  assert.equal(stored.metadata.state.variants.length,before+1);assert.equal(stored.metadata.state.variants.at(-1).asset.path,third.path);
});

test("temporary image source read failure leaves active worker job unchanged",async()=>{
  workerRow={...workerRow,status:"active",metadata:{...workerRow.metadata,imageRequest:initial,inputKey:"x".repeat(64),lease:{token:lease,expiresAt:"2999-01-01T00:00:00Z"}}};
  const before=structuredClone(workerRow), original=server.imageRecord;
  server.imageRecord=async()=>{throw new ApiError(503,"IMAGE_READ_FAILED","temporary");};
  try {
    await assert.rejects(worker.completeStaffJob({ownerId:owner,name:"tester"},{action:"complete",jobId:workerJobId,lease,model:"test",result:{variants:[candidate]}}),e=>e.status===503&&e.code==="IMAGE_READ_FAILED");
    assert.deepEqual(workerRow,before);
  } finally { server.imageRecord=original; }
});

test("the legacy comparison panel cannot write a second copy-production workflow",async()=>{
  reset();
  const input={...formatTest.MYIN_FORMAT_TEST,assetPath:baseAsset.path};
  const historical = formatTest.addFormatTest([], owner, input, "2026-11-09");
  stored.metadata.state.formatTests=historical;
  await assert.rejects(decision({action:"save-format-test",id:other,input}),e=>e.code==="IMAGE_FORMAT_APPROVAL_REQUIRED");
  assert.equal(stored.metadata.state.formatTests,historical);
});

test("previously saved format tests preserve their artwork when reloaded or used for a follow-up", () => {
  const { renderVersion, ...oldInput } = formatTest.MYIN_FORMAT_TEST;
  assert.equal(renderVersion, 2);
  const [legacy] = formatTest.addFormatTest(undefined, owner, oldInput, "2026-11-09");
  assert.equal(legacy.renderVersion ?? 1, 1);
  const edited = { ...oldInput, copy: { ...oldInput.copy, headline: "다른 일을 고를까?" },
    followup: { baseId: owner, formatId: "M01", mode: "copy" } };
  assert.throws(() => formatTest.addFormatTest([legacy], projectId, { ...edited, renderVersion: 2 }, "2026-11-10"), /디자인 버전/);
  assert.equal(formatTest.addFormatTest([legacy], projectId, { ...edited, renderVersion: 1 }, "2026-11-10")[1].renderVersion, 1);
  assert.throws(() => formatTest.addFormatTest([legacy], owner, { ...oldInput, renderVersion: 2 }, "2026-11-10"), /묶음 ID/);
});


test("historical batches require explicit review and cannot export, preview or print as approved", async () => {
  reset();
  const first = {...candidate, id:other};
  const historical = {id:projectId,variantIds:[other]};
  Object.assign(stored.metadata.state,{variants:[first],batches:[historical]});
  await assert.rejects(server.exportImageCreative(stored,{batchId:projectId}),e=>e.code==="IMAGE_RENDER_PENDING");
  await assert.rejects(server.savedDesignPreview(stored,other),e=>e.code==="IMAGE_COPY_APPROVAL_REQUIRED");
  await assert.rejects(decision({action:"select",variantId:other}),e=>e.code==="IMAGE_FINAL_REQUIRED");
  await assert.rejects(decision({action:"approve-copy",batchId:projectId}),e=>e.code==="IMAGE_FORMAT_APPROVAL_REQUIRED");
  await assert.rejects(decision({action:"render",batchId:projectId,target:"local"}),e=>e.code==="IMAGE_PREVIEW_REQUIRED");
  await decision({action:"approve-format",batchId:projectId});
  await decision({action:"approve-copy",batchId:projectId});
  assert.ok(server.canPreviewVariant(stored.metadata,other));
  assert.deepEqual(stored.metadata.renders,undefined);
});
test("format approval belongs to a human and is consumed atomically for its exact request",async()=>{
  reset();
  const command={version:stored.version,action:"approve-format",request:initial};
  for (const actor of [{...ownerActor(),type:"agent"},{...ownerActor(),id:other}])
    await assert.rejects(server.patchImageProject(actor,stored,command),e=>e.code==="IMAGE_HUMAN_REQUIRED");
  await assert.rejects(server.importImageResults(db(),stored,initial,{variants:[candidate]},"worker"),e=>e.code==="IMAGE_FORMAT_APPROVAL_REQUIRED");
  await approveRequest(initial);
  const approvedVersion = stored.version;
  await decision({action:"save-brief",brief:stored.metadata.state.brief});
  assert.equal(stored.version,approvedVersion);
  await assert.rejects(server.importImageResults(db(),stored,{...initial,count:2},{variants:[candidate]},"worker"),e=>e.code==="IMAGE_FORMAT_APPROVAL_REQUIRED");
  const {batchId}=await server.importImageResults(db(),stored,initial,{variants:[candidate]},"worker");
  assert.ok(!stored.metadata.state.formatApproval);
  assert.deepEqual(stored.metadata.state.batches[0].review.history.map(r=>r.step),["format"]);
  await assert.rejects(server.importImageResults(db(),stored,initial,{variants:[candidate]},"worker"),e=>e.code==="IMAGE_FORMAT_APPROVAL_REQUIRED");
  await assert.rejects(decision({action:"confirm-preview",batchId,target:"local"}),e=>e.code==="IMAGE_COPY_APPROVAL_REQUIRED");
  await decision({action:"approve-copy",batchId});
  assert.equal(stored.metadata.renders,undefined);
  await assert.rejects(decision({action:"approve-final",batchId,runId:other}),e=>e.code==="IMAGE_RENDER_PENDING");
  await decision({action:"confirm-preview",batchId,target:"local"});
  await decision({action:"return-review",batchId,stage:"copy",reason:"구매 이유를 다시 확인"});
  assert.equal(stored.metadata.renders[0].status,"failed");
  assert.ok(!stored.metadata.state.batches[0].review.copy && !stored.metadata.state.batches[0].review.preview);
  assert.equal(stored.metadata.state.batches[0].review.history.at(-1).decision,"returned");
});
test("design revision accepts only typed changes, preserves the original and handles a stale retry safely", async()=>{
  reset();
  const actor={supabase:db(), ownerId:owner, name:"owner"};
  await approveRequest(initial);
  const {batchId}=await server.importImageResults(actor.supabase,stored,initial,{variants:[candidate]},actor.name);
  await decision({action:"approve-copy",batchId});
  const before=structuredClone(stored), source=before.metadata.state.variants[0];
  const design={font:"hand",card:"paper",placement:"feed-square"};
  const command={action:"revise-design",version:before.version,baseId:source.id,id:other,design};
  for (const bad of [{font:"http://external.test/font.ttf"},{card:"url(https://external.test)"},{placement:"wide"},{outputWidth:0},{outputWidth:2048},{headline:"changed"}]) {
    assert.equal(server.imagePatchSchema.safeParse({...command,design:{...design,...bad}}).success,false);
  }
  assert.equal(server.imagePatchSchema.safeParse({...command,asset:baseAsset}).success,false);
  const save=(record,payload)=>server.patchImageProject(actor,record,server.imagePatchSchema.parse(payload));
  await save(stored,command);
  const meta=stored.metadata.state;
  assert.equal(meta.selectedId,"");assert.equal(meta.variants.length,2);assert.equal(meta.batches.at(-1).review,undefined);
  assert.deepEqual(meta.variants[0],source);assert.deepEqual(meta.variants[1].asset,source.asset);
  assert.equal(meta.variants[1].size,"square");assert.equal(meta.batches.at(-1).mode,meta.batches[0].mode);
  const savedVersion=stored.version;
  await save(stored,{...command,design:{...design,outputWidth:1080}});
  assert.equal(stored.version,savedVersion);
  await assert.rejects(save(stored,{...command,design:{...design,font:"serif"}}),e=>e.code==="IMAGE_REVISION_CONFLICT");
  await assert.rejects(save(stored,{...command,id:projectId,design:{...design,font:"serif"}}),e=>e.code==="IMAGE_VERSION_CONFLICT");
  assert.equal(stored.version,savedVersion);
});

test("a Mac renders only an assigned saved batch; its checked PNG is the actual download", async () => {
  reset();
  const documents = () => structuredClone(stored);
  const files = new Map();
  const mobile = await sharp({create:{width:2,height:3,channels:3,background:"#332211"}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const jpeg = {...baseAsset,path:baseAsset.path.replace(".png",".jpg"),w:3,h:2};
  stored.metadata.assets=[{...jpeg,sha256:crypto.createHash("sha256").update(mobile).digest("hex")}];
  files.set(jpeg.path,new Blob([mobile],{type:"image/jpeg"}));
  let cachedWrites=0;
  const bucket = {
    exists:async path=>({data:files.has(path)}),
    info:async path=>({data:{size:files.get(path)?.size,contentType:files.get(path)?.type}}),
    upload:async (path,bytes,opts)=>{cachedWrites++;files.set(path,new Blob([bytes],{type:opts.contentType}));return {error:null};},
    createSignedUrl:async path=>({data:{signedUrl:"https://storage.example/"+path}}),
    createSignedUploadUrl:async (path,options)=>{assert.equal(options.upsert,false);return {data:{signedUrl:path}};},
    download:async path=>({data:files.get(path)??null}),
  };
  const backend = {
    storage:{from:()=>bucket},
    from() {
      const cond=[];
      const query={select(){return query;}, eq(key,v){cond.push(r=>(key==="metadata->>kind"?r.metadata.kind:r[key])===v);return query;},
        is(key,v){return query.eq(key,v);}, contains(key,p){cond.push(r=>r[key].renders?.some(run=>Object.entries(p.renders[0]).every(([k,v])=>run[k]===v)));return query;},
        order(){return query;}, async range(){return {data:cond.every(fn=>fn(stored))?[documents()]:[]};},
        async maybeSingle(){return {data:cond.every(fn=>fn(stored))?documents():null};}, update(v){return db().from().update(v);} };
      return query;
    },
  };
  const source = readFileSync(new URL("../lib/server/image-mac-render.ts",import.meta.url),"utf8");
  const compiled={exports:{}};
  const testDeps={...modules,"./image-creatives":server,"@/lib/supabase/server":{createServiceSupabase:()=>backend}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module:compiled,exports:compiled.exports,require:n=>testDeps[n],Buffer,Date});
  modules["@/lib/supabase/server"].createServiceSupabase=()=>backend;
  const {imageMacWork, macReviewPng}=compiled.exports;
  const local={target:"local",ownerId:owner}, someoneElse={target:"local",ownerId:other}, shared={target:"render-pc"};
  const actor = { type:"user", supabase: db(), id: owner, ownerId: owner, name:"담당자" };
  const decide = payload => server.patchImageProject(actor, documents(),
    server.imagePatchSchema.parse({...payload, version: stored.version}));
  const poll={action:"image_creative_claim",rendererVersion:1};
  await decide({action:"approve-format", request:initial});
  const {batchId}=await server.importImageResults(db(),stored,initial,{variants:[{...candidate,asset:jpeg}]},"subscription","job-1","local");
  const [variantId] = stored.metadata.state.batches.at(-1).variantIds;
  assert.equal(stored.metadata.renders?.length ?? 0, 0);

  // Older OS versions already had queued and leased work with no human approval.
  const legacy = {id:crypto.randomUUID(), batchId, target:"local", variantIds:[variantId], status:"queued"};
  const oldLease = crypto.randomUUID();
  const activeLegacy = {...legacy, id:crypto.randomUUID(), status:"active", expires:Date.now()+60_000,
    leaseHash:crypto.createHash("sha256").update(oldLease).digest("hex")};
  stored.metadata.renders = [legacy, activeLegacy];
  assert.equal((await imageMacWork(local,poll)).idle,true);
  await assert.rejects(imageMacWork(local,{action:"image_creative_prepare",jobId:activeLegacy.id,lease:oldLease,variantId,fileSize:100}),e=>e.code==="IMAGE_RENDER_NOT_FOUND");
  await assert.rejects(decide({action:"confirm-preview",batchId,target:"local"}));
  await decide({action:"approve-copy",batchId});
  assert.equal((await imageMacWork(local,poll)).idle,true);
  await decide({action:"confirm-preview",batchId,target:"local"});
  const run=stored.metadata.renders.at(-1);
  assert.notEqual(run.id,activeLegacy.id);
  assert.equal((await imageMacWork(shared,poll)).idle,true);
  assert.equal((await imageMacWork(someoneElse,poll)).idle,true);
  const {jobId,lease}=await imageMacWork(local,poll);
  assert.equal(jobId,run.id);assert.equal((await imageMacWork(local,poll)).idle,true);
  const scene={action:"image_creative_scene",jobId,lease,variantId};
  for (const caller of [shared,someoneElse]) await assert.rejects(imageMacWork(caller,scene), e=>e.code==="IMAGE_RENDER_NOT_FOUND");
  await assert.rejects(imageMacWork(local,{...scene,lease:crypto.randomUUID()}), e=>e.code==="IMAGE_RENDER_LEASE");
  await assert.rejects(imageMacWork(local,{...scene,variantId:crypto.randomUUID()}), e=>e.code==="IMAGE_RENDER_NOT_FOUND");
  const descriptor=await imageMacWork(local,scene);
  assert.match(descriptor.photoUrl,/\/render-sources\/v1\/[a-f0-9]{64}\.png$/);
  const normalized=await sharp(Buffer.from(await files.get(descriptor.photoUrl.slice("https://storage.example/".length)).arrayBuffer())).metadata();
  assert.deepEqual([normalized.format,normalized.width,normalized.height],["png",3,2]);
  assert.equal((await imageMacWork(local,scene)).photoUrl,descriptor.photoUrl);assert.equal(cachedWrites,1);
  assert.equal(descriptor.variant.copy.headline,candidate.copy.headline);
  await assert.rejects(server.exportImageCreative(stored,{variantId}));
  await assert.rejects(macReviewPng(stored,variantId,jobId));
  await assert.rejects(decide({action:"approve-final",batchId,runId:jobId}));
  const bytes=await sharp({create:{width:descriptor.width,height:descriptor.height,channels:3,background:"#fff"}}).png().toBuffer();
  const {signedUrl}=await imageMacWork(local,{action:"image_creative_prepare",jobId,lease,variantId,fileSize:bytes.length});
  files.set(signedUrl,new Blob([bytes],{type:"image/png"}));
  const f={variantId,bytes:bytes.length,sha256:crypto.createHash("sha256").update(bytes).digest("hex")};
  const complete={action:"image_creative_complete",jobId,lease,files:[f]};
  await assert.rejects(imageMacWork(local,{...complete,files:[]}),e=>e.code==="IMAGE_RENDER_INCOMPLETE");
  await assert.rejects(imageMacWork(local,{...complete,files:[{...f,sha256:"0".repeat(64)}]}),e=>e.code==="IMAGE_RENDER_HASH");
  assert.equal((await imageMacWork(local,complete)).done,true);
  assert.equal((await imageMacWork(local,complete)).done,true);
  await assert.rejects(imageMacWork(local,{...complete,files:[{...f,sha256:"0".repeat(64)}]}),e=>e.code==="IMAGE_RENDER_RECEIPT");
  assert.equal(stored.metadata.renders.at(-1).status,"done");
  await assert.rejects(server.exportImageCreative(stored,{variantId}));
  await assert.rejects(macReviewPng(stored,variantId,activeLegacy.id));
  const preview = await macReviewPng(stored,variantId,jobId);
  assert.equal((await sharp(preview).metadata()).width,900);
  const firstPixel = await sharp(preview).removeAlpha().raw().toBuffer();
  assert.deepEqual([...firstPixel.subarray(0,3)],[255,255,255]);
  await assert.rejects(decide({action:"approve-final",batchId,runId:activeLegacy.id}));
  await decide({action:"approve-final",batchId,runId:jobId});
  const exported=await server.exportImageCreative(stored,{variantId});
  assert.deepEqual(Buffer.from(exported.body),bytes);
  await decide({action:"return-review",batchId,stage:"final",reason:"사진 구도를 다시 확인"});
  await assert.rejects(macReviewPng(stored,variantId,jobId));
  await assert.rejects(server.exportImageCreative(stored,{variantId}));
  await decide({action:"confirm-preview",batchId,target:"render-pc"});
  assert.equal((await imageMacWork(local,poll)).idle,true);
  const next=await imageMacWork(shared,poll);
  const last=stored.metadata.renders.at(-1);last.expires=1;
  await assert.rejects(imageMacWork(shared,{...scene,jobId:next.jobId,lease:next.lease}),e=>e.code==="IMAGE_RENDER_LEASE");
  const retry=await imageMacWork(shared,poll);
  assert.equal(retry.jobId,next.jobId);assert.notEqual(retry.lease,next.lease);
  const retryArgs = {jobId:retry.jobId,lease:retry.lease};
  const slot = await imageMacWork(shared,{action:"image_creative_prepare",...retryArgs,variantId,fileSize:bytes.length});
  files.set(slot.signedUrl,new Blob([bytes],{type:"image/png"}));
  // A human returns the preview while the app is checking uploaded bytes.
  // The prior lease was valid on entry; it must not publish after the return.
  const download = bucket.download;
  bucket.download = async path => {
    if (path === slot.signedUrl) {
      await decide({action:"return-review",batchId,stage:"preview",reason:"미리보기 수정 요청"});
      bucket.download = download;
    }
    return download(path);
  };
  await assert.rejects(imageMacWork(shared,{...complete,...retryArgs}),e=>e.code==="IMAGE_RENDER_NOT_FOUND");
  await assert.rejects(imageMacWork(shared,{...scene,...retryArgs}),e=>e.code==="IMAGE_RENDER_NOT_FOUND");
  await assert.rejects(server.exportImageCreative(stored,{variantId}));
});

import * as placements from '../lib/image-creative/placement.ts';
import * as direction from '../lib/image-creative/direction.ts';
import * as subjectBox from '../lib/image-creative/subject-box.ts';
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
const modules={"@/lib/image-creative/direction":direction,"@/lib/image-creative/subject-box":subjectBox,"./image-ad-products": {readImageAdProducts:async()=>[]}, "@/lib/image-creative/placement":placements,"@/lib/image-creative/format-test":formatTest,"node:crypto":crypto,"next/dist/server/image-optimizer":sharpModule,"node:fs/promises":{},"node:path":{},react:{createElement:()=>({})},"next/og":{ImageResponse:class { async arrayBuffer(){return new ArrayBuffer(0);} }},zod,"@/lib/http":{ApiError},"@/lib/supabase/server":{},"@/lib/cardnews/zip":{},"@/lib/image-creative/formats":formats,"@/lib/image-creative/format-test-fonts.json":{default:JSON.parse(readFileSync(new URL("../lib/image-creative/format-test-fonts.json",import.meta.url),"utf8"))},"@/lib/image-creative/model":model,"@/lib/image-creative/storage":storage,"@/lib/image-creative/view":{},"./youtube-process-stages":{}};
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

test("address-free planning validates canonical product claims, keeps older approvals and excludes old addresses from AI work", async () => {
  reset();
  const legacyUrl = "https://example.test/old-destination";
  stored.metadata.state.brief = { ...brief, landingUrl: legacyUrl, mainMessage: "첫 장면" };
  const unchanged = server.imagePatchSchema.parse({action:"save-brief",version:1,brief:stored.metadata.state.brief});
  assert.ok(!Object.hasOwn(unchanged.brief, "landingUrl"));
  assert.equal((await server.patchImageProject(ownerActor(),stored,unchanged)).version,1);
  await approveRequest(initial);
  const approvedKey = stored.metadata.state.formatApproval.key;
  assert.ok(approvedKey.includes(legacyUrl));
  assert.deepEqual(server.checkedImageRequest(stored,initial).formatIds,initial.formatIds);
  assert.doesNotMatch(server.imageJobInstructions(stored,initial),/old-destination|landingUrl/);
  reset();
  const reference = {productId:"sample",source:{id:projectId,version:3},audienceSource:{id:other,version:1}};
  const item = {id:"sample",product:brief.product,audience:brief.audience,offer:brief.offer,brand:"",source:reference.source,audienceSource:reference.audienceSource};
  const oldLookup = modules["./image-ad-products"].readImageAdProducts;
  const nextBrief = {...brief, mainMessage:"고객이 볼 문구", funnel:"", productSource:reference};
  const pick = brief => decision({action:"recommend-formats",brief,mode:"appeal",count:5,size:"portrait"});
  try {
    modules["./image-ad-products"].readImageAdProducts = async () => [item];
    await assert.rejects(pick({...nextBrief,offer:"기획자가 임의로 붙인 혜택"}),e=>e.code === "IMAGE_PRODUCT_CHANGED");
    await assert.rejects(pick({...nextBrief,productSource:{...reference,source:{id:projectId,version:2}}}),e=>e.code === "IMAGE_PRODUCT_CHANGED");
    await pick(nextBrief);
    const version = stored.version;
    await pick(structuredClone(nextBrief));
    assert.equal(stored.version,version);
    assert.equal(stored.metadata.state.brief.productSource.source.version,3);
    // A previously saved project's pending recommendation can complete after the UI update.
    stored.metadata.state.brief.landingUrl = legacyUrl;
    assert.doesNotMatch(server.imageJobInstructions(stored,{phase:"formats"}),/old-destination|landingUrl/);
    assert.match(server.imageJobInstructions(stored,{phase:"formats"}),/고객이 볼 문구/);
  } finally { modules["./image-ad-products"].readImageAdProducts = oldLookup; }
});

test("owner and version boundaries prevent reads and stale writes",async()=>{reset();await assert.rejects(server.imageRecord(db(),other,projectId),e=>e.code==="IMAGE_PROJECT_NOT_FOUND");const snapshot=structuredClone(stored);stored.version++;await assert.rejects(server.saveImageMeta(db(),snapshot,snapshot.metadata),e=>e.code==="IMAGE_VERSION_CONFLICT");assert.equal(stored.version,2);assert.equal(stored.metadata.state.variants.length,0);});

test("a chosen thumbnail photo needs only copy and the winning photo survives a headline test", async () => {
  reset();
  stored.metadata.assets[0].subjectBox = [0,0,1,1];
  const first = {mode:"appeal",count:1,formatIds:["thumbnail_subject"],assetPaths:[baseAsset.path]};
  await approveRequest(first);
  assert.equal(server.imageJobPhase(stored,first,true),"copy");
  const instructions = server.imageJobInstructions(stored,first,true);
  assert.ok(instructions.includes(baseAsset.path));
  assert.doesNotMatch(instructions,/image_creative_asset/);
  const result = await server.importImageResults(db(),stored,first,{variants:[{...candidate,formatId:"thumbnail_subject"}]},"worker");
  const winner = result.record.metadata.state.variants[0];
  await reviewedFixture(winner.id);
  const next = {mode:"copy",count:1,baseId:winner.id,copyFields:["headline"]};
  await approveRequest(next);
  assert.equal(server.imageJobPhase(stored,next,true),"copy");
  assert.match(server.imageJobInstructions(stored,next,true),/기준 사진과 구도/);
  const copy = await server.importImageResults(db(),stored,next,{variants:[{copy:{headline:"작게 시작하기"}}]},"worker");
  const revised = copy.record.metadata.state.variants.at(-1);
  assert.deepEqual(revised.asset,winner.asset);
  assert.equal(revised.copy.cta,winner.copy.cta);
  assert.deepEqual(revised.appeal,winner.appeal);
  assert.notEqual(revised.copy.headline,winner.copy.headline);
});

test("a new appeal plan waits for an independent concept and medium, then binds the fresh scene to approval", async () => {
  reset();
  const planning = {phase:"formats"};
  const motives = ["내가 자주 돕는 일", "내가 오래 하는 일"].map((meaning, i) => ({id:"m-" + i, meaning}));
  const concepts = ["무심코 해온 일이 동료에게 도움이 된다", "내 행동을 다른 자리에서 다시 본다"];
  const direction = {concept:"내가 먼저 찾는 것을 보면 내 기준이 보인다", medium:"photo"};
  const shot = "달력 옆 두 시간표에서 출근 시각에 손가락이 멈춘다.";
  const nextShot = "작업대를 떠나기 전 가방에 든 두 제안 중 하나를 다시 꺼낸다.";
  const items = ["photo_headline","annotated","thumbnail_subject"].map(id=>({id,reason:"이 장면에서 손이 멈춘 대상을 짚는다."}));
  const request = {mode:"appeal",size:"portrait",count:2,formatIds:["photo_headline"],assetPaths:[baseAsset.path]};
  const current = () => stored.metadata.state.formatRecommendation;
  const submit = (result,id) => server.importFormatRecommendations(db(),stored,result,id);
  await decision({action:"recommend-formats",brief,mode:"appeal",size:"portrait",count:2,appealFirst:true,conceptFirst:true});
  assert.equal(server.imageJobPhase(stored,planning),"concepts");
  await assert.rejects(submit({appeals:motives,concepts,items},"early-formats"));
  await submit({appeals:motives,concepts},"motives");
  assert.deepEqual(current().concepts,concepts);
  assert.equal(current().items,undefined);
  await assert.rejects(approveRequest(request));
  await decision({action:"plan-scene",direction});
  const prompt = server.imageJobInstructions(stored,planning);
  assert.equal(server.imageJobPhase(stored,planning),"scene");
  for(const input of [direction.concept,direction.medium,...motives.map(m=>m.meaning)]) assert.ok(prompt.includes(input),input);
  const firstPlanningKey = server.imageInputKey(stored,planning);
  await decision({action:"plan-scene",direction});
  assert.equal(server.imageInputKey(stored,planning),firstPlanningKey);
  await submit({scene:shot,items},"first-scene");
  await decision({action:"plan-scene",direction,replan:true});
  assert.equal(current().items,undefined);
  assert.notEqual(server.imageInputKey(stored,planning),firstPlanningKey);
  assert.ok(server.imageJobInstructions(stored,planning).includes(shot));
  await assert.rejects(approveRequest(request));
  await assert.rejects(submit({scene:shot,items},"repeated-scene"));
  await submit({scene:nextShot,items},"new-scene");
  assert.equal(current().scene,nextShot);
  assert.deepEqual(current().appeals,motives);
  await approveRequest(request);
  assert.ok(server.imageJobInstructions(stored,request).includes(nextShot));
  assert.ok(stored.metadata.state.formatApproval.key);
});

test("reference-led single ads offer five optional appeals and bind only the selected appeal and design to the copy", async () => {
  reset();
  const start = {mode:"standalone",size:"portrait",brief};
  await decision({action:"recommend-appeals",...start,count:1});
  const planning = {phase:"formats"};
  assert.equal(server.imageJobPhase(stored,planning),"appeal-options");
  assert.match(server.imageJobInstructions(stored,planning),/5개만/);
  const options = ["익숙한 일을 발견한다","잘하는 일을 설명한다","다음 일을 고른다","부탁받는 일을 돌아본다","내 선택을 비교한다"].map((meaning,i)=>({id:"a"+i,meaning}));
  await assert.rejects(server.importFormatRecommendations(db(),stored,{appeals:options,items:[]},"wrong"));
  await server.importFormatRecommendations(db(),stored,{appeals:options},"ok");
  assert.ok(!stored.metadata.state.formatRecommendation.appeals);
  await assert.rejects(approveRequest({mode:"standalone",size:"portrait",count:1,formatIds:["note"]}));
  await assert.rejects(decision({action:"select-appeals",...start,appeals:options.slice(0,2)}));
  const appeals = [options[2]];
  await decision({action:"select-appeals",...start,appeals});
  const request = {mode:"standalone",size:"portrait",count:1,formatIds:["note"]};
  await approveRequest(request);
  assert.ok(server.imageJobInstructions(stored,request,true).includes(appeals[0].meaning));
  assert.match(server.imageJobInstructions(stored,request,true),/디자인 레퍼런스: 짧은 메모/);
  const correct = {formatId:"note",formatVersion:1,size:"portrait",appeal:appeals[0],copy:{headline:"선택할 순간",body:"내 기준을 찾아요",cta:"진단 보기"}};
  await assert.rejects(server.importImageResults(db(),stored,request,{variants:[{...correct,appeal:options[0]}]},"worker"),e=>e.code==="IMAGE_APPEAL_MISMATCH");
  await decision({action:"import",request,result:{variants:[correct]}});
  const batchId = stored.metadata.state.batches[0].id;
  const edited = {...correct.copy,headline:"무엇을 고를까"};
  await decision({action:"confirm-reference-copy",batchId,copies:[edited]});
  const version = stored.version;
  assert.equal(stored.metadata.state.variants[0].copy.headline,edited.headline);
  await decision({action:"confirm-reference-copy",version:version-1,batchId,copies:[edited]});
  assert.equal(stored.version,version);
  await assert.rejects(decision({action:"confirm-reference-copy",batchId,copies:[correct.copy]}),e=>e.code==="IMAGE_COPY_LOCKED");
  const original = stored.metadata.state.batches[0].review;
  await decision({action:"revise-design",baseId:stored.metadata.state.variants[0].id,id:crypto.randomUUID(),design:{font:"serif",card:"paper",placement:"feed-portrait"}});
  const revised = stored.metadata.state.batches.at(-1).review;
  assert.deepEqual(revised.copy,original.copy);
  assert.deepEqual(revised.format,original.format);
  assert.ok(!revised.preview && !revised.final);
});

test("direct A/B appeals skip any AI request, reject duplicates and preserve the selected references, copy and shared CTA", async () => {
  reset();
  stored.metadata.state.experiment=true;
  const start = {mode:"appeal",size:"portrait",brief};
  const appeals = [{id:"a",meaning:"일의 기준을 찾는다"},{id:"b",meaning:"강점을 기억한다"}];
  await assert.rejects(decision({action:"select-appeals",...start,appeals:[appeals[0],{...appeals[1],meaning:appeals[0].meaning+"."}]}));
  await decision({action:"select-appeals",...start,appeals});
  const plan = stored.metadata.state.formatRecommendation;
  assert.ok(!plan.appealOptions && !plan.conceptFirst && !plan.items.some(item=>item.id==="M01"));
  const request = {mode:"appeal",size:"portrait",count:2,formatIds:["note"]};
  await assert.rejects(approveRequest({...request,formatIds:["report_crop"]}));
  await approveRequest(request);
  const copies = [{headline:"내가 고른 일",body:"기준을 확인해요",cta:"진단 보기"},{headline:"내가 잘한 일",body:"강점을 확인해요",cta:"진단 보기"}];
  await decision({action:"import",request,result:{variants:appeals.map((appeal,i)=>({formatId:"note",formatVersion:1,size:"portrait",appeal,copy:copies[i]}))}});
  const batch = stored.metadata.state.batches[0];
  await assert.rejects(decision({action:"confirm-reference-copy",batchId:batch.id,copies:[copies[0],{...copies[1],cta:"다른 버튼"}]}));
  assert.ok(!stored.metadata.state.batches[0].review.copy);
  await decision({action:"confirm-reference-copy",batchId:batch.id,copies});
  assert.ok(stored.metadata.state.batches[0].review.copy);
});

test("real-product direction uses the selected original and rejects a new thumbnail without an asset", async () => {
  reset();
  const appeals = [{id:"a",meaning:"직접 결과를 보고 싶다"}];
  const concepts = ["결과 한곳을 살펴본다","받을 내용을 직접 펼친다"];
  const request = {mode:"appeal",size:"portrait",count:1,formatIds:["report_crop"],assetPaths:[baseAsset.path]};
  await decision({action:"recommend-formats",brief,mode:"appeal",size:"portrait",count:1,appealFirst:true,conceptFirst:true});
  await server.importFormatRecommendations(db(),stored,{appeals,concepts},"motives");
  await decision({action:"plan-scene",direction:{concept:concepts[1],medium:"product"}});
  const items = ["report_crop","annotated","photo_headline"].map(id=>({id,reason:"선택한 공식 원본에 표시한다."}));
  await server.importFormatRecommendations(db(),stored,{scene:"공개 견본의 축 제목과 해당 결과를 나란히 읽는다.",items},"scene");
  await assert.rejects(approveRequest({...request,formatIds:["thumbnail_subject"],assetPaths:[]}));
  await assert.rejects(approveRequest({...request,assetPaths:[]}));
  await approveRequest(request);
  const approvedKey = stored.metadata.state.formatApproval.key;
  assert.ok(server.imageJobInstructions(stored,request).includes(baseAsset.path));
  assert.equal(stored.metadata.state.formatApproval.key,approvedKey);
});

test("introducing thumbnail_subject preserves the identity of pending recommendations from the earlier catalog", async () => {
  reset();
  const savedBrief = {...brief,mainMessage:"지금 하는 일을 살펴보세요"};
  await decision({action:"recommend-formats",brief:savedBrief,mode:"standalone",size:"square",count:1});
  const {state} = stored.metadata;
  const catalog = formats.LEGACY_IMAGE_FORMAT_IDS.map(id => {
    const {name,when,assetRequired,version} = formats.IMAGE_FORMATS[id];
    return {id,name,when,assetRequired,version};
  });
  const before = {brief:state.brief,mode:"standalone",count:1,size:"square",hasPhoto:true,catalog};
  const oldKey = crypto.createHash("sha256").update(JSON.stringify(["formats",before])).digest("hex");
  assert.equal(server.imageInputKey(stored,{phase:"formats"}),oldKey);
  assert.ok(server.imageJobInstructions(stored,{phase:"formats"}).includes('"id":"thumbnail_subject"'));
});

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

test("a delayed scene request does not cancel a newer project direction already in the queue", async () => {
  reset();
  const planning={phase:"formats"};
  const initialPlan={mode:"appeal",count:1,size:"portrait",appealFirst:true,conceptFirst:true,
    appeals:[{id:"one",meaning:"내 기준이 궁금하다"}],concepts:["내가 반복한 것","선택에서 드러난 것"],direction:{concept:"첫 방향",medium:"photo"}};
  stored.metadata.state.formatRecommendation=initialPlan;
  const savedDb=workerModules["@/lib/supabase/server"].createServiceSupabase, previous=workerRow;
  let changed=false;
  // Another employee tab changes the direction and enqueues it before the pending-job lookup returns.
  workerModules["@/lib/supabase/server"].createServiceSupabase=()=>{
    if (!changed) {
      changed=true;
      const latest=structuredClone(stored);
      latest.version++;
      latest.metadata.state.formatRecommendation.direction={concept:"나중에 확정한 방향",medium:"character"};
      latest.metadata.state.formatRecommendation.directionVersion=latest.version;
      stored=latest;
      workerRow={...previous,parent_id:projectId,status:"backlog",metadata:{...previous.metadata, imagePhase:"scene",imageRequest:planning,lease:undefined,
        inputKey:server.imageInputKey(stored,planning)}};
    }
    return {from:()=>({...jobDb().from(), update:()=>assert.fail("an earlier request tried to cancel the newer scene job")})};
  };
  try {
    const job=await worker.requestStaffJob(ownerActor(),{task:"image-creative",sourceId:projectId,request:planning});
    assert.equal(job.id,workerJobId);
    assert.equal(job.inputKey,server.imageInputKey(stored,planning));
    assert.equal(workerRow.status,"backlog");
  } finally {
    workerRow=previous;
    workerModules["@/lib/supabase/server"].createServiceSupabase=savedDb;
  }
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
  const original = stored.metadata.state.variants[0];
  // An old Mac would draw this text poster while silently ignoring its new background photo.
  stored.metadata.state.variants[0] = {...original,formatId:"typography"};
  assert.equal((await imageMacWork(local,poll)).idle,true);
  const queued = structuredClone(stored);
  assert.equal((await imageMacWork(local,{...poll,rendererVersion:2})).jobId,run.id);
  stored = structuredClone(queued);
  stored.metadata.state.variants[0] = {...original,formatId:"thumbnail_subject"};
  assert.equal((await imageMacWork(local,poll)).idle,true);
  assert.equal((await imageMacWork(local,{...poll,rendererVersion:2})).idle,true);
  assert.equal((await imageMacWork(local,{...poll,rendererVersion:3})).jobId,run.id);
  stored = queued;
  stored.metadata.state.variants[0] = original;
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

for (const [formatId, withDirection] of [["note",false],["thumbnail_subject",false],["thumbnail_subject",true]]) test(`staff request, claim and completion of five fresh appeals with ${formatId} (${withDirection ? "concept first" : "legacy"})`, async () => {
  reset();
  stored.metadata.assets = [];
  const rows = new Map([[projectId, stored]]);
  const files = new Map();
  const memDb = () => ({
    storage: { from: () => ({
      createSignedUploadUrl: async path => ({data:{signedUrl:path,token:"local-test"}}),
      download: async path => ({data:files.get(path)}),
    }) },
    from() {
      const filters = [];
      let writing, inserting;
      const value = (row, key) => key.startsWith("metadata->>") ? row.metadata[key.slice(11)] : row[key];
      const results = () => [...rows.values()].filter(row => filters.every(f => f(row)));
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq(k,v) { filters.push(row => value(row,k) === v); return q; },
        is(k,v) { return q.eq(k,v); },
        in(k,vs) { filters.push(row => vs.includes(value(row,k))); return q; },
        update(v) { writing=v; return q; }, insert(v) { inserting=v; return q; },
        async maybeSingle() {
          const row = inserting ? {archived_at:null,version:1,...inserting} : results()[0];
          if (!row) return {data:null,error:null};
          const next = writing ? {...row,...writing,version:row.version+1} : row;
          rows.set(next.id,next);
          return {data:structuredClone(next),error:null};
        },
        then(resolve) { return Promise.resolve(resolve({data:structuredClone(results()),error:null})); },
      };
      return q;
    },
  });
  const ownerUser = {...ownerActor(),supabase:memDb()};
  const ai = {type:"agent",id:other,ownerId:owner,name:"구독 AI",supabase:memDb()};
  const originalServer = modules["@/lib/supabase/server"].createServiceSupabase;
  const originalWorker = workerModules["@/lib/supabase/server"].createServiceSupabase;
  modules["@/lib/supabase/server"].createServiceSupabase = workerModules["@/lib/supabase/server"].createServiceSupabase = memDb;
  const source = readFileSync(new URL("../app/api/v1/content/image-creatives/[id]/route.ts", import.meta.url),"utf8");
  const exports = {};
  const requestModules = {zod, "@/lib/http":{ApiError,parseJson:req=>req.json(),apiErrorResponse:e=>Response.json({code:e.code},{status:e.status??400})},
    "@/lib/server/auth":{authenticateRequest:()=>ownerUser},"@/lib/server/image-creatives":server,"@/lib/server/youtube-ai-jobs":worker};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:n=>requestModules[n],Response});
  const patch = async input => {
    const r=await exports.PATCH(new Request("https://example.test",{method:"PATCH",body:JSON.stringify({version:rows.get(projectId).version,...input})}),{params:Promise.resolve({id:projectId})});
    const result=await r.json();
    assert.equal(r.status,200,JSON.stringify(result));
    return result;
  };
  const pick = { action:"recommend-formats", brief:{...brief,mainMessage:"자주 부탁받는 일을 떠올려 보세요"},mode:"appeal",count:5,size:"portrait" };
  const request = { mode:"appeal",count:5,size:"portrait",formatIds:[formatId],assetPaths:[] };
  const items = (withDirection ? [formatId,"photo_headline","annotated"] : [formatId,"question","typography"]).map(id=>({id,reason:"회의가 끝나자 수첩에 마지막 요청을 적는 순간을 보여준다"}));
  try {
    const pending = await patch(pick);
    assert.equal(pending.jobs[0].phase,"formats");
    assert.equal(pending.jobs[0].currentInput,true);
    const jobId = pending.jobs[0].id;
    assert.equal((await patch(pick)).jobs.length,1);
    const first = await worker.claimStaffJob(ai,jobId);
    assert.ok(first.instructions.includes(pick.brief.mainMessage));
    const product = {id:"sample",product:"메모 수첩",audience:"여러 업무를 맡은 직원",offer:"할 일 목록과 업무별 정리 칸",source:{id:other,version:1}};
    const previousProducts = modules["./image-ad-products"].readImageAdProducts;
    modules["./image-ad-products"].readImageAdProducts = async () => [product];
    let revision;
    try {
      revision = await patch({...pick,appealFirst:true,...(withDirection ? {conceptFirst:true} : {}),brief:{product:product.product,audience:product.audience,offer:product.offer,
        productSource:{productId:product.id,source:product.source},objective:"",funnel:"",facts:""}});
    } finally { modules["./image-ad-products"].readImageAdProducts = previousProducts; }
    assert.ok(!revision.state.brief.mainMessage && !revision.state.formatApproval);
    assert.deepEqual(revision.jobs.filter(job=>job.phase==="copy"),[]);
    const current = revision.jobs.find(row=>row.status==="backlog");
    assert.notEqual(current.id,jobId);
    assert.equal(revision.jobs.find(row=>row.id===jobId).currentInput,false);
    await assert.rejects(worker.completeStaffJob(ai,{jobId,lease:first.lease,model:"fixture",result:{items}}),e=>e.status===409);
    const formatsClaim = await worker.claimStaffJob(ai,current.id);
    assert.equal(formatsClaim.imagePhase,withDirection?"concepts":"appeals");
    assert.ok(formatsClaim.instructions.includes(product.audience) && formatsClaim.instructions.includes(product.offer));
    assert.doesNotMatch(formatsClaim.instructions,/자주 부탁받는/);
    const complete = result=>worker.completeStaffJob(ai,{jobId:current.id,lease:formatsClaim.lease,model:"fixture",result});
    const appeals = ["퇴근 전에 남은 일 확인","회의에서 받은 요청 기록","복귀할 때 하던 일 찾기","업무 우선순위를 비교","동료에게 넘길 일 모으기"].map((meaning,i)=>({meaning,id:"reason-"+i}));
    if(withDirection) {
      const concepts = ["무심코 돕는 습관을 다시 본다","메모에 남은 나의 선택을 본다"];
      await assert.rejects(complete({appeals,concepts,items}),e=>e.code==="IMAGE_CONCEPTS_INVALID");
      await complete({appeals,concepts});
      const direction = {concept:"막히면 가장 먼저 어디를 찾아보는가",medium:"photo"};
      const first = await patch({action:"plan-scene",direction});
      const firstJob=first.jobs.find(j=>j.status==="backlog" && j.currentInput);
      assert.equal((await worker.listStaffJobs(ai,true)).jobs.find(j=>j.jobId===firstJob.id)?.imagePhase,"scene");
      const firstClaim = await worker.claimStaffJob(ai,firstJob.id);
      const alternate = await patch({action:"plan-scene",direction:{...direction,medium:"character"}});
      const secondJob=alternate.jobs.find(j=>j.status==="backlog" && j.currentInput);
      assert.notEqual(secondJob.id,firstJob.id);
      const scene = "회의가 끝나자 캐릭터가 수첩을 열고 요청 한 줄을 동료에게 보여준다.";
      await assert.rejects(worker.completeStaffJob(ai,{jobId:firstJob.id,lease:firstClaim.lease,model:"fixture",result:{scene,items}}),e=>e.status===409);
      const secondClaim = await worker.claimStaffJob(ai,secondJob.id);
      assert.equal(secondClaim.imagePhase,"scene");
      assert.ok(secondClaim.instructions.includes(direction.concept));
      assert.ok(secondClaim.instructions.includes("character"));
      await worker.completeStaffJob(ai,{jobId:secondJob.id,lease:secondClaim.lease,model:"fixture",result:{scene,items}});
    } else {
      await assert.rejects(complete({items}),e=>e.code==="IMAGE_APPEALS_INVALID");
      await assert.rejects(complete({items,appeals:appeals.slice(1)}),e=>e.code==="IMAGE_APPEALS_INVALID");
      await assert.rejects(complete({items,appeals:[...appeals.slice(0,4),{...appeals[4],meaning:appeals[0].meaning.replaceAll(" ","")+"!"}]}),e=>e.code==="IMAGE_APPEALS_INVALID");
      await assert.rejects(complete({appeals,items:[items[0],items[1],{id:"unrenderable",reason:"추천"}]}),e=>e.code==="IMAGE_FORMAT_UNAVAILABLE");
      await assert.rejects(complete({appeals,items:["photo_headline","report_crop","object_spotlight"].map(id=>({id,reason:"사진으로 결과 표현"}))}),e=>e.code==="IMAGE_PHOTO_FREE_OPTION_REQUIRED");
      await complete({appeals,items});
    }
    assert.deepEqual(JSON.parse(JSON.stringify(rows.get(projectId).metadata.state.formatRecommendation.appeals)),appeals);
    assert.equal(rows.get(projectId).metadata.state.variants.length,0);
    await assert.rejects(worker.requestStaffJob(ownerUser,{task:"image-creative",sourceId:projectId,request}),e=>e.code==="IMAGE_FORMAT_APPROVAL_REQUIRED");
    const approved = await patch({action:"approve-and-generate",request});
    assert.equal(approved.state.formatRecommendation.items[0].id,formatId);
    const copyJob = approved.jobs.find(j=>j.phase==="copy");
    assert.equal((await patch({action:"approve-and-generate",request})).jobs.filter(j=>j.phase==="copy").length,1);
    const newPhoto = formatId === "thumbnail_subject";
    assert.equal(rows.get(copyJob.id).metadata.imagePhase,newPhoto ? undefined : "copy");
    const textQueue = await worker.listStaffJobs(ai,true);
    assert.equal(textQueue.jobs.some(row=>row.jobId===copyJob.id),!newPhoto);
    assert.ok((await worker.listStaffJobs(ai)).jobs.some(row=>row.jobId===copyJob.id));
    const claim = await worker.claimStaffJob(ai,copyJob.id);
    assert.match(claim.instructions,/정확히 5개/);
    assert.ok(appeals.every(({meaning})=>claim.instructions.includes(meaning)));
    const result = appeals.map(appeal=>({formatId,formatVersion:1,size:"portrait",
      appeal,copy:{headline:appeal.meaning,body:"수첩에 모아 두세요",cta:"수첩 보기"}}));
    const finish = variants=>worker.completeStaffJob(ai,{jobId:copyJob.id,lease:claim.lease,model:"fixture",result:{variants}});
    if (newPhoto) {
      if(withDirection) {
        assert.ok(claim.instructions.includes("회의가 끝나자 캐릭터가 수첩을 열고"));
        assert.match(claim.instructions,/캐릭터·일러스트/);
        assert.match(claim.instructions,/공통 원본 한 장/);
      } else {
        assert.ok(claim.instructions.includes(items[0].reason));
        assert.match(claim.instructions,/공통 사진은 딱 한 장/);
        assert.match(claim.instructions,/320px/);
      }
      await assert.rejects(finish(result),/이미지/);
      const key = {jobId:copyJob.id,lease:claim.lease};
      const pixels = Buffer.alloc(19*23*3,255);
      for (let y=4;y<18;y++) pixels.fill(35,(y*19+5)*3,(y*19+12)*3);
      const bytes = await sharp(pixels,{raw:{width:19,height:23,channels:3}}).png().toBuffer();
      const slot = await worker.imageAssetForJob(ai,{...key,action:"prepare",mimeType:"image/png",fileSize:bytes.length});
      files.set(slot.signedUrl,new Blob([bytes],{type:"image/png"}));
      const asset = await worker.imageAssetForJob(ai,{...key,action:"commit",path:slot.path,receipt:slot.receipt});
      assert.deepEqual([asset.w,asset.h],[19,23]);
      for (const row of result) row.asset = asset;
      const saved = rows.get(projectId);
      const registered = saved.metadata.assets.find(item=>item.path===asset.path);
      assert.equal(registered.upload.jobId,copyJob.id);
      assert.deepEqual([...registered.subjectBox],[5,4,12,18]);
      const retry = server.imageJobInstructions(saved,request,false,copyJob.id);
      assert.ok(retry.includes(asset.path));
      assert.match(retry,withDirection ? /이미 등록한 원본이 있으면 재사용/ : /부족한 수량만/);
      assert.ok(!server.imageJobInstructions(saved,request,false,other).includes(asset.path));
      await assert.rejects(server.importImageResults(memDb(),saved,request,{variants:result},"another job",other),e=>e.code==="IMAGE_ORIGINAL_REQUIRED");
      await assert.rejects(finish([...result.slice(0,4),{...result[4],asset:{...asset,w:asset.w+1}}]),/동일하게/);
    }
    await assert.rejects(finish([...result.slice(0,4),{...result[4],copy:{...result[4].copy,cta:"신청하기"}}]),/CTA/);
    await finish(result);
    const state=rows.get(projectId).metadata.state;
    assert.equal(state.variants.length,5);
    if (newPhoto) for (const item of state.variants) assert.deepEqual([...item.asset.subjectBox],[5,4,12,18]);
    assert.equal(state.batches[0].review.format.by,owner);
    assert.equal(state.batches[0].review.copy,undefined);
    assert.equal(state.selectedId,"");
  } finally {
    modules["@/lib/supabase/server"].createServiceSupabase=originalServer;
    workerModules["@/lib/supabase/server"].createServiceSupabase=originalWorker;
  }
});

test("a human records each ad result; a control or its reviewed design revision can win successive tests", async()=>{
  reset();
  stored.metadata.state.experiment=true;
  const run = () => structuredClone(stored.metadata.state);
  const first = {mode:"appeal",count:2,formatIds:["photo_headline"],size:"portrait",assetPaths:[baseAsset.path]};
  await approveRequest(first);
  const results = [candidate,{...candidate,appeal:{id:"b",meaning:"다른 이유"},copy:{...candidate.copy,headline:"다른 시작"}}];
  await server.importImageResults(db(),stored,first,{variants:results},"worker");
  const [a,b] = run().variants;
  const batch = run().batches[0];
  const report = (batchId,variantId,note="")=>decision({action:"record-winner",batchId,variantId,note});
  const copy = {mode:"copy",count:1,baseId:a.id,copyFields:["headline"]};
  await assert.rejects(report(batch.id,a.id),e=>e.code==="IMAGE_FINAL_REQUIRED");
  await reviewedFixture(a.id);
  await decision({action:"select",variantId:a.id});
  assert.equal(model.imageExperimentSummary(run()).status,"awaiting_result");
  await assert.rejects(approveRequest(copy),e=>e.code==="IMAGE_EXPERIMENT_ORDER");
  const cmd={action:"record-winner",version:stored.version,batchId:batch.id,variantId:a.id,note:"외부 결과에서 선택"};
  await assert.rejects(server.patchImageProject({...ownerActor(),type:"agent"},stored,cmd),e=>e.code==="IMAGE_HUMAN_REQUIRED");
  await server.patchImageProject(ownerActor(),stored,cmd);
  const v=stored.version;
  await server.patchImageProject(ownerActor(),stored,cmd);
  assert.equal(stored.version,v);
  await assert.rejects(server.patchImageProject(ownerActor(),stored,{...cmd,variantId:b.id}),e=>e.code==="IMAGE_VERSION_CONFLICT");
  await assert.rejects(approveRequest({...copy,baseId:b.id}),e=>e.code==="IMAGE_EXPERIMENT_ORDER");
  await approveRequest(copy);
  await report(batch.id,b.id);
  assert.equal(run().formatApproval,undefined);
  await assert.rejects(server.importImageResults(db(),stored,copy,{variants:[{copy:{headline:"한 가지"}}]},"worker"));
  await report(batch.id,a.id,"광고 결과를 확인함");
  await approveRequest(copy);
  await server.importImageResults(db(),stored,copy,{variants:[{copy:{headline:"다른 제목"}}]},"worker");
  const copyRound=run().batches.at(-1);
  const challenger=run().variants.at(-1);
  await reviewedFixture(challenger.id);
  await assert.rejects(report(batch.id,b.id),e=>e.code==="IMAGE_RESULT_LOCKED");
  await assert.rejects(report(copyRound.id,b.id),e=>e.code==="IMAGE_WINNER_INVALID");
  await report(copyRound.id,a.id,"기존 소재가 더 좋음");
  const req={mode:"image",count:1,baseId:a.id};
  await approveRequest(req);
  assert.equal(model.imageExperimentSummary(run()).stage,"image");
  assert.deepEqual(run().variants[0].asset,a.asset);
  assert.equal(run().batches[0].winner.variantId,a.id);
  assert.equal(run().batches[1].winner.variantId,a.id);

  // An edited winning image may have been the file that was actually used in the ad.
  const revised=crypto.randomUUID();
  await decision({action:"revise-design",id:revised,baseId:challenger.id,design:{font:"serif",card:"paper",placement:"feed-portrait"}});
  assert.deepEqual(model.imageExperimentCandidateIds(run(),copyRound).sort(),[a.id,challenger.id].sort());
  await decision({action:"approve-format",batchId:run().batches.at(-1).id});
  await reviewedFixture(revised);
  assert.ok(model.imageExperimentCandidateIds(run(),copyRound).includes(revised));
  await report(copyRound.id,revised,"실제로 집행한 수정본");
  assert.equal(run().formatApproval,undefined);
  await approveRequest({...req,baseId:revised});
  assert.equal(model.activeImageWinner(copyRound,run()),undefined); // the stale fixture had no declaration
  const winner=model.activeImageWinner(run().batches[1],run());
  assert.equal(winner.variantRunId,run().batches.at(-1).review.final.runId);
  await decision({action:"return-review",batchId:run().batches.at(-1).id,stage:"preview",reason:"다시 확인"});
  assert.equal(run().formatApproval,undefined);
  assert.equal(model.activeImageWinner(run().batches[1],run()),undefined);
  assert.equal(run().batches[1].winner.note,"실제로 집행한 수정본");
  assert.equal(model.activeImageWinner(run().batches[0],run()).variantId,a.id);
  assert.equal(model.imageExperimentSummary(run()).status,"awaiting_result");
  await report(copyRound.id,a.id,"기존 소재");
  const upload = {path:`image-creatives/${projectId}/${crypto.randomUUID()}.png`,w:10,h:12,sha256:baseAsset.sha256 ?? "a".repeat(64)};
  stored.metadata.assets.push(upload);
  const photoCommand = server.imagePatchSchema.parse({action:"approve-and-generate",version:stored.version,request:{...req,assetPaths:[upload.path]}});
  await assert.rejects(server.patchImageProject({...ownerActor(),type:"agent"},stored,photoCommand),e=>e.code==="IMAGE_HUMAN_REQUIRED");
  const unchanged = run();
  await assert.rejects(server.patchImageProject(ownerActor(),stored,photoCommand),e=>e.code==="IMAGE_DUPLICATE_FILE");
  assert.deepEqual(run(),unchanged);
  upload.sha256="d".repeat(64);
  const snapshot=structuredClone(stored);
  const duplicates=await Promise.all([
    server.patchImageProject(ownerActor(),snapshot,photoCommand),
    server.patchImageProject(ownerActor(),snapshot,photoCommand),
  ]);
  assert.equal(duplicates[0].version,duplicates[1].version);
  const imageBatch=run().batches.at(-1);
  const variant=run().variants.at(-1);
  assert.equal(variant.parentId,a.id);
  assert.equal(variant.asset.path,upload.path);
  assert.deepEqual(variant.copy,a.copy);
  assert.deepEqual(variant.appeal,a.appeal);
  assert.equal(run().formatApproval,undefined);
  assert.equal(imageBatch.review.format.by,owner);
  assert.equal(imageBatch.review.copy,undefined);
  assert.equal(server.canPreviewVariant(stored.metadata,variant.id),false);
  const savedVersion=stored.version;
  await server.patchImageProject(ownerActor(),stored,photoCommand);
  assert.equal(stored.version,savedVersion);
  await reviewedFixture(variant.id);
  await report(imageBatch.id,variant.id);
  assert.deepEqual({...model.imageExperimentSummary(run())},{stage:"image",status:"complete"});


});

test("the A/B list pages owned experiments including legacy rounds and returns only project card fields",async()=>{
  const {createClient}=createRequire(import.meta.url)("@supabase/supabase-js");
  const calls=[];
  const client=createClient("https://local-fixture.invalid","fixture",{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:async input=>{
      const url=new URL(String(input));
      calls.push(url.searchParams);
      const offset=Number(url.searchParams.get("offset") ?? 0);
      const list=Array.from({length:offset===0?200:1},(_,i)=>{
        const id=offset+i;
        return {id:String(id),title:"광고 "+id,version:1,updated_at:"2026-11-11",
          ab:id===0,plan_mode:null,pending_mode:null,rounds:id===0?[]:[{id:"r",mode:"copy",variantIds:["a"],review:{final:{runId:"png"},history:[]}}]};
      });
      return Response.json(list);
    }},
  });
  const projects=await server.listImageProjects({supabase:client,ownerId:owner},true);
  assert.equal(projects.length,201);
  assert.equal(calls[0].get("owner_id"),"eq."+owner);
  assert.equal(calls[0].get("metadata->>kind"),"eq."+storage.IMAGE_CREATIVE_KIND);
  assert.equal(calls[0].get("archived_at"),"is.null");
  assert.ok(calls[0].get("or").includes('metadata->state->batches.cs.[{"mode":"copy"}]'));
  assert.ok(!calls[0].get("select").includes("variants"));
  assert.deepEqual(calls.map(p=>p.get("offset")),["0","200"]);
  assert.equal(projects[0].experiment.status,"preparing");
  assert.deepEqual({...projects.at(-1).experiment},{stage:"copy",status:"awaiting_result"});
  assert.deepEqual(Object.keys(projects[0]).sort(),["experiment","id","title","updatedAt","version"]);
  assert.equal(model.imageExperimentSummary({...model.emptyImageCreative(),formatRecommendation:{mode:"standalone"}}),undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as zod from "zod";
import * as gptDraft from "../lib/youtube-process/gpt-draft.ts";
import { imageJobPending } from "../lib/image-creative/model.ts";

class ApiError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
const owner="11111111-1111-4111-8111-111111111111", project="22222222-2222-4222-8222-222222222222";
function load(path,modules,env={}) {
  const compiled={exports:{}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:n=>modules[n]??{},process:{env},Date,console,URL,Buffer,Request,Response});
  return compiled.exports;
}
function harness({configured=true,needsImage=false}={}) {
  const env=configured?{OPENAI_API_KEY:"test-not-a-key"}:{};
  const rows=new Map(), calls={models:[],saved:[],scheduled:[],credits:0};
  const source={id:project,owner_id:owner,title:"샘플 광고",metadata:{appliedJobs:{},state:{brief:{}}},version:1};
  const db=()=>({from(table){
    assert.notEqual(table,"os_documents","brief text cannot request service-role documents");
    const filters=[];let write,insert;
    const value=(row,k)=>k.startsWith("metadata->>")?row.metadata[k.slice(11)]:row[k];
    const found=()=>[...rows.values()].filter(row=>filters.every(fn=>fn(row)));
    const q={select:()=>q,order:()=>q,limit:()=>q,
      eq(k,v){filters.push(row=>value(row,k)===v);return q;},is(k,v){return q.eq(k,v);},
      in(k,vs){filters.push(row=>vs.includes(value(row,k)));return q;},
      update(v){write=v;return q;},insert(v){insert=v;return q;},
      async maybeSingle(){const row=insert?{version:1,archived_at:null,...insert}:found()[0];if(!row)return {data:null,error:null};
        const next=write?{...row,...write,version:row.version+1}:row;rows.set(next.id,next);return {data:structuredClone(next),error:null};},
      then(resolve){return Promise.resolve(resolve({data:structuredClone(found()),error:null}));}};return q;
  }});
  const image={
    imageRecord:async(_db,ownerId,id)=>{assert.equal(ownerId,owner);assert.equal(id,project);return structuredClone(source);},
    imageMeta:r=>r.metadata,imageInputKey:()=>"a".repeat(64),imageJobPhase:(_r,request,guided)=>"phase"in request?"formats":guided&&!needsImage?"copy":undefined,
    imageError:e=>e,imageJobRequestSchema:zod.z.any(),renderTarget:zod.z.enum(["local","macmini"]),
    imageJobInstructions:(_r,_req,textOnly,_id,executor)=>{assert.equal(textOnly,true);assert.equal(executor,"company-api");return `User brief includes doc_id: ${project}\nReturn result {"copies":[{"headline":"새 카피","body":"","cta":"확인"}]}`;},
    importImageResults:async(_db,_r,_req,result,_by,jobId,trace)=>{assert.equal(trace[0].version,2);calls.saved.push(result);source.metadata.appliedJobs[jobId]="batch-1";return {batchId:"batch-1"};},
  };
  const common={"./production-canon":{productJobFacts:async()=>({ref:{id:"99999999-9999-4999-8999-999999999999",title:"상품 사실 정본",version:2},text:"테스트 상품 사실"})},"@/lib/http":{ApiError},"@/lib/supabase/server":{createServiceSupabase:db}};
  const jobs=load("../lib/server/youtube-ai-jobs.ts",{...common,"node:crypto":crypto,zod,"./image-creatives":image,
    "@/lib/youtube-automation-gate":{canUseYoutubeStaffScript:()=>false},"@/lib/youtube-process/stages":{SLOTS:["A","B","C"]},
    "./youtube-process-card-job":{cardFormatsSchema:zod.z.array(zod.z.string())}},env);
  const runner=load("../lib/server/youtube-gpt-jobs.ts",{...common,"next/server":{after:fn=>calls.scheduled.push(fn)},
    "@/lib/youtube-process/gpt-draft":gptDraft,"./youtube-ai-jobs":jobs,
    "./content-model":{generateContentText:async input=>{calls.models.push(input);return JSON.stringify({copies:[{headline:"새 카피",body:"",cta:"확인"}]});}}},env);
  const api=load("../lib/server/image-api-jobs.ts",{...common,"./youtube-ai-jobs":jobs,"./youtube-gpt-jobs":runner,
    "./openai-credit":{creditTier:async()=>{calls.credits++;return "precise";}}},env);
  const actor={id:"personal-agent-id",ownerId:owner,name:"테스트",team:"",supabase:db()};
  const input={task:"image-creative",sourceId:project,request:{mode:"standalone",count:1,formatIds:["note"],size:"portrait"},guided:true};
  return {api,jobs,runner,rows,calls,actor,input,source};
}

test("company default queues, claims and saves copy with the existing GPT model even with the personal worker disabled",async()=>{
  const h=harness();
  const job=await h.api.requestImageApiJob(h.actor,h.input);
  assert.equal(job.executor,"gpt");assert.equal(job.tier,"precise");assert.equal(h.rows.get(job.id).owner_id,owner);
  assert.equal(h.calls.models.length,0,"the HTTP request only schedules work");
  await assert.rejects(h.jobs.claimStaffJob(h.actor,job.id),e=>e.code==="STAFF_AI_JOB_TAKEN");
  await h.calls.scheduled[0]();
  assert.equal(h.calls.models.length,1);assert.equal(h.calls.models[0].model,gptDraft.GPT_TIERS.precise.model);
  assert.equal(h.calls.saved[0].copies[0].headline,"새 카피");assert.equal(h.rows.get(job.id).status,"done");
  assert.equal(h.rows.get(job.id).metadata.model,gptDraft.GPT_TIERS.precise.model);
});

test("duplicate queued requests reuse the same record; simultaneous scheduled runners execute the provider once",async()=>{
  const h=harness();
  const first=await h.api.requestImageApiJob(h.actor,h.input), second=await h.api.requestImageApiJob(h.actor,h.input);
  assert.equal(first.id,second.id);assert.equal(h.rows.size,1);
  await Promise.all(h.calls.scheduled.map(fn=>fn()));
  assert.equal(h.calls.models.length,1);assert.equal(h.calls.saved.length,1);
});

test("missing company configuration does not queue, read credit or fall back to a personal worker",async()=>{
  const h=harness({configured:false});
  await assert.rejects(h.api.requestImageApiJob(h.actor,h.input),e=>e.code==="IMAGE_API_UNAVAILABLE");
  assert.equal(h.rows.size,0);assert.equal(h.calls.credits,0);assert.equal(h.calls.scheduled.length,0);
});

test("a request needing new image pixels stops before queue/provider and never invents image assets",async()=>{
  const h=harness({needsImage:true});
  await assert.rejects(h.api.requestImageApiJob(h.actor,h.input),e=>e.code==="IMAGE_API_IMAGE_REQUIRED");
  assert.equal(h.rows.size,0);assert.equal(h.calls.models.length,0);assert.equal(h.calls.scheduled.length,0);
});

test("a changed project blocks the queued result before a company provider call",async()=>{
  const h=harness();const job=await h.api.requestImageApiJob(h.actor,h.input);
  h.rows.get(job.id).metadata.inputKey="b".repeat(64);
  await h.calls.scheduled[0]();
  assert.equal(h.calls.models.length,0);assert.equal(h.rows.get(job.id).status,"blocked");
});

test("image project route sends generate and guided copy to the company helper",async()=>{
  const calls=[];const record={id:project,version:2};
  const route=load("../app/api/v1/content/image-creatives/[id]/route.ts",{
    zod,"@/lib/http":{ApiError,parseJson:r=>r.json(),apiErrorResponse:e=>Response.json({code:e.code},{status:e.status??500})},
    "@/lib/server/auth":{authenticateRequest:async()=>({ownerId:owner})},
    "@/lib/server/image-creatives":{imagePatchSchema:zod.z.any(),imageRecord:async()=>record,imageBundle:async r=>r,imageError:e=>e,
      patchImageProject:async()=>record,imageMeta:()=>({state:{formatApproval:{key:"approved"}}})},
    "@/lib/server/image-api-jobs":{requestImageApiJob:async(_a,input)=>calls.push(input)},
  });
  // The VM needs browser globals only for the route response.
  for(const action of ["generate","approve-and-generate"]){
    const result=await route.PATCH(new Request("https://example.test",{method:"PATCH",body:JSON.stringify({action,version:2,request:{mode:"standalone"}})}),{params:Promise.resolve({id:project})});
    assert.equal(result.status,200);
  }
  assert.equal(calls.length,2);assert.equal(calls[0].task,"image-creative");assert.equal(calls[1].guided,true);
});


test("an expired company lease can be retried explicitly while a live lease is left alone",async()=>{
  const h=harness(),first=await h.api.requestImageApiJob(h.actor,h.input);
  await h.jobs.claimStaffJob(h.actor,first.id,true);
  const live=await h.api.requestImageApiJob(h.actor,h.input);
  assert.equal(h.calls.scheduled.length,1,"a live worker is not scheduled again");
  assert.equal(imageJobPending(live),true);
  h.rows.get(first.id).metadata.lease.expiresAt="2000-01-01T00:00:00.000Z";
  const retry=await h.api.requestImageApiJob(h.actor,h.input);
  assert.equal(retry.id,first.id);assert.equal(retry.processing,false);
  assert.equal(imageJobPending(retry),false,"all image screens offer a manual retry instead of permanent waiting");
  assert.equal(h.calls.scheduled.length,2);
  await h.api.requestImageApiJob(h.actor,h.input);
  await Promise.all(h.calls.scheduled.slice(1).map(fn=>fn()));
  assert.equal(h.calls.models.length,1,"concurrent retry runners still use the existing CAS lease");
  assert.equal(h.rows.get(first.id).status,"done");
  assert.equal(imageJobPending({status:"backlog",processing:false}),true);
  assert.equal(imageJobPending({status:"active"}),true,"older server responses keep the existing pending behavior");
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as zod from "zod";
import { execFileSync,spawnSync } from "node:child_process";
class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
async function load(file,modules,extras={}){
  const compiled={exports:{}};
  runInNewContext(ts.transpileModule(await readFile(new URL("../"+file,import.meta.url),"utf8"),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module:compiled,exports:compiled.exports,Buffer,URL,AbortSignal,...extras,require:name=>{assert.ok(name in modules,name);return modules[name];}});
  return compiled.exports;
}
const contract=await load("lib/shortform-production.ts",{zod,"./http":{ApiError}});
const owner="00000000-0000-4000-8000-000000000001",itemId="00000000-0000-4000-8000-000000000002",assetId="00000000-0000-4000-8000-000000000003";
const code=value=>error=>error.code===value;
async function setup(diagrams=false){
  const h={signed:[],voiceCalls:0,objects:new Map(),rows:[
    {id:owner,is_active:true,table:"os_profiles"},
    {id:itemId,record_type:"content_publish",owner_id:owner,status:"draft",version:1,title:"Example",description:"Memo",brand:"",archived_at:null,
      metadata:{space:"personal",channel:"shorts",shortformBrief:{...contract.DEFAULT_SHORTFORM_BRIEF,mode:"direct",duration:15,audience:"Audience",goal:"Read"},
        cuts:[{start:"00:00",end:"00:15",text:"Caption",note:"Screen",voice:"Narration",asset:"Photo",assetId,missingAsset:false}]}},
    {id:assetId,record_type:"content_asset",owner_id:owner,status:"draft",version:1,archived_at:null,
      metadata:{space:"personal",storagePath:`automation/${owner}/asset/${assetId}.png`,license:{source:"own"}}},
  ]};
  const clone=value=>JSON.parse(JSON.stringify(value));
  h.service={
    from(table){
      let filters=[],op="read",payload,limit=1000;
      const value=(row,key)=>key.includes("->>")?row.metadata?.[key.split("->>")[1]]:row[key];
      const query={
        select(){return query;},eq(key,want){filters.push(row=>value(row,key)===want);return query;},
        is(key,want){return query.eq(key,want);},in(key,values){filters.push(row=>values.includes(value(row,key)));return query;},
        order(){return query;},limit(n){limit=n;return query;},insert(body){op="insert";payload=body;return query;},
        update(body){op="update";payload=body;return query;},
        async execute(single){
          let rows=h.rows.filter(row=>(row.table??"os_records")===table&&filters.every(fn=>fn(row))).slice(0,limit);
          if(op==="insert"){
            if(h.rows.some(row=>row.id===payload.id))return {data:null,error:{code:"23505"}};
            const row={...clone(payload),version:1,archived_at:null};h.rows.push(row);rows=[row];
          }else if(op==="update")for(const row of rows)Object.assign(row,clone(payload),{version:row.version+1});
          return {data:clone(single?(rows[0]??null):rows),error:null};
        },
        maybeSingle(){return query.execute(true);},then(resolve,reject){return query.execute(false).then(resolve,reject);},
      };return query;
    },
    storage:{from(bucket){return {
      async createSignedUrl(path){h.signed.push([bucket,path]);return {data:{signedUrl:"https://storage.example/"+path}};},
      async createSignedUploadUrl(path){h.uploadPath=path;return {data:{signedUrl:"https://storage.example/upload"}};},
      async list(folder){return {data:[...h.objects.keys()].filter(key=>key.startsWith(bucket+":"+folder+"/")).map(key=>({name:key.split("/").at(-1),metadata:{size:h.objects.get(key).size}}))};},
      async upload(path,bytes){h.objects.set(bucket+":"+path,new Blob([bytes]));return {error:null};},
      async download(path){return {data:h.objects.get(bucket+":"+path)??null,error:null};},
    };}},
  };
  h.actor={type:"user",ownerId:owner};
  h.api=await load("lib/server/shortform-render.ts",{
    "node:crypto":crypto,zod,"@/lib/http":{ApiError},"@/lib/shortform-production":contract,
    "@/lib/supabase/server":{createServiceSupabase:()=>h.service},
    "./auth":{safeSecretMatch:(a,b)=>a===b},
    "./content-automation-v07":{assertHumanOwner:actor=>{if(actor.type!=="user")throw new ApiError(403,"USER_SESSION_REQUIRED","");return actor.ownerId;},
      getPersonalRecord:async(actor,id)=>{const row=h.rows.find(row=>row.id===id&&row.owner_id===actor.ownerId);if(!row)throw new ApiError(404,"AUTOMATION_NOT_FOUND","");return clone(row);}},
    "./content-automation-validators":{validatePersonalAsset:(metadata,who)=>{if(!metadata.storagePath.startsWith("automation/"+who+"/asset/"))throw new ApiError(422,"ASSET_FILE_REQUIRED","");}},
    "./shortform-longform":{readShortformLongform:async()=>({durationSeconds:120,videoUrl:"https://storage.example/source"})},
    "./fish-audio":{fishVoiceSettings:()=>({}),synthesizeFishSegment:async()=>{h.voiceCalls++;return {bytes:Buffer.from("ID3sample")};}},
  },{process:{env:{YOUTUBE_SHORTFORM_DIAGRAMS_ENABLED:diagrams?"true":"false",YOUTUBE_MEDIA_WORKER_SECRET:"test-secret-".repeat(4),FISH_API_KEY:"test-only",FISH_VOICE_REFERENCE_ID:"test-reference"}}});
  h.item=()=>h.rows.find(row=>row.id===itemId);
  h.enqueue=(approved=true)=>h.api.enqueueShortformRender(h.actor,itemId,h.item().version,approved);
  return h;
}
test("voice cost requires consent; duplicate requests reuse one signed job and one lease",async()=>{
  const h=await setup();
  await assert.rejects(h.enqueue(false),code("SHORTFORM_VOICE_APPROVAL"));
  const first=await h.enqueue();assert.equal((await h.enqueue()).runId,first.runId);
  const claim=await h.api.claimShortformRender(h.service);assert.equal(claim.renderId,first.runId);
  assert.equal((await h.api.claimShortformRender(h.service)).idle,true);
  assert.equal(claim.mode,"direct");assert.equal(claim.scenes.length,1);
  const voice={renderId:claim.renderId,lease:claim.lease,index:0};
  await h.api.shortformVoice(voice,h.service);await h.api.shortformVoice(voice,h.service);
  assert.equal(h.voiceCalls,1);
  assert.ok(h.signed.every(([,path])=>path.includes(owner)));
});
test("other owners, unknown licenses, absent assets and inactive accounts cannot render",async()=>{
  for(const change of ["owner","license","asset","inactive"]){
    const h=await setup();
    if(change==="owner")h.rows.find(row=>row.id===assetId).owner_id="someone-else";
    if(change==="license")h.rows.find(row=>row.id===assetId).metadata.license.source="unknown";
    if(change==="asset")delete h.item().metadata.cuts[0].assetId;
    if(change==="inactive"){await h.enqueue();h.rows[0].is_active=false;assert.equal((await h.api.claimShortformRender(h.service)).idle,true);}
    else await assert.rejects(h.enqueue());
    assert.equal(h.voiceCalls,0);
  }
});
test("forged job input and missing voice approval signatures fail before signing media",async()=>{
  const h=await setup();const {runId}=await h.enqueue();
  const row=h.rows.find(row=>row.id===runId);row.metadata.plan.cuts[0].assetPath="other/secret.png";
  await assert.rejects(h.api.shortformVoice({renderId:runId,lease:"forged",index:0},h.service),code("SHORTFORM_RUN_INVALID"));
  assert.equal((await h.api.claimShortformRender(h.service)).idle,true);
  assert.equal(h.signed.length,0);
});
test("changed inputs cannot receive a stale completed video or buy stale narration",async()=>{
  const h=await setup();await h.enqueue();const claim=await h.api.claimShortformRender(h.service);
  h.item().metadata.cuts[0].voice="Changed narration";
  await assert.rejects(h.api.shortformVoice({renderId:claim.renderId,lease:claim.lease,index:0},h.service),code("SHORTFORM_INPUT_CHANGED"));
  await assert.rejects(h.api.completeShortformRender({renderId:claim.renderId,lease:claim.lease,bytes:10,sha256:"x",duration:15},h.service),code("SHORTFORM_INPUT_CHANGED"));
  assert.equal(h.item().metadata.mp4Path,undefined);assert.equal(h.voiceCalls,0);
});
test("verified completion attaches the MP4 to the same draft without approving publication; retry completion is idempotent",async()=>{
  const h=await setup();await h.enqueue();const claim=await h.api.claimShortformRender(h.service);
  const bytes=Buffer.from([0,0,0,16,...Buffer.from("ftypisom"),0,0,0,0]);
  h.objects.set("os-content-media:"+h.uploadPath,new Blob([bytes]));
  const done={renderId:claim.renderId,lease:claim.lease,bytes:bytes.length,sha256:crypto.createHash("sha256").update(bytes).digest("hex"),duration:15};
  await assert.rejects(h.api.completeShortformRender({...done,sha256:"0".repeat(64)},h.service),code("SHORTFORM_OUTPUT_INVALID"));
  await h.api.completeShortformRender(done,h.service);
  const version=h.item().version;await h.api.completeShortformRender(done,h.service);
  assert.equal(h.item().version,version);
  assert.equal(h.item().status,"draft");assert.equal(h.item().metadata.mp4Path,h.uploadPath);
  assert.equal(h.item().metadata.needsRecheck,true);
});
test("expired leases cannot attach output, and failures require an explicit retry",async()=>{
  const h=await setup();const {runId}=await h.enqueue();const claim=await h.api.claimShortformRender(h.service);
  await h.api.failShortformRender({renderId:runId,lease:claim.lease,code:"SHORTFORM_VOICE_TOO_LONG"},h.service);
  assert.equal((await h.api.claimShortformRender(h.service)).idle,true);
  await h.enqueue();const retry=await h.api.claimShortformRender(h.service);
  assert.notEqual(retry.lease,claim.lease);
  await assert.rejects(h.api.shortformVoice({renderId:runId,lease:claim.lease,index:0},h.service),code("SHORTFORM_LEASE_LOST"));
});
test("simultaneous voice requests cannot issue duplicate paid calls",async()=>{
  const h=await setup();await h.enqueue();const claim=await h.api.claimShortformRender(h.service);
  const input={renderId:claim.renderId,lease:claim.lease,index:0};
  const outcomes=await Promise.allSettled([h.api.shortformVoice(input,h.service),h.api.shortformVoice(input,h.service)]);
  assert.equal(outcomes.filter(result=>result.status==="fulfilled").length,1);
  assert.equal(h.voiceCalls,1);
});
test("copied jobs and fabricated completion cannot reuse a server approval signature",async()=>{
  const h=await setup();const {runId}=await h.enqueue(),row=h.rows.find(row=>row.id===runId);
  assert.throws(()=>h.api.verifyShortformRun({...row,id:assetId}),code("SHORTFORM_RUN_INVALID"));
  assert.throws(()=>h.api.verifyShortformRun({...row,status:"done"}),code("SHORTFORM_RUN_INVALID"));
});
test("selected longform clips become separate existing-flow cards without copying topics; repeat import preserves edits",async()=>{
  const h=await setup(),sourceId="00000000-0000-4000-8000-000000000010";
  const clipIds=["00000000-0000-4000-8000-000000000011","00000000-0000-4000-8000-000000000012"];
  h.rows.push({id:sourceId,record_type:"content_topic",owner_id:owner,title:"Source",brand:"",archived_at:null});
  for(const [index,id] of clipIds.entries())h.rows.push({id,record_type:"content_short",parent_id:sourceId,title:"Clip "+index,
    archived_at:null,metadata:{start:index*30,end:index*30+15,hook:""}});
  const sourceKey="a".repeat(64);
  const route=await load("app/api/v1/content/shorts/cards/route.ts",{
    "node:crypto":crypto,"next/server":{NextResponse:{json:body=>({status:200,body})}},zod,
    "@/lib/http":{ApiError,parseJson:request=>request.json(),apiErrorResponse:error=>({status:error.status,body:{code:error.code}})},
    "@/lib/server/auth":{authenticateRequest:async()=>({...h.actor,supabase:h.service})},
    "@/lib/server/content-automation-v07":{assertHumanOwner:actor=>actor.ownerId,assertSameOrigin:()=>{}},
    "@/lib/supabase/server":{createServiceSupabase:()=>h.service},
    "@/lib/server/shortform-longform":{readShortformLongform:async(_actor,_id,key)=>{
      if(key!==sourceKey)throw new ApiError(409,"SHORTFORM_LONGFORM_CHANGED","");return {durationSeconds:120};
    }},
    "@/lib/shortform-production":contract,
  });
  const send=(extra={})=>route.POST({json:async()=>({sourceId,sourceKey,clipIds,...extra})});
  const first=await send();assert.equal(first.status,200);assert.equal(first.body.items.length,2);
  assert.notEqual(first.body.items[0].id,first.body.items[1].id);
  const card=h.rows.find(row=>row.id===first.body.items[0].id);card.title="Edited card";
  assert.equal(card.parent_id,null);assert.equal(card.metadata.originalSourceId,sourceId);
  const again=await send();assert.ok(again.body.items.every(item=>item.reused));
  assert.equal(card.title,"Edited card");
  assert.equal(h.rows.filter(row=>row.record_type==="content_topic").length,1);
  assert.equal((await send({sourceKey:"b".repeat(64)})).status,409);
  assert.equal((await send({clipIds:[assetId]})).status,404);
});
const localRenderReady=process.platform==="darwin"&&spawnSync("ffmpeg",["-version"]).status===0
  &&spawnSync(process.env.MINDMAP_PYTHON||"python3",["-c","import PIL"]).status===0;
test("local queue → real worker MP4 → verified upload → same draft, with mocked private services and no paid calls",
  {skip:!localRenderReady,timeout:120_000},async()=>{
    const h=await setup();h.item().metadata.cuts[0].voice="";
    await h.enqueue(false);
    const png=execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=640x480","-frames:v","1","-f","image2pipe","-vcodec","png","pipe:1"]);
    const {renderPcSignalSchema}=await load("lib/server/youtube-render-pc.ts",{
      zod,"@/lib/http":{ApiError},"@/lib/supabase/server":{},
      "./youtube-render-run":{},"./youtube-voice-run":{},
    });
    const signals=[];
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(url,options={})=>{
      if(String(url).endsWith("/media")){
        const input=JSON.parse(options.body);let result;
        if(input.action==="heartbeat"){signals.push(input);result={ok:true};}
        else if(input.action==="shorts_claim"){assert.equal(input.layoutVersion,4);result=await h.api.claimShortformRender(h.service,input.layoutVersion);}
        else if(input.action==="shorts_complete")result=await h.api.completeShortformRender(input,h.service);
        else if(input.action==="shorts_fail")result=await h.api.failShortformRender(input,h.service);
        else throw new Error("Unexpected paid/network operation "+input.action);
        return new Response(JSON.stringify(result),{status:200,headers:{"content-type":"application/json"}});
      }
      if(String(url)==="https://storage.example/upload"){
        h.objects.set("os-content-media:"+h.uploadPath,new Blob([options.body]));
        return new Response("",{status:200});
      }
      if(String(url).includes("/asset/"))return new Response(png,{headers:{"content-length":String(png.length)}});
      throw new Error("Unexpected external URL");
    };
    try{
      const worker=await import("../tools/youtube-media-worker.mjs");
      assert.equal(await worker.processShortform(),true);
      const run=h.rows.find(row=>row.metadata?.kind==="shortform_render_v1");
      assert.equal(run.status,"done",run.metadata.error);
      assert.equal(h.item().metadata.mp4Path,run.metadata.outputPath);
      assert.equal(h.item().status,"draft");assert.equal(h.voiceCalls,0);
      assert.ok(signals.length>0);
      for(const signal of signals)assert.equal(renderPcSignalSchema.safeParse(signal).success,true,"Worker heartbeat must satisfy the live API schema");
      assert.ok(h.objects.get("os-content-media:"+run.metadata.outputPath).size>1000);
    }finally{globalThis.fetch=originalFetch;}
  });

// 광고 정사각형 · 4:5 (owner requests 2026-10-25): 1:1 and 4:5 renders of the same ad sit beside the 9:16 one, only a worker that draws
// the size takes it (1:1 from layoutVersion 3, 4:5 from 4), the card keeps its 9:16 video, and the narration is paid once for all.
test("each ad size is its own job beside the vertical one; old workers skip what they cannot draw and the narration is paid once",async()=>{
  const h=await setup();
  const item=()=>h.item();
  await assert.rejects(h.api.enqueueShortformRenderFor(owner,item(),item().version,true,"1:1"),code("SHORTFORM_ASPECT_AD_ONLY"));
  item().metadata.shortformBrief={...item().metadata.shortformBrief,purpose:"ad",product:"진단",landingUrl:"https://example.com",evidence:"후기",appeal:"이유"};
  item().version+=1;
  const vertical=await h.api.enqueueShortformRenderFor(owner,item(),item().version,true);
  const square=await h.api.enqueueShortformRenderFor(owner,item(),item().version,true,"1:1");
  const portrait=await h.api.enqueueShortformRenderFor(owner,item(),item().version,true,"4:5");
  assert.equal(new Set([vertical.runId,square.runId,portrait.runId]).size,3);
  // A version 2 worker gets the vertical job and never an ad size; version 3 gets the square and never the 4:5.
  const first=await h.api.claimShortformRender(h.service,2);
  assert.equal(first.renderId,vertical.runId);assert.equal(first.aspect,"9:16");
  assert.equal((await h.api.claimShortformRender(h.service,2)).idle,true);
  const second=await h.api.claimShortformRender(h.service,3);
  assert.equal(second.renderId,square.runId);assert.equal(second.aspect,"1:1");
  assert.equal((await h.api.claimShortformRender(h.service,3)).idle,true);
  const third=await h.api.claimShortformRender(h.service,4);
  assert.equal(third.renderId,portrait.runId);assert.equal(third.aspect,"4:5");
  // All three renders ask for the same narration; Fish is called once.
  for(const job of [first,second,third])await h.api.shortformVoice({renderId:job.renderId,lease:job.lease,index:0},h.service);
  assert.equal(h.voiceCalls,1);
  // Completing the square one leaves the card's 9:16 video alone.
  const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypisom"),Buffer.alloc(32)]);
  const path=h.rows.find(row=>row.id===second.renderId).metadata.outputPath;
  h.objects.set("os-content-media:"+path,new Blob([bytes]));
  await h.api.completeShortformRender({renderId:second.renderId,lease:second.lease,bytes:bytes.length,sha256:crypto.createHash("sha256").update(bytes).digest("hex"),duration:15},h.service);
  assert.equal(item().metadata.mp4Path,undefined);
});

const timelineDiagram={type:"lib_timeline",scene:{t0:0,items:[{text:"이전",t:.2},{text:"변화",t:1},{text:"지금",t:2}]}};
test("diagram plans are signed, sent only to capable workers, and need no image or paid voice",async()=>{
 const h=await setup(true),cut=h.item().metadata.cuts[0];delete cut.assetId;cut.diagram=timelineDiagram;cut.missingAsset=false;cut.voice="";
 await h.enqueue(false);
 assert.equal((await h.api.claimShortformRender(h.service,4)).idle,true);
 assert.equal((await h.api.claimShortformRender(h.service,4,["lib_iceberg"])).idle,true);
 const job=await h.api.claimShortformRender(h.service,4,["lib_timeline"]);
 assert.equal(job.scenes[0].diagram.type,"lib_timeline");assert.equal(job.scenes[0].imageUrl,undefined);assert.equal(h.voiceCalls,0);
 assert.equal(h.signed.length,0);
});
test("diagram opt-in, timing and markup guards reject invalid jobs before queueing",async()=>{
 const off=await setup();delete off.item().metadata.cuts[0].assetId;off.item().metadata.cuts[0].diagram=timelineDiagram;
 await assert.rejects(off.enqueue(),code("SHORTFORM_DIAGRAM_DISABLED"));
 const h=await setup(true);delete h.item().metadata.cuts[0].assetId;h.item().metadata.cuts[0].diagram={...timelineDiagram,scene:{...timelineDiagram.scene,items:[{text:"이전",t:30},{text:"변화",t:1},{text:"지금",t:2}]}};
 await assert.rejects(h.enqueue(),code("SHORTFORM_DIAGRAM_TIMING"));
 assert.equal(contract.shortformDiagramSchema.safeParse({...timelineDiagram,scene:{...timelineDiagram.scene,items:[{text:"<svg>",t:0},{text:"나",t:1},{text:"다",t:2}]}}).success,false);
});

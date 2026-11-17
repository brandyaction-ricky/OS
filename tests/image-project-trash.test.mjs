import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as zod from "zod";
import * as trashModel from "../lib/image-creative/project-trash.ts";
import * as storage from "../lib/image-creative/storage.ts";

class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const owner="owner", id="project";
const actor={type:"user",id:owner,ownerId:owner};
const fresh=()=>({id,owner_id:owner,record_type:"content_package",version:4,title:"보존할 광고",archived_at:null,
  metadata:{kind:storage.IMAGE_CREATIVE_KIND,state:{variants:[{id:"artwork",copy:{headline:"승인 문구"}}],batches:[{review:{copy:{by:owner},history:["original"]}}]},
    assets:[{path:"owned.png",sha256:"original"}],appliedJobs:{done:"receipt"},
    renders:[{id:"old",status:"active",leaseHash:"lease",expires:123},{id:"done",status:"done",files:["saved.png"]}],
    promptEditRun:{id:"edit",status:"active",expiresAt:123}}});
const job=(suffix,extra={})=>({id:"job-"+suffix,version:1,owner_id:owner,parent_id:id,record_type:"ai_job",status:"active",archived_at:null,
  metadata:{kind:"youtube_staff_ai_v1",task:"image-creative"},...extra});
function load(rows,{failCleanup=false,conflict=false,afterArchive}={}) {
  let writes=0;
  const db={from(){let filters=[],patch;const field=(r,k)=>k.startsWith("metadata->>")?r.metadata?.[k.slice(11)]:r[k];
    const execute=single=>{
      if(patch?.status && failCleanup)return {data:null,error:{message:"temporary"}};
      const found=rows.filter(row=>filters.every(fn=>fn(row)));
      if(patch && conflict && "archived_at" in patch)return {data:null,error:null};
      if(patch)found.forEach(row=>{Object.assign(row,structuredClone(patch));row.version++;writes++;});
      if(patch?.archived_at && afterArchive)afterArchive(rows);
      return {data:structuredClone(single?found[0]??null:found),error:null};
    };
    const q={select(){return q;},order(){return q;},limit(){return q;},
      eq(k,v){filters.push(r=>field(r,k)===v);return q;},is(k,v){filters.push(r=>v===null?field(r,k)==null:field(r,k)===v);return q;},
      not(k,_op,v){filters.push(r=>v===null?field(r,k)!=null:field(r,k)!==v);return q;},in(k,vs){filters.push(r=>vs.includes(field(r,k)));return q;},
      update(v){patch=v;return q;},async maybeSingle(){return execute(true);},then(resolve,reject){return Promise.resolve(execute(false)).then(resolve,reject);}};return q;}};
  const compiled={exports:{}};
  const deps={zod,"node:crypto":crypto,"@/lib/http":{ApiError},"@/lib/image-creative/storage":storage,
    "@/lib/image-creative/project-trash":trashModel,"@/lib/supabase/server":{createServiceSupabase:()=>db},"./image-creatives":{imageMeta:r=>r.metadata}};
  const source=readFileSync(new URL("../lib/server/image-project-trash.ts",import.meta.url),"utf8");
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:name=>deps[name],Date});
  return {...compiled.exports,writes:()=>writes};
}
test("image trash is owner-only, versioned and reversible; there is no purge command",async()=>{
  const rows=[fresh()], api=load(rows);
  assert.equal(api.imageTrashActionSchema.safeParse({action:"purge",version:4}).success,false);
  assert.equal(api.imageTrashActionSchema.safeParse({action:"restore"}).success,false);
  await assert.rejects(api.actOnImageTrash({...actor,type:"agent"},id,{action:"trash",version:4}),e=>e.status===403);
  await assert.rejects(api.actOnImageTrash({...actor,ownerId:"other"},id,{action:"trash",version:4}),e=>e.status===404);
  await assert.rejects(api.actOnImageTrash(actor,id,{action:"trash",version:3}),e=>e.status===409);
  assert.equal(api.writes(),0);
});
test("trash preserves artwork and approvals, invalidates active work and restores without restarting it",async()=>{
  const original=fresh(), other=fresh();other.id="other";other.owner_id="someone";
  const rows=[structuredClone(original),other,job("active"),job("done",{status:"done"}),job("other-project",{parent_id:"other"}),
    job("other-owner",{owner_id:"someone"}),job("unrelated",{metadata:{kind:"youtube_staff_ai_v1",task:"script"}})];
  const api=load(rows);
  const result=await api.actOnImageTrash(actor,id,{action:"trash",version:4});
  assert.equal(result.project.version,5);assert.equal(result.jobsCancelled,true);
  assert.ok(rows[0].archived_at);assert.ok(rows[0].metadata.lifecycleRevision);
  for(const key of ["state","assets","appliedJobs"])assert.deepEqual(rows[0].metadata[key],original.metadata[key]);
  assert.equal(rows[0].metadata.renders[0].status,"failed");assert.equal(rows[0].metadata.renders[0].leaseHash,undefined);
  assert.deepEqual(rows[0].metadata.renders[1],original.metadata.renders[1]);
  assert.equal(rows[0].metadata.promptEditRun.status,"failed");
  assert.equal(rows[2].status,"cancelled");assert.deepEqual(rows.slice(3).map(r=>r.status),["done","active","active","active"]);
  assert.deepEqual(rows[1],other);
  assert.equal((await api.listImageTrash(actor)).length,1);
  assert.equal((await api.listImageTrash({...actor,ownerId:"someone"})).length,0);
  const revision=rows[0].metadata.lifecycleRevision;
  await assert.rejects(api.actOnImageTrash(actor,id,{action:"restore",version:4}),e=>e.status===409);
  await api.actOnImageTrash(actor,id,{action:"restore",version:5});
  assert.equal(rows[0].archived_at,null);assert.equal(rows[0].metadata.lifecycleRevision,revision);
  assert.deepEqual(rows[0].metadata.state,original.metadata.state);assert.equal(rows[2].status,"cancelled");
  assert.equal((await api.listImageTrash(actor)).length,0);
});
test("a losing archive does not overwrite concurrent project data; cleanup failure does not remove the revision gate",async()=>{
  const original=fresh(), rows=[structuredClone(original)];
  await assert.rejects(load(rows,{conflict:true}).actOnImageTrash(actor,id,{action:"trash",version:4}),e=>e.status===409);
  assert.deepEqual(rows,[original]);
  const partial=[fresh(),job("cleanup")];
  const result=await load(partial,{failCleanup:true}).actOnImageTrash(actor,id,{action:"trash",version:4});
  assert.equal(result.jobsCancelled,false);assert.ok(partial[0].metadata.lifecycleRevision);assert.ok(partial[0].archived_at);
});
test("browser trash survives serialization and preserves other projects, exact assets, copy and approval history",()=>{
  const saved={project:{id,title:"테스트",version:4},state:fresh().metadata.state,assets:[{url:"data:image/png;base64,owned",path:"owned.png"}],
    jobs:[{status:"active"}],renders:[{status:"queued"},{status:"done"}]};
  const other={...structuredClone(saved),project:{...saved.project,id:"other"}};
  const trashed=trashModel.changeDemoImageTrash([saved,other],id,4,"trash","2026-11-16T01:00:00Z");
  assert.equal(saved.project.archivedAt,undefined);assert.equal(trashed[1],other);
  assert.deepEqual(trashed[0].assets,saved.assets);assert.deepEqual(trashed[0].state,saved.state);
  assert.equal(trashed[0].renders[0].status,"failed");assert.equal(trashed[0].renders[1].status,"done");
  assert.throws(()=>trashModel.changeDemoImageTrash(trashed,id,4,"restore"),/바뀌/);
  const restored=trashModel.changeDemoImageTrash(JSON.parse(JSON.stringify(trashed)),id,5,"restore");
  assert.equal(restored[0].project.archivedAt,null);assert.equal(restored[0].project.version,6);
  assert.deepEqual(restored[0].state,saved.state);assert.equal(restored[0].jobs[0].status,"cancelled");
});

test("cleanup cannot cancel a restored project's new jobs or a changed version of an older job",async()=>{
  const rows=[fresh(),job("old"),job("changed")];
  const api=load(rows,{afterArchive:current=>{
    current[0].archived_at=null;current[0].version++;
    current[2].version++;
    current.push(job("new-after-restore",{status:"backlog"}));
  }});
  await api.actOnImageTrash(actor,id,{action:"trash",version:4});
  assert.equal(rows[0].archived_at,null);
  assert.equal(rows[1].status,"cancelled");
  assert.equal(rows[2].status,"active");
  assert.equal(rows[3].status,"backlog");
});

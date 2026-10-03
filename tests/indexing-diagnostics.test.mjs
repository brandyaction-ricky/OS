import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import * as diagnostics from "../lib/indexing-diagnostics.ts";
import {progressiveSearch} from "../lib/progressive-search.ts";
class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const source=await readFile(new URL("../lib/server/indexing.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const doc=(id="visible",hash="current",status="canonical")=>({id,content_hash:hash,status,content_md:"fixture",current_version:2});
const job=(id,hash,status="failed",document_id="visible")=>({id,document_id,content_hash:hash,status,last_error:"알 수 없는 인덱싱 오류",created_at:`2026-10-${String(id).padStart(2,"0")}`});
function setup(options={}){
 const documents=options.documents??[doc()],jobs=options.jobs??[job(1,"old"),job(2,"current","pending")],chunks=[{chunk_text:"preserved"}];const events=[];
 const db={from(table){const filters=[];let update,projection;let single=false,limit=Infinity;const builder={select(fields){projection=fields;return builder;},lt(key,value){filters.push(row=>row[key]<value);return builder;},update(value){update=value;return builder;},eq(key,value){filters.push(row=>row[key]===value);return builder;},neq(key,value){filters.push(row=>row[key]!==value);return builder;},in(key,values){filters.push(row=>values.includes(row[key]));return builder;},order(){return builder;},limit(value){limit=value;return builder;},single(){single=true;return builder;},maybeSingle(){single=true;return builder;},then(resolve,reject){return Promise.resolve().then(()=>{if(options.queueReadError&&table==="os_embedding_jobs"&&projection==="document_id")return {data:null,error:{code:"XX000",message:"private SQL content"}};const rows=(table==="os_documents"?documents:jobs).filter(row=>filters.every(filter=>filter(row))).slice(0,limit);if(update){events.push({table,update,ids:rows.map(row=>row.id)});rows.forEach(row=>Object.assign(row,update));}return {data:single?rows[0]??null:rows,error:null};}).then(resolve,reject);}};return builder;},async rpc(name,args){events.push({rpc:name,args});if(options.finishError)return {error:options.finishError};const current=jobs.find(row=>row.id===args.p_job_id);current.status="done";current.last_error=options.stale?"stale":null;if(!options.stale)chunks.splice(0,chunks.length,...args.p_chunks);return {error:null};}};
 const modules={"@/lib/http":{ApiError},"@/lib/indexing-diagnostics":diagnostics,"./indexing-diagnostics":{getIndexCoverage:async()=>diagnostics.summarizeIndexCoverage(documents,jobs),readIndexSnapshot:async()=>({documents,jobs,truncated:!!options.truncated})},"@/lib/chunking":{chunkMarkdown:text=>text?[{index:0,text,heading:""}]:[]},"@/lib/config":{hasServerSupabaseConfig:()=>true},"@/lib/supabase/server":{createServiceSupabase:()=>db},"./embeddings":{createEmbeddings:async()=>{if(options.embeddingError)throw options.embeddingError;return [Array(1536).fill(0)];},toPgVector:()=>"[0]"}};
 const mod={exports:{}};runInNewContext(`(function(require,module,exports){${code}\n})`,{Date,process:{env:{OPENAI_API_KEY:"fixture"}},console:{error(){}}})(name=>{assert.ok(name in modules,name);return modules[name];},mod,mod.exports);
 return {...mod.exports,documents,jobs,chunks,events};
}
test("current coverage uses one current version per active document and separates historical failures",()=>{
 const result=diagnostics.summarizeIndexCoverage([doc(),doc("other"),doc("untracked"),doc("archived","current","archived")],[job(1,"old"),job(2,"current","failed"),job(3,"current","done"),job(4,"current","failed","other")]);
 assert.equal(result.total,3);assert.equal(result.done,1);assert.equal(result.failed,1);assert.equal(result.untracked,1);assert.equal(result.historicalFailed,2);assert.equal(result.failureReasons[0].code,"unknown");assert.equal(JSON.stringify(result).includes("visible"),false);
});
test("plain database errors and provider errors become fixed categories without payloads",()=>{
 for(const [error,category]of [[{code:"23505",message:"private SQL text"},"storage"],[{code:"EMBEDDING_RATE_LIMIT",message:"secret"},"rate_limit"],[{code:"EMBEDDING_QUOTA"},"quota"],[{code:"EMBEDDING_AUTH"},"authentication"],[{name:"AbortError"},"timeout"],["새 문서 버전으로 대체된 작업입니다.","superseded"]]){assert.equal(diagnostics.classifyIndexingFailure(error),category);assert.ok(!diagnostics.safeIndexingFailure(error).includes("secret"));}
});
test("only the current active failed job is retried and running copies prevent duplicate enqueue",async()=>{
 const state=setup({documents:[doc(),doc("archived","current","archived")],jobs:[job(1,"old"),job(2,"current"),job(3,"current","failed","archived")]});assert.equal(await state.retryFailedEmbeddingJobs(20),1);assert.equal(state.jobs[0].status,"failed");assert.equal(state.jobs[1].status,"pending");assert.equal(state.jobs[2].status,"failed");assert.equal(await state.retryFailedEmbeddingJobs(20),0);
 await assert.rejects(setup({truncated:true}).retryFailedEmbeddingJobs(),{code:"INDEX_RETRY_SCOPE_INCOMPLETE"});
});
test("atomic finish preserves existing chunks on storage failure and records a safe reason",async()=>{
 const state=setup({finishError:{code:"23505",message:"private source SQL"}});await assert.rejects(state.indexDocument("visible"),{code:"INDEXING_FAILED"});assert.equal(state.chunks[0].chunk_text,"preserved");assert.equal(state.jobs[1].last_error,"[storage] 검색 자료 저장");assert.ok(state.events.some(event=>event.rpc==="os_finish_embedding_job"));assert.ok(!JSON.stringify(state.events).includes("private source SQL"));
});
test("embedding timeout never replaces chunks; superseded completion is not counted ready",async()=>{
 const timeout=setup({embeddingError:new ApiError(504,"EMBEDDING_TIMEOUT","private request")});await assert.rejects(timeout.indexDocument("visible"));assert.equal(timeout.chunks[0].chunk_text,"preserved");assert.equal(timeout.jobs[1].last_error,"[timeout] 응답 시간 초과");assert.ok(!timeout.events.some(event=>event.rpc));
 const stale=setup({stale:true});assert.equal(await stale.indexDocument("visible"),"queued");assert.equal(stale.chunks[0].chunk_text,"preserved");
 const success=setup();assert.equal(await success.indexDocument("visible"),"ready");assert.equal(success.chunks[0].chunk_text,"fixture");
});
test("archived and empty documents do not stay in a permanently pending loop",async()=>{
 const archived=setup({documents:[doc("visible","current","archived")]});assert.equal(await archived.indexDocument("visible"),"queued");assert.ok(archived.jobs.every(row=>row.status!=="pending"));
 const empty=setup({documents:[{...doc(),content_md:""}]});assert.equal(await empty.indexDocument("visible"),"ready");assert.equal(empty.chunks.length,0);
});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test("progressive search displays early results and preserves them if enrichment fails",async()=>{
 const initial=deferred(),full=deferred(),seen=[];const pending=progressiveSearch(()=>initial.promise,()=>full.promise,result=>seen.push(result));initial.resolve("first");await Promise.resolve();assert.deepEqual(seen,["first"]);full.reject(new Error("timeout"));assert.deepEqual(await pending,{result:"first",partial:true});
});
test("late partial results cannot overwrite complete results and double failure is explicit",async()=>{
 const initial=deferred(),full=deferred(),seen=[];const pending=progressiveSearch(()=>initial.promise,()=>full.promise,result=>seen.push(result));full.resolve("complete");assert.deepEqual(await pending,{result:"complete",partial:false});initial.resolve("late");await Promise.resolve();assert.deepEqual(seen,[]);
 await assert.rejects(progressiveSearch(async()=>{throw Error();},async()=>{throw Error();},()=>{}));
});

test("prototype-like failure categories never become diagnostic labels",()=>{
 assert.equal(diagnostics.safeIndexingFailure("[toString] private"),"[unknown] 원인 미분류");
});
async function loadModule(relative,modules,globals={}){
 const text=await readFile(new URL(relative,import.meta.url),"utf8");
 const output=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};runInNewContext(`(function(require,module,exports){${output}\n})`,{Date,AbortSignal,setTimeout,clearTimeout,AbortController,Error,console:{error(){}},...globals})(name=>{assert.ok(name in modules,name);return modules[name];},mod,mod.exports);return mod.exports;
}
test("coverage paginates only user-visible document IDs and fails closed on query errors",async()=>{
 const visible=Array.from({length:501},(_,index)=>doc(`visible-${index}`)),queried=[],ranges=[];
 const documentClient={from(table){assert.equal(table,"os_documents");let range;const chain={select(){return chain;},neq(){return chain;},order(){return chain;},range(a,b){range=[a,b];ranges.push(range);return chain;},async abortSignal(){return {data:visible.slice(range[0],range[1]+1),error:null};}};return chain;}};
 const jobClient={from(table){assert.equal(table,"os_embedding_jobs");let ids;const chain={select(){return chain;},in(key,value){assert.equal(key,"document_id");ids=value;queried.push(...ids);return chain;},order(){return chain;},range(){return chain;},async abortSignal(){return {data:ids.map((id,index)=>job(index,"current","done",id)),error:null};}};return chain;}};
 const loaded=await loadModule("../lib/server/indexing-diagnostics.ts",{"@/lib/http":{ApiError},"@/lib/supabase/server":{createServiceSupabase:()=>jobClient},"@/lib/indexing-diagnostics":diagnostics});
 const coverage=await loaded.getIndexCoverage(documentClient);assert.equal(coverage.done,501);assert.equal(coverage.truncated,false);assert.deepEqual(ranges,[[0,499],[500,999]]);assert.deepEqual(new Set(queried),new Set(visible.map(row=>row.id)));assert.ok(!queried.includes("forbidden"));
 const badClient={from(){const chain={select(){return chain;},neq(){return chain;},order(){return chain;},range(){return chain;},async abortSignal(){return {data:null,error:{message:"private database"}};}};return chain;}};
 await assert.rejects(loaded.getIndexCoverage(badClient),{code:"INDEX_PROGRESS_UNAVAILABLE"});
});
test("provider failures are classified without exposing body and invalid vectors are rejected",async()=>{
 for(const [status,body,expected]of [[429,{error:{code:"insufficient_quota",message:"private"}},"EMBEDDING_QUOTA"],[429,{error:{message:"private"}},"EMBEDDING_RATE_LIMIT"],[401,{error:{message:"private"}},"EMBEDDING_AUTH"],[200,{data:[{index:0,embedding:[1]}]},"INVALID_EMBEDDING_RESPONSE"]]){
  const loaded=await loadModule("../lib/server/embeddings.ts",{"@/lib/http":{ApiError},"@/lib/config":{OPENAI_EMBEDDING_MODEL:"fixture"}},{process:{env:{OPENAI_API_KEY:"fixture"}},fetch:async()=>({ok:status===200,status,json:async()=>body})});
  await assert.rejects(loaded.createEmbeddings(["private input"]),error=>error.code===expected&&!error.message.includes("private"));
 }
});
test("retry command defaults to read-only and requires matching target for a bounded enqueue",async()=>{
 const {retryIndexing}=await import("../tools/retry-indexing.mjs");const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>options.method==="GET"?{queue:{coverage:{failed:5,truncated:false}}}:{retried:2}};};
 const options={base:"https://fixture.invalid",token:"fixture",fetchImpl};
 assert.equal((await retryIndexing(options)).mode,"dry-run");assert.equal(calls.length,1);assert.equal(calls[0].options.method,"GET");assert.equal(calls[0].options.redirect,"error");
 await assert.rejects(retryIndexing({...options,execute:true,confirmOrigin:"https://different.invalid"}));assert.equal(calls.length,1);
 const result=await retryIndexing({...options,execute:true,confirmOrigin:"https://fixture.invalid",limit:2});assert.equal(result.retried,2);assert.deepEqual(JSON.parse(calls.at(-1).options.body),{action:"retry_failed",limit:2});
 await assert.rejects(retryIndexing({...options,execute:true,confirmOrigin:options.base,fetchImpl:async()=>({ok:true,json:async()=>({queue:{coverage:{failed:5,truncated:true}}})})}));
 await assert.rejects(retryIndexing({...options,base:"http://remote.invalid"}));
});
test("quick keyword and supplemental reads retain the actor client without embeddings or elevated access",async()=>{
 const searchDiagnostics=await import("../lib/search-diagnostics.ts"),relevance=await import("../lib/search-relevance.ts");let reads=0,embeddings=0,rpcCalls=0;const scopes=[];
 const db={from(table){assert.equal(table,"os_documents");reads++;let ids=[];const chain={select(){return chain;},in(key,value){scopes.push({key,value});if(key==="id")ids=value;return chain;},or(){return chain;},order(){return chain;},limit(){return chain;},async abortSignal(){return {data:[{id:"visible",title:"target",content_md:"target evidence",status:"canonical",current_version:1}],error:null};},then(resolve){return Promise.resolve({data:ids.map(id=>({id,owner_id:"fixture",status:"canonical"})),error:null}).then(resolve);}};return chain;},rpc(){rpcCalls++;return {async abortSignal(){return {data:[],error:null};}};}};
 const loaded=await loadModule("../lib/server/search.ts",{"@/lib/http":{ApiError},"@/lib/search-diagnostics":searchDiagnostics,"@/lib/search-relevance":relevance,"./knowledge-page-access":{readableKnowledgePages:async(_actor,rows)=>new Set(rows.map(row=>row.id))},"./embeddings":{createEmbeddings:async()=>{embeddings++;return [[1]];},toPgVector:()=>"[1]"}},{process:{env:{OPENAI_API_KEY:"fixture"}}});
 const actor={type:"user",allowedStatuses:["canonical"],supabase:db};const input={query:"target",mode:"hybrid",topK:2,quick:true,filters:{statuses:["canonical","draft"]}};
 assert.equal((await loaded.searchDocuments(actor,input)).results[0].documentId,"visible");assert.equal(embeddings,0);assert.equal(rpcCalls,0);assert.equal(reads,2);assert.equal(JSON.stringify(scopes[0].value),'["canonical"]');
 assert.equal((await loaded.searchDocuments(actor,{...input,quick:false})).results.length,1);assert.equal(reads,4);assert.equal(embeddings,1);assert.equal(rpcCalls,1);
});
test("two-phase search logs only the complete request while preserving the API result shape",async()=>{
 let logWrites=0;
 const loaded=await loadModule("../app/api/v1/search/route.ts",{
  "next/server":{NextResponse:{json:value=>value}},zod:{ZodError:class extends Error{}},
  "@/lib/http":{ApiError,parseJson:request=>request.json(),apiErrorResponse:error=>{throw error;}},
  "@/lib/supabase/server":{createServiceSupabase:()=>({from:()=>({insert:async()=>{logWrites++;}})})},
  "@/lib/validation":{searchSchema:{parse:value=>value}},
  "@/lib/server/auth":{authenticateRequest:async()=>({type:"user",id:"fixture"})},
  "@/lib/server/search":{searchDocuments:async()=>({results:[],degraded:false})},
  "@/lib/server/organization":{assertOrganization:async()=>{}},
 },{process:{env:{SUPABASE_SERVICE_ROLE_KEY:"fixture"}}});
 for(const quick of [true,false]){const result=await loaded.POST({json:async()=>({query:"fixture",mode:"hybrid",quick})});assert.equal(result.query,"fixture");assert.equal(result.degraded,false);assert.ok(Array.isArray(result.results));assert.equal(logWrites,quick?0:1);}
});

test("queue storage read failures expose only a fixed error",async()=>{
 const state=setup({queueReadError:true});await assert.rejects(state.processEmbeddingQueue(),error=>error.code==="INDEX_QUEUE_UNAVAILABLE"&&!error.message.includes("private"));
});

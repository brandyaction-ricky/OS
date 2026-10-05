import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as contentInput from "../lib/content-input.ts";
import * as safety from "../lib/content-safety.ts";
import * as appeals from "../lib/content-appeals.ts";
import { defaultGenerationMode, generationJobLabel } from "../lib/content-generation-mode.ts";

const require = createRequire(import.meta.url);
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function compile(file, imports, context = {}) {
  const compiled = { exports: {} };
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: compiled, exports: compiled.exports, Date, AbortSignal, ...context, require(name) { if (name in imports) return imports[name]; throw Error(name); } });
  return compiled.exports;
}
function harness({ fail = false } = {}) {
  const sourceId = "c01ea53b-42ed-4af2-91af-03dc66ccf96f";
  const tables = { os_records: [{ id: sourceId, record_type: "content_topic", title: "Example", description: "Verified source", metadata: {}, status: "active", version: 1, archived_at: null, team: "", brand: "" }], os_documents: [{ id: "procedure", status: "canonical", title: "패키징 절차", source_ref: "", content_md: "Use source facts only." }] };
  let calls = 0;
  const client = { from(table) {
    const filters = []; let insert; let update; let start = 0; let end = Infinity;
    const q = { select() { return q; }, eq(key,value) { filters.push(row => row[key] === value); return q; }, neq(key,value) { filters.push(row => row[key] !== value); return q; }, is(key,value) { return q.eq(key,value); }, or() { return q; }, order() { return q; }, range(a,b) { start=a;end=b;return q; }, insert(value) { insert=value;return q; }, update(value) { update=value;return q; },
      result(single) {
        let rows;
        if (insert) {
          const values = Array.isArray(insert) ? insert : [insert];
          if (values.some(value => value.id && tables[table].some(row => row.id === value.id))) return {data:null,error:{code:"23505"}};
          rows=values.map(value => ({ id:crypto.randomUUID(), version:1, archived_at:null, ...structuredClone(value) })); tables[table].push(...rows); insert=undefined;
        } else {
          rows=tables[table].filter(row => filters.every(filter => filter(row))).slice(start,end+1);
          if (update) for (const row of rows) Object.assign(row,structuredClone(update),{version:row.version+1});
        }
        return {data:structuredClone(single ? rows[0]??null : rows),error:null};
      }, async single() { return q.result(true); }, async maybeSingle() { return q.result(true); }, then(resolve,reject) { return Promise.resolve(q.result(false)).then(resolve,reject); } };
    return q;
  } };
  const queue = compile("lib/server/content-generation-queue.ts", {"node:crypto":crypto,"@/lib/http":{ApiError}});
  const api = compile("lib/server/content-generation.ts", {zod:require("zod"),"@/lib/http":{ApiError},"@/lib/content-input":contentInput,"@/lib/content-safety":safety,"@/lib/content-appeals":appeals,"@/lib/structure-borrow":{structureBorrowGuidance:()=>""},"./content-generation-queue":queue,"./content-automation-settings":{readContentAutomationSettings:async()=>({settings:{generationMode:"queue",promptPrefix:"내부 요청 기준",retryLimit:2,publishLeadMinutes:30,autoCollect:false,enabledChannels:["youtube","instagram","threads"],shorts:{voicePreset:"voice",bgmPreset:"bgm",captionPreset:"caption"}}})}}, {
    process:{env:{ANTHROPIC_API_KEY:"unit-test-only"}},
    fetch:async()=> { calls++; return {ok:!fail,status:fail?429:200,json:async()=>({content:[{type:"text",text:JSON.stringify({summary:"Example",titles:[],copies:[],designPrompts:[]})}],usage:{input_tokens:21,output_tokens:34}})}; },
  });
  return {api,queue,sourceId,actor:{id:"human",team:"",supabase:client},rows:tables.os_records,calls:()=>calls};
}
test("default generation enqueues one durable job with no provider call, including retries", async()=>{
  const h=harness(); const input=h.api.generationSchema.parse({sourceId:h.sourceId,action:"title_package"});
  const first=await h.api.executeGeneration(h.actor,input);
  const repeat=await h.api.executeGeneration(h.actor,input);
  assert.equal(input.mode,"queue"); assert.equal(first.queued,true); assert.equal(first.job.id,repeat.job.id);
  assert.equal(h.calls(),0); assert.equal(h.rows.filter(row=>row.record_type==="ai_job").length,1);
  assert.equal(first.job.status,"backlog"); assert.equal(first.job.stage,"queued");
  assert.equal(first.job.metadata.generatedBy,"claude-queue");
  assert.equal(first.job.metadata.retryLimit,2);assert.equal(first.job.metadata.automation.promptPrefix,"내부 요청 기준");
});
test("explicit API mode persists a request before calling and links saved results and usage",async()=>{
  const h=harness(); const input=h.api.generationSchema.parse({sourceId:h.sourceId,action:"title_package",mode:"api"});
  const result=await h.api.executeGeneration(h.actor,input);
  assert.equal(h.calls(),1); assert.equal(result.queued,false);
  const job=h.rows.find(row=>row.record_type==="ai_job");
  assert.equal(job.status,"done"); assert.equal(job.metadata.usage.input_tokens,21); assert.equal(job.metadata.costUsd,null);
  assert.equal(result.records[0].metadata.generationId,job.id); assert.equal(job.metadata.recordIds[0],result.records[0].id);
  assert.equal(result.records[0].status,"review");
});
test("API failures persist a safe failure code instead of changing legacy credential jobs",async()=>{
  const h=harness({fail:true});
  await assert.rejects(h.api.executeGeneration(h.actor,h.api.generationSchema.parse({sourceId:h.sourceId,action:"title_package",mode:"api"})),error=>error.code==="CLAUDE_TEMPORARILY_UNAVAILABLE");
  const job=h.rows.find(row=>row.record_type==="ai_job");assert.equal(job.status,"blocked");assert.equal(job.stage,"failed");
  assert.equal(generationJobLabel(job),"실패");
  assert.equal(generationJobLabel({status:"blocked",stage:"credentials",metadata:{}}),"이전 방식 — API 연결 대기");
});
test("generation preference is queue by default and ignores unrelated or archived settings",()=>{
  assert.equal(defaultGenerationMode([]),"queue");
  assert.equal(defaultGenerationMode([{record_type:"company_setting",metadata:{settingKey:"content-generation",defaultGenerationMode:"api"}}]),"api");
  assert.equal(defaultGenerationMode([{id:"ca000000-0000-4000-8000-000000000001",record_type:"company_setting",metadata:{kind:"content_automation_settings",settings:{generationMode:"api"}}}]),"api");
  assert.equal(defaultGenerationMode([{record_type:"company_setting",metadata:{settingKey:"content-generation",defaultGenerationMode:"api"}},{id:"ca000000-0000-4000-8000-000000000001",record_type:"company_setting",metadata:{kind:"content_automation_settings",settings:{generationMode:"queue"}}}]),"queue");
  assert.equal(defaultGenerationMode([{record_type:"company_setting",archived_at:"yesterday",metadata:{settingKey:"content-generation",defaultGenerationMode:"api"}}]),"queue");
});
test("human-only publication gates reject agent reservation and publication with 403",()=>{
  const source=readFileSync(new URL("../app/api/v1/agent-records/route.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source+"\nexport {enforceHumanGates};",{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const compiled={exports:{}};vm.runInNewContext(code,{module:compiled,exports:compiled.exports,require(name){return name==="zod"?require(name):name==="@/lib/http"?{ApiError}:{};}});
  for(const status of ["scheduled","published"]) assert.throws(()=>compiled.exports.enforceHumanGates("content_publish",status),error=>error.status===403);
  assert.doesNotThrow(()=>compiled.exports.enforceHumanGates("content_publish","review"));
});

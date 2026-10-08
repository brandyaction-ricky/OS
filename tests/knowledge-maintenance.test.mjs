import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const code=ts.transpileModule(readFileSync(new URL("../lib/server/knowledge-maintenance.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function mock(env={},error=null){
 const mod={exports:{}},calls=[];
 const imports={"next/server":{NextResponse:Response},"@/lib/http":{ApiError,apiErrorResponse:e=>Response.json({code:e.code},{status:e.status??500})},"@/lib/server/auth":{safeSecretMatch:(a,b)=>a===b},"@/lib/supabase/server":{createServiceSupabase:()=>{calls.push("client");return {rpc:async name=>{calls.push(name);return {data:2,error};}};}}};
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:id=>{assert.ok(id in imports);return imports[id];},process:{env},Request,Response});
 return {...mod.exports,calls};
}
const request=()=>new Request("http://localhost/qa",{headers:{authorization:"Bearer synthetic-only"}});
test("maintenance is authenticated and disabled without ever initializing a database client",async()=>{
 for(const kind of ["purge","reminders"]){
  const denied=mock();assert.equal((await denied.runKnowledgeMaintenance(request(),kind)).status,401);assert.deepEqual(denied.calls,[]);
  const disabled=mock({CRON_SECRET:"synthetic-only"});const response=await disabled.runKnowledgeMaintenance(request(),kind);
  assert.equal(response.status,200);assert.equal((await response.json()).skipped,"disabled");assert.deepEqual(disabled.calls,[]);
 }
});
test("maintenance flags stay independent and RPC failure cannot report success",async()=>{
 const enabled=mock({CRON_SECRET:"synthetic-only",KNOWLEDGE_REMINDERS_ENABLED:"true"});
 await enabled.runKnowledgeMaintenance(request(),"purge");assert.deepEqual(enabled.calls,[]);
 assert.equal((await enabled.runKnowledgeMaintenance(request(),"reminders")).status,200);
 assert.deepEqual(enabled.calls,["client","os_workspace_send_reminders"]);
 const failed=mock({CRON_SECRET:"synthetic-only",KNOWLEDGE_TRASH_AUTOPURGE:"true"},{message:"synthetic failure"});
 assert.equal((await failed.runKnowledgeMaintenance(request(),"purge")).status,503);
});

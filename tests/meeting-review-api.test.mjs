import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {validWorkDate} from "../lib/task-management.ts";
class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const source=await readFile(new URL("../lib/server/meeting-review.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};runInNewContext(`(function(require,module,exports){${code}\n})`)((name)=>name==="@/lib/http"?{ApiError}:{validWorkDate},mod,mod.exports);
const {assertReviewedMeetingTask}=mod.exports;
function actor({active=true,visible=true,fail=false}={}){
 const filters=[];return {filters,supabase:{from(table){const builder={select(){return builder;},eq(key,value){filters.push([table,key,value]);return builder;},is(key,value){filters.push([table,key,value]);return builder;},async maybeSingle(){return {data:(table==="os_profiles"?active:visible)?{id:"fixture"}:null,error:fail?{}:null};}};return builder;}}};
}
const input={recordType:"task",assigneeId:"member",dueDate:"2026-10-05",parentId:"meeting",metadata:{extractionReviewed:true}};
test("reviewed meeting task writes require a real active assignee and accessible meeting",async()=>{
 const member=actor();await assertReviewedMeetingTask(member,input);assert.ok(member.filters.some(([,key,value])=>key==="is_active"&&value===true));assert.ok(member.filters.some(([,key,value])=>key==="record_type"&&value==="meeting"));
 for(const options of [{active:false},{visible:false}])await assert.rejects(assertReviewedMeetingTask(actor(options),input),{code:"MEETING_TASK_TARGET_INVALID"});
 await assert.rejects(assertReviewedMeetingTask(actor({fail:true}),input),{status:503});
});
test("missing or invalid review requirements fail before any write while legacy tasks remain compatible",async()=>{
 for(const change of [{assigneeId:null},{dueDate:null},{dueDate:"2026-99-99"},{parentId:null}])await assert.rejects(assertReviewedMeetingTask(actor(),{...input,...change}),{code:"MEETING_TASK_REVIEW_REQUIRED"});
 const legacy=actor();await assertReviewedMeetingTask(legacy,{recordType:"task",metadata:{source:"meeting"}});assert.equal(legacy.filters.length,0);
});

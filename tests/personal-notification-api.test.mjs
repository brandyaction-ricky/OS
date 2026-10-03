import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as notifications from "../lib/notifications.ts";
import * as legacy from "../lib/development-notifications.ts";
const actorId="10000000-0000-4000-8000-000000000001",otherId="10000000-0000-4000-8000-000000000002";
const sourceId="20000000-0000-4000-8000-000000000001", notificationId="30000000-0000-4000-8000-000000000001";
const otherNotificationId="30000000-0000-4000-8000-000000000002";
const source=await readFile(new URL("../app/api/v1/notifications/route.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function createDatabase(rows, { hidden = [], conflict = false } = {}) {
  return {
    rpc: async () => ({ data: 1, error: null }),
    from(table) {
      assert.ok(["os_records", "os_documents"].includes(table));
      const conditions = [], ordering = [];
      let action = "read", input, range;
      const value = (row, key) => key === "metadata->>kind" ? row.metadata?.kind : row[key];
      const execute = () => {
        let matches = rows.filter((row) => !hidden.includes(row.id) && (table === "os_documents" ? row.document : !row.document) && conditions.every((condition) => condition(row)));
        if (action === "update" && conflict) matches = [];
        matches.sort((left, right) => {
          for (const [key, ascending] of ordering) {
            const compared = String(value(left, key) ?? "").localeCompare(String(value(right, key) ?? ""));
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        });
        if (range) matches = matches.slice(range[0], range[1] + 1);
        if (action === "update") matches.forEach((row) => Object.assign(row, structuredClone(input), { version: row.version + 1, updated_at: "2026-09-21T12:00:00Z" }));
        return { data: structuredClone(matches), error: null };
      };
      const builder = {
        select() { return builder; },
        eq(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        neq(key, expected) { conditions.push((row) => value(row,key) !== expected); return builder; },
        is(key, expected) { conditions.push((row) => value(row, key) === expected); return builder; },
        in(key, expected) { conditions.push((row) => expected.includes(value(row, key))); return builder; },
        order(key, { ascending = true } = {}) { ordering.push([key, ascending]); return builder; },
        range(from, to) { range = [from, to]; return builder; },
        update(fields) { action = "update"; input = fields; return builder; },
        maybeSingle() { const result = execute(); return Promise.resolve({ ...result, data: result.data[0] ?? null }); },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return builder;
    },
  };
}


function setup({hidden=[], document=false, conflict=false, available=true}={}) {
 const rows=[
 {id:sourceId,record_type:"task",title:"검증용 항목",metadata:{},archived_at:null,document},
 ...[notificationId,otherNotificationId].map((id,index)=>({id,record_type:"notification",title:"업무 알림",status:"unread",owner_id:index?otherId:actorId,version:1,archived_at:null,created_at:"2026-10-03T00:00:00Z",metadata:{sourceType:document?"document":"record",sourceId,reason:"assignment",readAt:""}}))];
 const service=createDatabase(rows,{conflict}); if(!available)service.rpc=async()=>({error:{code:"PGRST202"},data:null});
 const modules={"next/server":{NextResponse:Response},zod,"@/lib/development-notifications":legacy,"@/lib/notifications":notifications,
 "@/lib/server/auth":{authenticateRequest:async(request)=>{if(!request.headers.has("authorization"))throw new ApiError(401,"AUTH_REQUIRED","로그인 필요");return {id:actorId,ownerId:actorId,supabase:createDatabase(rows,{hidden})};}},
 "@/lib/supabase/server":{createServiceSupabase:()=>service},"@/lib/http":{ApiError,parseJson:r=>r.json(),apiErrorResponse:e=>Response.json({error:{code:e.code,message:e.message}},{status:e.status??500})}};
 const mod={exports:{}};runInNewContext(`(function(require,module,exports){${code}\n})`,{Date,URL,Response})((name)=>{assert.ok(name in modules,name);return modules[name];},mod,mod.exports);
 return {routes:mod.exports,rows};
}
const request=(method="GET",ids,auth=true)=>new Request("https://os.example/api/v1/notifications",{method,headers:{...(auth?{authorization:"Bearer fixture"}:{}),"content-type":"application/json"},...(ids?{body:JSON.stringify({ids})}:{})});
test("notification reads authenticate, isolate recipients, and do not mutate delivery state",async()=>{
 const {routes,rows}=setup();const before=structuredClone(rows);
 assert.equal((await routes.GET(request("GET",null,false))).status,401);
 const response=await routes.GET(request());const body=await response.json();
 assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(body.unread,1);assert.equal(body.notifications[0].title,"검증용 항목");assert.equal(body.notifications[0].href,`/organization/tasks?task=${sourceId}`);assert.deepEqual(rows,before);
 assert.equal(body.notifications[0].owner_id,undefined);
});
test("revoked source access hides titles and counts and prevents marking read",async()=>{
 const {routes,rows}=setup({hidden:[sourceId]});
 assert.deepEqual((await (await routes.GET(request())).json()).notifications,[]);
 assert.equal((await (await routes.GET(request())).json()).unread,0);
 assert.equal((await routes.PATCH(request("PATCH",[notificationId]))).status,404);
 assert.equal(rows[1].metadata.readAt,"");
});
test("document alerts use document RLS and point at the exact review document",async()=>{
 const {routes}=setup({document:true});const body=await(await routes.GET(request())).json();
 assert.equal(body.notifications[0].href,`/knowledge/review?document=${sourceId}`);
 const hidden=setup({document:true,hidden:[sourceId]});assert.equal((await(await hidden.routes.GET(request())).json()).unread,0);
});
test("read updates reject mixed recipients, duplicate ids, and stale versions",async()=>{
 const {routes,rows}=setup();
 assert.equal((await routes.PATCH(request("PATCH",[notificationId,otherNotificationId]))).status,404);
 assert.equal(rows[1].metadata.readAt,"");
 assert.equal((await routes.PATCH(request("PATCH",[notificationId,notificationId]))).status,400);
 assert.equal((await routes.PATCH(request("PATCH",[notificationId]))).status,200);
 assert.equal(rows[1].status,"read");assert.equal(rows[2].status,"unread");
 const stale=setup({conflict:true});assert.equal((await stale.routes.PATCH(request("PATCH",[notificationId]))).status,409);
});
test("unapplied notification migration reports unavailable rather than a healthy empty inbox",async()=>{
 const {routes}=setup({available:false});const response=await routes.GET(request());assert.equal(response.status,503);assert.equal((await response.json()).error.code,"NOTIFICATIONS_NOT_READY");
});

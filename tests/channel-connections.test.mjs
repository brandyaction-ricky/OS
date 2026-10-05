import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function moduleOf(path, modules, globals={}) {
  const source=await read(path), compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const result={exports:{}};
  runInNewContext(`(function(require,module,exports){${compiled}\n})`,{ Buffer,URLSearchParams,AbortSignal,...globals })(key=>{if(!(key in modules))throw Error(`Missing test dependency: ${key}`);return modules[key];},result,result.exports);
  return result.exports;
}
const access=await moduleOf("lib/server/channel-access.ts",{"@/lib/http":{ApiError},"@/lib/supabase/server":{}});
const owner={id:"owner",type:"user",role:"member"}, colleague={id:"colleague",type:"user",role:"member"}, admin={id:"admin",type:"user",role:"admin"};

test("private channels are usable by owners only; shared channels by human members, never agents",()=>{
  for(const team_shared of [false,true])for(const actor of [owner,colleague,admin,{...owner,type:"agent"}]){
    const connection={owner_id:"owner",team_shared};
    assert.equal(access.canUseConnection(actor,connection),actor.type==="user"&&(actor.id==="owner"||team_shared));
    assert.equal(access.canManageConnection(actor,connection,"share"),actor.type==="user"&&actor.id==="owner");
    assert.equal(access.canManageConnection(actor,connection,"reconnect"),actor.type==="user"&&actor.id==="owner");
    assert.equal(access.canManageConnection(actor,connection,"disconnect"),actor.type==="user"&&(actor.id==="owner"||actor.role==="admin"));
  }
  assert.throws(()=>access.assertConnectionAccess(colleague,{owner_id:"owner"}),error=>error.status===403);
});

async function metaSetup() {
  const env={META_TOKEN_ENCRYPTION_KEY:"unit-test-only-not-a-real-secret"}, counters={fetch:0,write:0,audit:0};
  const api=await moduleOf("lib/server/meta-oauth.ts",{
    "node:crypto":crypto,"@/lib/http":{ApiError},
    "./channel-access":{...access,assertActiveChannelOwner:async()=>{},auditChannelAction:async()=>{counters.audit++;}},
    "@/lib/supabase/server":{createServiceSupabase:()=>({from:()=>{const builder={update:()=>{counters.write++;return builder;},eq:()=>builder,then:resolve=>Promise.resolve({error:null}).then(resolve)};return builder;}})},
  },{process:{env},fetch:async()=>{counters.fetch++;throw Error("Unexpected provider call");}});
  return {module:api,env,counters};
}
const connection={owner_id:"owner",platform:"threads",external_account_id:"external-private-id",account_name:"모의 계정",account_type:"MOCK",scopes:[],encrypted_access_token:"token-must-never-escape",token_expires_at:new Date(Date.now()+86400000).toISOString(),team_shared:false,status:"connected",connected_at:"2026-10-03",updated_at:"2026-10-03",last_success_at:null,last_error_code:null};

test("Meta tokens use authenticated encryption, unique nonces and reject corruption",async()=>{
  const {module}=await metaSetup();
  const first=module.encryptMetaToken("private-test-value"),second=module.encryptMetaToken("private-test-value");
  assert.notEqual(first,second);assert.equal(module.decryptMetaToken(first),"private-test-value");
  assert.throws(()=>module.decryptMetaToken(first.replace(/^v1/,"v2")),error=>error.code==="META_TOKEN_INVALID");
  const parts=first.split(".");parts[2]=Buffer.alloc(16).toString("base64url");
  assert.throws(()=>module.decryptMetaToken(parts.join(".")),error=>error.code==="META_TOKEN_INVALID");
});

test("OAuth state binds owner, platform, nonce and ten-minute expiry",async()=>{
  const {module,env}=await metaSetup();
  const state=module.createMetaState("owner","instagram");
  assert.equal(module.verifyMetaState(state.cookie,state.nonce).ownerId,"owner");
  assert.equal(module.verifyMetaState(state.cookie,state.nonce).platform,"instagram");
  assert.throws(()=>module.verifyMetaState(state.cookie,"wrong"));
  assert.throws(()=>module.verifyMetaState(`${state.cookie}invalid`,state.nonce));
  const payload=Buffer.from(JSON.stringify({ownerId:"owner",platform:"instagram",nonce:state.nonce,expiresAt:1})).toString("base64url");
  const key=crypto.createHmac("sha256","brandyaction-meta-token-v1").update(env.META_TOKEN_ENCRYPTION_KEY).digest();
  const signature=crypto.createHmac("sha256",key).update(payload).digest("base64url");
  assert.throws(()=>module.verifyMetaState(`${payload}.${signature}`,state.nonce));
});

test("public channel projection never returns credentials or external identity",async()=>{
  const {module}=await metaSetup();const result=module.publicMetaConnection(connection);
  assert.equal(result.expiresSoon,true);assert.equal(result.mock,true);
  assert.doesNotMatch(JSON.stringify(result),/token-must|external-private|encrypted|scopes/);
  assert.equal(module.publicMetaConnection({...connection,token_expires_at:"2000-01-01"}).status,"expired");
});

test("mock tests never call providers; mismatched live connections cannot claim success",async()=>{
  const {module,env,counters}=await metaSetup();
  assert.equal(module.metaMode(),"mock");
  await module.testMetaConnection(owner,connection);
  assert.equal(counters.fetch,0);assert.equal(counters.write,1);assert.equal(counters.audit,1);
  await assert.rejects(module.testMetaConnection(owner,{...connection,account_type:"THREADS"}),error=>error.code==="META_MODE_MISMATCH");
  await assert.rejects(module.refreshMetaConnection(owner,{...connection,account_type:"THREADS"}),error=>error.code==="META_MODE_MISMATCH");
  assert.equal(counters.write,1);assert.equal(counters.audit,1);
  env.META_MODE="live";
  assert.throws(()=>module.metaAccessToken(connection),error=>error.code==="META_MOCK_CONNECTION");
  assert.equal(counters.fetch,0);
});

test("channel migration is additive, service-only and rejects duplicate channel identities atomically",async()=>{
  const sql=await read("supabase/migrations/20261003044602_final_os_channel_connections.sql");
  assert.match(sql,/primary key \(owner_id, platform\)/);
  assert.match(sql,/unique \(platform, external_account_id\)/);
  assert.match(sql,/create unique index.*os_youtube_connections \(channel_id\)/);
  assert.match(sql,/enable row level security/);assert.match(sql,/revoke all.*public, anon, authenticated/);
  assert.doesNotMatch(sql,/\b(drop table|drop column|delete from|truncate|update public\.)\b/i);
  for(const path of ["app/api/v1/records/route.ts","app/api/v1/agent-records/route.ts"]){const source=await read(path);assert.equal((source.match(/CHANNEL_API_REQUIRED/g)??[]).length,3);}
});

test("company inventory rejects members before reading tokens; regular inventory filters private channels",async()=>{
  let actor=colleague, reads=0;
  const meta=await metaSetup();
  const api=await moduleOf("app/api/v1/channels/route.ts",{
    "next/server":{NextResponse:Response},"@/lib/http":{ApiError,apiErrorResponse:error=>Response.json({code:error.code},{status:error.status??500})},
    "@/lib/server/auth":{authenticateRequest:async()=>actor},"@/lib/server/channel-access":access,
    "@/lib/server/meta-oauth":meta.module,
    "@/lib/server/youtube-oauth":{YOUTUBE_ANALYTICS_SCOPE:"https://www.googleapis.com/auth/yt-analytics.readonly"},
    "@/lib/supabase/server":{createServiceSupabase:()=>({from:table=>{reads++;const builder={select:()=>builder,or:()=>builder,then:resolve=>Promise.resolve({data:table==="os_meta_connections"?[connection,{...connection,owner_id:"shared",team_shared:true}]:[],error:null}).then(resolve)};return builder;}})},
  },{URL,Response});
  assert.equal((await api.GET(new Request("https://os.example/api/v1/channels?scope=company"))).status,403);
  assert.equal(reads,0);
  const regular=await (await api.GET(new Request("https://os.example/api/v1/channels"))).json();
  assert.equal(regular.connections.length,1);assert.equal(regular.connections[0].ownerId,"shared");
  actor=admin;
  const company=await (await api.GET(new Request("https://os.example/api/v1/channels?scope=company"))).json();
  assert.equal(company.connections.length,2);
  assert.doesNotMatch(JSON.stringify(company),/token-must|encrypted|external-private/);
});

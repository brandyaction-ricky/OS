import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";

class ApiError extends Error {
  constructor(status, code, message, details) { super(message); Object.assign(this, {status, code, details}); }
}
async function moduleOf(path, modules = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const result = {exports:{}};
  runInNewContext(`(function(require,module,exports){${compiled}\n})`, {Buffer,URL,URLSearchParams,AbortSignal,...globals})(key=>{if(!(key in modules))throw Error(`Missing test dependency: ${key}`);return modules[key];},result,result.exports);
  return result.exports;
}
const results = await moduleOf("lib/meta-connection-result.ts");

test("callback classifies expired state, provider denial and server failures separately", () => {
  for (const [code,result] of [["META_STATE_INVALID","request_expired"],["META_CODE_REQUIRED","request_expired"],["META_PROVIDER_DENIED","permission_not_granted"],["META_NOT_CONFIGURED","configuration_required"],["META_CONNECTION_SAVE_FAILED","connection_save_failed"],["META_SCHEMA_REQUIRED","connection_save_failed"],["CHANNEL_ALREADY_CONNECTED","already_connected"]]) {
    assert.equal(results.metaConnectionFailure(new ApiError(500,code,"hidden")).result,result);
  }
  assert.equal(results.metaConnectionFailure(new Error("hidden")).result,"connection_failed");
});

test("diagnostics discard URLs, messages, identities, arbitrary codes and nested provider payloads", () => {
  const hidden = "never-emit-this-secret";
  const error = {code:"META_CONNECTION_FAILED", message:hidden, request:{url:hidden}, details:{stage:"long_token",httpStatus:400,providerCode:190,providerSubcode:463,url:hidden,access_token:hidden,user_id:hidden,error:{message:hidden}}};
  const failure = results.metaConnectionFailure(error);
  assert.equal(failure.result,"token_exchange_failed");
  assert.equal(failure.diagnostic.providerCode,190);
  assert.doesNotMatch(JSON.stringify(failure),new RegExp(hidden));
  const arbitrary = results.metaConnectionFailure({code:hidden,details:{stage:hidden,httpStatus:hidden,providerCode:Infinity,providerSubcode:-1}});
  assert.equal(arbitrary.diagnostic.code,"META_INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(arbitrary),new RegExp(hidden));
});

test("user guidance avoids blaming tester invitations for token and storage failures", () => {
  assert.match(results.metaConnectionResultMessage("request_expired"),/연결 요청/);
  assert.match(results.metaConnectionResultMessage("connection_save_failed"),/저장하지 못/);
  assert.match(results.metaConnectionResultMessage("token_exchange_failed"),/인증 정보를 받는 단계/);
  assert.doesNotMatch(results.metaConnectionResultMessage("unexpected-secret"),/unexpected-secret/);
});

for (const stage of ["short_token","long_token","profile"]) {
  test(`OAuth identifies ${stage} provider failure without retaining response secrets`, async () => {
    let calls=0,writes=0;
    const env={META_MODE:"live",META_THREADS_APP_ID:"test-app",META_THREADS_APP_SECRET:"test-secret",META_TOKEN_ENCRYPTION_KEY:"test-encryption",OS_PUBLIC_URL:"https://os.example"};
    const api=await moduleOf("lib/server/meta-oauth.ts", {
      "node:crypto":crypto,"@/lib/http":{ApiError},
      "./channel-access":{assertActiveChannelOwner:async()=>{},auditChannelAction:async()=>{}},
      "@/lib/supabase/server":{createServiceSupabase:()=>{writes++;throw Error("Unexpected database access");}},
    },{process:{env},fetch:async()=>{
      const current=["short_token","long_token","profile"][calls++];
      return current===stage ? Response.json({error:{code:190,error_subcode:463,message:"provider-secret-must-not-escape"}},{status:401}) : Response.json(current==="short_token"?{access_token:"test-short"}:{access_token:"test-long",expires_in:3600});
    }});
    await assert.rejects(api.saveMetaConnection("test-owner","threads","test-code"), error=>{
      const failure=results.metaConnectionFailure(error);
      assert.equal(failure.diagnostic.stage,stage);
      assert.equal(failure.diagnostic.httpStatus,401);
      assert.equal(failure.diagnostic.providerCode,190);
      assert.doesNotMatch(JSON.stringify(error),/provider-secret/);
      return true;
    });
    assert.equal(writes,0);
  });
}

test("callback redirects with a safe category and clears the state cookie on failure", async () => {
  const logs=[],cleared=[];
  const response={cookies:{set:(...args)=>cleared.push(args)}};
  const route=await moduleOf("app/api/v1/meta/callback/route.ts",{
    "next/headers":{cookies:async()=>({get:()=>({value:"test-cookie"})})},
    "next/server":{NextResponse:{redirect:url=>{response.url=url;return response;}}},
    "@/lib/http":{ApiError},"@/lib/meta-connection-result":results,
    "@/lib/server/meta-oauth":{META_COOKIE:"test-cookie",metaMode:()=>"live",verifyMetaState:()=>({ownerId:"hidden-owner",platform:"threads"}),saveMetaConnection:async()=>{throw new ApiError(502,"META_CONNECTION_FAILED","secret",{stage:"long_token",httpStatus:400,providerCode:190});}},
  },{process:{env:{OS_PUBLIC_URL:"https://os.example"}},console:{warn:(...args)=>logs.push(args)}});
  await route.GET(new Request("https://os.example/api/v1/meta/callback?code=hidden-code&state=hidden-state"));
  assert.equal(response.url,"https://os.example/settings/account?meta=token_exchange_failed");
  assert.equal(cleared[0][1],"");assert.equal(cleared[0][2].maxAge,0);
  assert.doesNotMatch(JSON.stringify(logs),/hidden-code|hidden-state|hidden-owner|secret/);
  assert.equal(logs[0][1].stage,"long_token");
});

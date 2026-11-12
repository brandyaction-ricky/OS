import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import * as consumers from "node:stream/consumers";
import test from "node:test";
import ts from "typescript";

class ApiError extends Error {
  constructor(status, code, message, details) { super(message); Object.assign(this, {status, code, details}); }
}
async function moduleOf(path, modules = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const result = {exports:{}};
  runInNewContext(`(function(require,module,exports){${compiled}\n})`, {Buffer,URL,URLSearchParams,AbortSignal,Response,...globals})(key=>{if(!(key in modules))throw Error(`Missing test dependency: ${key}`);return modules[key];},result,result.exports);
  return result.exports;
}
const results = await moduleOf("lib/meta-connection-result.ts");

function fakeHttps(respond) {
  return {get(url, options, callback) {
    const request = new EventEmitter();
    Promise.resolve().then(async () => {
      const response = await respond(url, options);
      const reply = Readable.from([await response.text()]);
      reply.statusCode = response.status;
      callback(reply);
    }).catch(error => request.emit("error", error));
    return request;
  }};
}

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
  for (const value of ["__proto__", "constructor", "toString"]) assert.equal(typeof results.metaConnectionResultMessage(value), "string");
});

for (const stage of ["short_token","long_token","profile"]) {
  test(`OAuth identifies ${stage} provider failure without retaining response secrets`, async () => {
    let calls=0,writes=0;
    const env={META_MODE:"live",META_THREADS_APP_ID:"test-app",META_THREADS_APP_SECRET:"test-secret",META_TOKEN_ENCRYPTION_KEY:"test-encryption",OS_PUBLIC_URL:"https://os.example"};
    const respond = async () => {
      const current=["short_token","long_token","profile"][calls++];
      return current===stage ? Response.json({error:{code:190,error_subcode:463,message:"provider-secret-must-not-escape"}},{status:401}) : Response.json(current==="short_token"?{access_token:"test-short"}:{access_token:"test-long",expires_in:3600});
    };
    const api=await moduleOf("lib/server/meta-oauth.ts", {
      "node:crypto":crypto,"@/lib/http":{ApiError},
      "node:https":fakeHttps(respond), "node:stream/consumers":consumers,
      "./channel-access":{assertActiveChannelOwner:async()=>{},auditChannelAction:async()=>{}},
      "@/lib/supabase/server":{createServiceSupabase:()=>{writes++;throw Error("Unexpected database access");}},
    },{process:{env},fetch:respond});
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

for (const platform of ["threads", "instagram"]) {
  test(`${platform} exchanges a short token before reading a profile with the long token`, async () => {
    const short = "test+short/with&reserved=characters";
    const secret = "test+secret&only";
    const prefix = platform === "threads" ? "META_THREADS" : "META_INSTAGRAM";
    const env = {META_MODE:"live", OS_PUBLIC_URL:"https://os.example", [prefix + "_APP_ID"]:"test-app", [prefix + "_APP_SECRET"]:secret};
    const calls = [];
    const respond = async (url, options, transport) => {
      calls.push({url:new URL(url), options, transport});
      if (calls.length === 1) return Response.json({access_token:short});
      if (calls.length === 2) return Response.json({access_token:"test-long", expires_in:5184000});
      return Response.json({error:{code:190}}, {status:401});
    };
    const api = await moduleOf("lib/server/meta-oauth.ts", {
      "node:crypto":crypto, "@/lib/http":{ApiError},
      "node:https":fakeHttps((url, options) => respond(url, options, "https")),
      "node:stream/consumers":consumers,
      "./channel-access":{assertActiveChannelOwner:async()=>{}},
      "@/lib/supabase/server":{},
    }, {process:{env}, fetch:(url, options) => respond(url, options, "fetch")});
    await assert.rejects(api.saveMetaConnection("test-owner", platform, "test-code"),
      error => error.details.stage === "profile");
    assert.equal(calls.length, 3);
    const [initial, exchange, profile] = calls;
    assert.equal(initial.options.body.get("client_secret"), secret);
    assert.equal(exchange.options.method ?? "GET", "GET");
    assert.ok(exchange.options.signal);
    assert.equal(exchange.url.searchParams.get("client_secret"), secret);
    if (platform === "threads") {
      assert.equal(exchange.url.origin + exchange.url.pathname, "https://graph.threads.com/access_token");
      assert.equal(exchange.url.searchParams.get("grant_type"), "th_exchange_token");
      assert.deepEqual(exchange.url.searchParams.getAll("access_token"), [short]);
      assert.equal(exchange.options.headers?.authorization, undefined);
      assert.equal(exchange.transport, "https");
    } else {
      assert.equal(exchange.url.origin + exchange.url.pathname, "https://graph.instagram.com/access_token");
      assert.equal(exchange.url.searchParams.get("grant_type"), "ig_exchange_token");
      assert.equal(exchange.url.searchParams.has("access_token"), false);
      assert.equal(exchange.options.headers.authorization, `Bearer ${short}`);
      assert.equal(exchange.transport, "fetch");
    }
    assert.equal(profile.url.pathname, "/me");
    assert.equal(profile.url.searchParams.has("access_token"), false);
    assert.equal(profile.options.headers.authorization, "Bearer test-long");
  });
}

for (const condition of ["redirect", "network error"]) {
  test(`Threads long-token ${condition} stops before profile lookup and drops credential-bearing URLs`, async () => {
    let requests = 0;
    let directRequests = 0;
    const env = {META_MODE:"live", META_THREADS_APP_ID:"test-app", META_THREADS_APP_SECRET:"secret-test-value", OS_PUBLIC_URL:"https://os.example"};
    const api = await moduleOf("lib/server/meta-oauth.ts", {
      "node:crypto":crypto, "@/lib/http":{ApiError},
      "./channel-access":{assertActiveChannelOwner:async()=>{}}, "@/lib/supabase/server":{},
      "node:stream/consumers":consumers,
      "node:https":fakeHttps(async url => {
        directRequests++;
        if (condition === "network error") throw Error(url);
        return Response.redirect("https://example.invalid/", 302);
      }),
    }, {process:{env}, fetch:async () => {
      requests++;
      return Response.json({access_token:"secret-test-token"});
    }});
    await assert.rejects(api.saveMetaConnection("test-owner", "threads", "test-code"), error => {
      assert.equal(error.details.stage, "long_token");
      assert.doesNotMatch(error.message + JSON.stringify(error), /secret-test|graph\.threads/);
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(directRequests, 1);
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

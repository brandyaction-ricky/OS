import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error { constructor(status,code,message) {super(message);this.status=status;this.code=code;} }
const source=readFileSync(new URL("../lib/server/card-draw.ts",import.meta.url),"utf8");
function provider(env,fetch) {
  const compiled={exports:{}};
  const modules={"node:crypto":crypto,zod,"@/lib/http":{ApiError},"@/lib/cost":{DEFAULT_COST_MODELS:{image:"configured-default"}},
    "@/lib/cardnews/draw":{CARD_DRAW_SCENE_MAX:2000,CARD_DRAW_REFS_MAX:4},"@/lib/supabase/server":{},"./youtube-process":{},"./youtube-process-stages":{}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {module:compiled,exports:compiled.exports,require:name=>{assert.ok(name in modules,name);return modules[name];},process:{env},fetch,Buffer,FormData,File,AbortSignal,console:{error(){}}});
  return compiled.exports;
}
test("the shared image provider sends actual original bytes to edits with the configured model",async()=>{
  const calls=[],api=provider({OPENAI_API_KEY:"unit-test-only",OPENAI_IMAGE_MODEL:"configured-image-model"},async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>({data:[{b64_json:Buffer.from("edited-png").toString("base64")}]})};
  });
  const original=new File(["original-pixels"],"current-ad.png",{type:"image/png"});
  const result=await api.drawImageBytes({prompt:"실행은 85점으로 바꿔줘",files:[original],size:"1024x1280",quality:"high"});
  assert.equal(calls.length,1);assert.equal(calls[0].url,"https://api.openai.com/v1/images/edits");
  assert.equal(await calls[0].options.body.get("image[]").text(),"original-pixels");
  assert.equal(calls[0].options.body.get("model"),"configured-image-model");
  assert.equal(calls[0].options.body.get("prompt"),"실행은 85점으로 바꿔줘");
  assert.equal(result.model,"configured-image-model");assert.equal(result.bytes.toString(),"edited-png");
});
test("card drawing without references keeps the JSON generation path and shared default",async()=>{
  let call;const api=provider({OPENAI_API_KEY:"unit-test-only"},async(url,options)=>{
    call={url,options};return {ok:true,json:async()=>({data:[{b64_json:"YQ=="}]})};
  });
  await api.drawImageBytes({prompt:"책상",files:[],size:"1024x1280",quality:"medium"});
  assert.equal(call.url,"https://api.openai.com/v1/images/generations");
  const body=JSON.parse(call.options.body);assert.equal(body.model,"configured-default");assert.equal(body.quality,"medium");assert.equal(body.n,1);
});
test("no key, timeout and provider refusal never trigger fallback or retry",async()=>{
  const input={prompt:"문구 삭제",files:[new File(["pixels"],"current.png")],size:"1024x1024",quality:"high"};
  let calls=0;const noKey=provider({},async()=>{calls++;throw Error("must not run");});
  await assert.rejects(noKey.drawImageBytes(input),error=>error.code==="OPENAI_NOT_CONFIGURED");assert.equal(calls,0);
  const timeout=provider({OPENAI_API_KEY:"unit-test-only"},async()=>{calls++;throw Error("timeout");});
  await assert.rejects(timeout.drawImageBytes(input),error=>error.code==="CARD_DRAW_TIMEOUT");assert.equal(calls,1);
  calls=0;const blocked=provider({OPENAI_API_KEY:"unit-test-only"},async()=>{calls++;return {ok:false,status:400,json:async()=>({error:{code:"moderation_blocked"}})};});
  await assert.rejects(blocked.drawImageBytes(input),error=>error.code==="CARD_DRAW_BLOCKED");assert.equal(calls,1);
});

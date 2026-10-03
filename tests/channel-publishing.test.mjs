import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";
const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
async function moduleOf(path,dependencies,globals={}){const compiled=ts.transpileModule(await read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};runInNewContext(`(function(require,module,exports){${compiled}\n})`,{structuredClone,Buffer,...globals})(name=>{if(!(name in dependencies))throw Error(name);return dependencies[name];},mod,mod.exports);return mod.exports;}
const publishing=await moduleOf("lib/channel-publishing.ts",{zod:{z}});
const settings=publishing.publicationSettingsSchema.parse({account:{platform:"threads",ownerId:"00000000-0000-4000-8000-000000000001"},platformFormat:"threads_chain",caption:"",parts:["첫 글","둘째 글","셋째 글"]});
function provider(options={}){let created=0,posted=0;const calls=[];return {calls,create:async(index,parent)=>{calls.push({index,parent});return `container-${created++}`;},inspect:async()=>options.status??"ready",publish:async id=>{if(options.failAt===posted++)throw options.error;return{id:`post-${id}`,permalink:""};}};}

test("publication validates format, total caption length, media count/ratio/size",()=>{
  assert.equal(publishing.publicationProblems(settings).length,0);
  const instagram={...settings,account:{...settings.account,platform:"instagram"},platformFormat:"ig_carousel",parts:[],caption:"a".repeat(2199),hashtags:"tag",media:[{path:"a",mimeType:"image/png",width:1080,height:1350,size:100},{path:"b",mimeType:"image/png",width:100,height:100,size:9*1024*1024}]};
  assert.equal(publishing.publicationProblems(instagram).length,3);
  assert.equal(publishing.publicationProblems({...settings,parts:["one"]}).length,1);
});
test("successful chain persists receipts and reply parent before proceeding",async()=>{
  const api=provider(),states=[];
  const result=await publishing.executePublication(settings,{receipts:[]},api,async value=>states.push(value));
  assert.equal(result.receipts.length,3);assert.equal(states.length,9);
  assert.equal(states[1].container.phase,"publishing");
  assert.equal(api.calls[1].parent,result.receipts[0].id);
  assert.equal(api.calls[2].parent,result.receipts[1].id);
});
test("definitive mid-chain rejection retries only the unfinished portion",async()=>{
  const first=provider({failAt:1,error:new publishing.PublicationError("META_PUBLISH_REJECTED","rejected")});let checkpoint;
  await assert.rejects(publishing.executePublication(settings,{receipts:[]},first,async state=>{checkpoint=state;}));
  assert.equal(checkpoint.receipts.length,1);assert.equal(checkpoint.container.phase,"created");
  const retry=provider();const result=await publishing.executePublication(settings,checkpoint,retry,async()=>{});
  assert.equal(result.receipts.length,3);assert.equal(retry.calls.length,1);assert.equal(retry.calls[0].index,2);
});
test("ambiguous publish or lost persistence cannot trigger another publication",async()=>{
  let checkpoint;const first=provider({failAt:0,error:Error("network")});
  await assert.rejects(publishing.executePublication(settings,{receipts:[]},first,async state=>{checkpoint=state;}));
  const retry=provider();await assert.rejects(publishing.executePublication(settings,checkpoint,retry,async()=>{}),error=>error.code==="PUBLISH_RESULT_UNCERTAIN");assert.equal(retry.calls.length,0);
  let posted=0;await assert.rejects(publishing.executePublication(settings,{receipts:[]},{...provider(),publish:async()=>{posted++;return{id:"x",permalink:""};}},async state=>{if(state.container?.phase==="publishing")throw Error("db unavailable");}));assert.equal(posted,0);
});
test("expired containers clear only pending state and processing containers never publish",async()=>{
  let checkpoint;await assert.rejects(publishing.executePublication(settings,{receipts:[{id:"kept",permalink:""}]},provider({status:"expired"}),async state=>{checkpoint=state;}),error=>error.code==="PUBLISH_CONTAINER_EXPIRED");
  assert.equal(checkpoint.receipts[0].id,"kept");assert.equal(checkpoint.container,undefined);
  await assert.rejects(publishing.executePublication(settings,{receipts:[]},provider({status:"processing"}),async()=>{}),error=>error.code==="PUBLISH_MEDIA_PROCESSING");
});

const service=await moduleOf("lib/server/channel-publication.ts",{"node:crypto":crypto,"@/lib/http":{ApiError},"@/lib/channel-publishing":publishing,"@/lib/supabase/server":{},"./meta-oauth":{authorizeMetaConnection:async()=>({}),assertMetaModeMatches:()=>{},metaMode:()=>"live"},"./meta-publishing":{}});
test("approval binds source version, text, target channel and needs-recheck flag",()=>{
  const row={title:"title",description:"text",parent_id:"source",metadata:{channelWorkflowVersion:1,needsRecheck:false}};
  row.metadata.publicationApproval={actorId:"person",signature:service.publicationSignature(row,settings,2)};
  service.assertPublicationApproval(row,settings,2);
  for(const change of [{title:"changed"},{metadata:{...row.metadata,needsRecheck:true}},{metadata:{...row.metadata,channelWorkflowVersion:undefined}}])assert.throws(()=>service.assertPublicationApproval({...row,...change},settings,2));
  assert.throws(()=>service.assertPublicationApproval(row,settings,3));
  assert.throws(()=>service.assertPublicationApproval(row,{...settings,account:{...settings.account,ownerId:"different"}},2));
});
test("live dispatch is locked before any record/storage/provider side effects",async()=>{
  await assert.rejects(service.publishChannelRecord({}, {metadata:settings,status:"ready"}),error=>error.code==="LIVE_PUBLISH_NOT_RELEASED");
  const source=await read("lib/server/channel-publication.ts");assert.match(source,/actor\.supabase\.from\("os_records"\)\.update/);
  assert.doesNotMatch(source,/createServiceSupabase\(\)\.from\("os_records"\)\.update/);
});
test("cron defaults off, authenticates first and only reminds instead of publishing",async()=>{
  let calls=0;const env={CRON_SECRET:"test-cron"};
  const route=await moduleOf("app/api/v1/content/channel-sync/route.ts",{"next/server":{NextResponse:Response},"@/lib/http":{ApiError,apiErrorResponse:error=>Response.json({code:error.code},{status:error.status??500})},"@/lib/server/auth":{safeSecretMatch:(a,b)=>a===b},"@/lib/server/channel-metrics":{syncChannelMetrics:async()=>({metrics:0})},"@/lib/server/channel-comments":{syncChannelComments:async()=>({comments:0})},"@/lib/server/channel-sync":{syncChannelReminders:async()=>{calls++;return{notifications:1};}}},{process:{env},Response});
  assert.equal((await route.GET(new Request("https://example.com"))).status,401);
  const request=new Request("https://example.com",{headers:{authorization:"Bearer test-cron"}});
  assert.equal((await(await route.GET(request)).json()).enabled,false);assert.equal(calls,0);
  env.CHANNEL_SYNC_ENABLED="true";env.NEXT_PUBLIC_DEMO_MODE="true";
  assert.equal((await(await route.GET(request)).json()).enabled,false);assert.equal(calls,0);
  env.NEXT_PUBLIC_DEMO_MODE="false";assert.equal((await(await route.GET(request)).json()).enabled,true);assert.equal(calls,1);
  const source=await read("lib/server/channel-sync.ts");assert.doesNotMatch(source,/publishChannelRecord|metaPublishProvider|\.from\([^)]*\)\.update\(/);assert.match(source,/external_chat_id\)===String\(row.external_user_id/);
});
test("sharing revoked routes due reminders only to the owner",async()=>{
  const api=await moduleOf("lib/server/channel-sync.ts",{"node:crypto":crypto,"@/lib/http":{ApiError},"@/lib/supabase/server":{}});
  const owner=settings.account.ownerId,other="00000000-0000-4000-8000-000000000002",row={metadata:{account:{ownerId:owner},scheduledBy:other}};
  assert.deepEqual(Array.from(api.channelReminderRecipients(row,false)),[owner]);assert.deepEqual(Array.from(api.channelReminderRecipients(row,true)),[owner,other]);
});

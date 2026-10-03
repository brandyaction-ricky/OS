import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";
const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
async function moduleOf(path,deps,globals={}){const source=ts.transpileModule(await read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,mod={exports:{}};runInNewContext(`(function(require,module,exports){${source}\n})`,{...globals})(name=>{if(!(name in deps))throw Error(name);return deps[name];},mod,mod.exports);return mod.exports;}
const rules=await moduleOf("lib/content-comments.ts",{});
test("comment collection deduplicates external IDs and restricts Threads nested hiding",()=>{
  assert.equal(rules.uniqueComments([{externalId:"one",text:"a"},{externalId:"one",text:"b"},{externalId:"two",text:"c"}]).length,2);
  assert.equal(rules.mayHideComment("threads",false),false);assert.equal(rules.mayHideComment("threads",true),true);assert.equal(rules.mayHideComment("instagram",false),true);
});
test("generic and AI record writes may edit only reply drafts, never identity/handled state",async()=>{
  const current={metadata:{externalId:"kept",connectionOwnerId:"owner",topLevel:false}};
  assert.equal(rules.isCommentDraftPatch(current,{id:"x",expectedVersion:1,metadata:{...current.metadata,replyDraft:"초안"}}),true);
  for(const patch of [{status:"replied",metadata:{...current.metadata,replyDraft:"초안"}},{metadata:{...current.metadata,topLevel:true,replyDraft:"초안"}},{metadata:{...current.metadata,handledBy:"someone",replyDraft:"초안"}},{metadata:{...current.metadata,replyDraft:"a".repeat(501)}}])assert.equal(rules.isCommentDraftPatch(current,patch),false);
  for(const file of ["app/api/v1/records/route.ts","app/api/v1/agent-records/route.ts"]){const source=await read(file);assert.match(source,/content_comment.*!isCommentDraftPatch/);assert.equal((source.match(/CONTENT_COMMENT_API_REQUIRED/g)??[]).length,3);}
});
test("moderation denies non-shared colleagues before any write and records mock handler",async()=>{
  let shared=false,writes=0,mode="mock";const connection={owner_id:"owner",platform:"threads"};
  const row={id:"comment",version:1,status:"unanswered",metadata:{platform:"threads",connectionOwnerId:"owner",topLevel:true}};
  const db={from:()=>{let change;const chain={update:value=>{writes++;change=value;return chain;},eq:()=>chain,select:()=>chain,maybeSingle:async()=>({data:{...row,...change,version:2},error:null})};return chain;}};
  const api=await moduleOf("lib/server/channel-comments.ts",{"node:crypto":crypto,"@/lib/http":{ApiError},"@/lib/content-comments":rules,"@/lib/supabase/server":{},"./meta-collection":{},"./meta-oauth":{authorizeMetaConnection:async actor=>{if(actor.id!=="owner"&&!shared)throw new ApiError(403,"CHANNEL_ACCESS_DENIED","");return connection;},assertMetaModeMatches:()=>{},metaMode:()=>mode}});
  const actor={id:"colleague",supabase:db};
  await assert.rejects(api.moderateChannelComment(actor,row,"reply","답글"),error=>error.status===403);assert.equal(writes,0);
  shared=true;const replied=await api.moderateChannelComment(actor,row,"reply","답글");assert.equal(replied.status,"replied");assert.equal(replied.metadata.handledBy,"colleague");assert.equal(replied.metadata.mockAction,true);
  await assert.rejects(api.moderateChannelComment(actor,{...row,metadata:{...row.metadata,topLevel:false}},"hide",""),error=>error.code==="THREADS_ROOT_ONLY");assert.equal(writes,1);
  mode="live";await assert.rejects(api.moderateChannelComment(actor,row,"reply","답글"),error=>error.code==="LIVE_MODERATION_NOT_RELEASED");assert.equal(writes,1);
  assert.equal(api.collectedCommentId("threads","owner","one"),api.collectedCommentId("threads","owner","one"));assert.notEqual(api.collectedCommentId("threads","owner","one"),api.collectedCommentId("threads","other","one"));
});
test("mock collection never calls a provider and safe reads do not follow next URLs",async()=>{
  let calls=0;const collector=await moduleOf("lib/server/meta-collection.ts",{"@/lib/http":{ApiError},"@/lib/content-comments":rules,"./meta-oauth":{assertMetaModeMatches:()=>{},metaMode:()=>"mock"}},{fetch:()=>{calls++;throw Error("unexpected");}});
  const result=await collector.collectPostComments({},"post");assert.equal(result.rows.length,1);assert.equal(calls,0);
  const source=await read("lib/server/meta-collection.ts");assert.doesNotMatch(source,/fetch\([^)]*paging|fetch\([^)]*next/);
});
test("ingestion uses atomic ignore-duplicate writes and never resets handled records",async()=>{
  const source=await read("lib/server/channel-comments.ts");assert.match(source,/onConflict:"id",ignoreDuplicates:true/);assert.match(source,/metadata->>publishedAt/);assert.match(source,/14\*86400000/);
  const route=await read("app/api/v1/content/comments/route.ts");assert.match(route,/input\.mode==="queue".*queued:true/);assert.match(route,/authenticateRequest\(request\)/);assert.match(route,/input\.confirm!==true/);
});

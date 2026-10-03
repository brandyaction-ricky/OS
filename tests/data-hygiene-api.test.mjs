import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as zod from 'zod';
import * as policy from '../lib/agent-key-policy.ts';
import * as entities from '../lib/html-entities.ts';
import * as access from '../lib/server/document-access.ts';
class ApiError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
const http={ ApiError, parseJson:request=>request.json(), apiErrorResponse:error=>Response.json({error:{code:error.code}},{status:error.status??500}) };
async function load(path,modules,extras={}) {
 const code=ts.transpileModule(await readFile(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const compiled={exports:{}}; const available={'next/server':{NextResponse:Response},'zod':zod,'node:crypto':crypto,'@/lib/http':http,...modules};
 runInNewContext(code,{module:compiled,exports:compiled.exports,require:id=>{assert.ok(id in available,id);return available[id];},Date,URL,URLSearchParams,AbortSignal,Response,...extras});return compiled.exports;
}
const id='00000000-0000-4000-8000-000000000111', org='00000000-0000-4000-8000-000000000222';
function request(method,body,path='/api/v1/agent-keys') {return new Request('http://localhost'+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
test('new key issuance requires a future expiration and preserves explicit permission tiers', async()=>{
 const writes=[];
 const db={from(){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{id,is_active:true}}),insert(value){writes.push(value);return q;},single:async()=>({data:{id},error:null})};return q;}};
 const route=await load('app/api/v1/agent-keys/route.ts',{'@/lib/agent-key-policy':policy,'@/lib/server/auth':{authenticateRequest:async()=>({id,role:'admin'})},'@/lib/server/organization':{getDefaultOrganization:async()=>({id:org})},'@/lib/supabase/server':{createServiceSupabase:()=>db}});
 for(const expiresAt of [undefined,null,'2020-01-01T00:00:00Z','invalid']) assert.equal((await route.POST(request('POST',{name:'fixture',expiresAt}))).status,400);
 assert.equal(writes.length,0);
 for(const level of ['read','draft','write']) {
  assert.equal((await route.POST(request('POST',{name:'fixture',access:level,expiresAt:'2099-01-01T00:00:00Z'}))).status,201);
  const saved=writes.at(-1);assert.equal(saved.enforce_write_statuses,true);assert.deepEqual(Array.from(saved.allowed_statuses),policy.agentKeyPolicy(level).allowedStatuses);assert.ok(!('token' in saved));
 }
});
test('draft key cannot use either document edit or sync to downgrade and overwrite a canonical',async()=>{
 const actor={type:'agent',id,organizationId:org,ownerId:id,allowedStatuses:['draft','team','canonical'],writableStatuses:['draft','team'],scopes:['knowledge.write']}; let writes=0;
 const current={id,source_ref:'fixture.md',content_hash:'different',current_version:1,status:'canonical',owner_id:id};
 const db={from(){const q={select(){return q;},eq(){return q;},in(){return q;},single:async()=>({data:current}),then:resolve=>Promise.resolve({data:[current],error:null}).then(resolve),update(){writes++;return q;},insert(){writes++;return q;}};return q;},rpc:async()=>{writes++;return {data:current};}};
 const modules={'@/lib/server/document-access':access,'@/lib/server/auth':{authenticateRequest:async()=>actor,requireAgentScope(){}},'@/lib/server/organization':{assertOrganization:async()=>{}},'@/lib/supabase/server':{createServiceSupabase:()=>db},'@/lib/server/indexing':{indexDocument:async()=> 'ready'}};
 const edit=await load('app/api/v1/knowledge-documents/route.ts',modules);
 assert.equal((await edit.PATCH(request('PATCH',{organizationId:org,documentId:id,title:'replacement'}))).status,403);
 const sync=await load('app/api/v1/knowledge/sync/route.ts',modules);
 assert.equal((await sync.POST(request('POST',{documents:[{sourceRef:'fixture.md',title:'replacement',content:'changed',status:'draft'}]}))).status,403);
 assert.equal(writes,0);
});
test('own YouTube results use the connected channel id and exclude other channels',async()=>{
 const calls=[];let connected=true;
 const route=await load('app/api/v1/youtube/search/route.ts',{'@/lib/html-entities':entities,'@/lib/server/auth':{authenticateRequest:async()=>({id})},'@/lib/server/youtube-oauth':{youtubeConnectionStatus:async()=>({connected,channelId:connected?'UC_OWN':null})}},{process:{env:{YOUTUBE_API_KEY:'fixture'}},fetch:async url=>{calls.push(new URL(url));return Response.json(url.includes('/search?')?{items:[{id:{videoId:'own'},snippet:{channelId:'UC_OWN',title:'&quot;제목&quot; &amp; &#39;근거&#39;'}},{id:{videoId:'other'},snippet:{channelId:'UC_OTHER'}}]}:{items:[]});}});
 const res=await route.GET(request('GET',null,'/api/v1/youtube/search?own=true'));
 assert.equal(res.status,200);const body=await res.json();assert.deepEqual(body.items.map(item=>item.id),['own']);assert.equal(body.items[0].title,'"제목" & \'근거\'');assert.equal(calls[0].searchParams.get('channelId'),'UC_OWN');assert.equal(calls[0].searchParams.has('q'),false);
 connected=false;calls.length=0;assert.equal((await route.GET(request('GET',null,'/api/v1/youtube/search?own=true'))).status,409);assert.equal(calls.length,0);
});

test('legacy keys remain usable before migration but unrelated database errors fail closed', async()=>{
 let missing=true; let lookups=0;
 const db={from(table){let fields='';const q={select(value){fields=value;return q;},eq(){return q;},update(){return q;},then:resolve=>Promise.resolve({error:null}).then(resolve),maybeSingle:async()=>{
  if(table==='os_profiles')return {data:{id,is_active:true}};
  lookups++;
  if(fields.includes('enforce_write_statuses'))return {data:null,error:{code:missing?'42703':'XX000',message:'enforce_write_statuses unavailable'}};
  return {data:{id,active:true,owner_user_id:id,scopes:['knowledge.read','knowledge.write'],allowed_statuses:['team','canonical']},error:null};
 }};return q;}};
 const auth=await load('lib/server/auth.ts',{'@/lib/agent-key-policy':policy,'./document-access':access,'@/lib/http':{...http,getBearerToken:()=> 'bos_pat_fixture'},'@/lib/supabase/server':{createServiceSupabase:()=>db}},{Buffer});
 const actor=await auth.authenticateRequest(request('GET'),{allowAgent:true});
 assert.ok(actor.writableStatuses.includes('canonical'));assert.equal(lookups,2);
 missing=false;lookups=0;
 await assert.rejects(auth.authenticateRequest(request('GET'),{allowAgent:true}),error=>error.code==='INVALID_AGENT_KEY');assert.equal(lookups,1);
});

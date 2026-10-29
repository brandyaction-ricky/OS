import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { z } from 'zod';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
class ApiError extends Error { constructor(status,code,message){super(message);Object.assign(this,{status,code});} }
async function moduleOf(path,deps,globals={}){const compiled=ts.transpileModule(await read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};runInNewContext(`(function(require,module,exports){${compiled}\n})`,{structuredClone,Buffer,Date,JSON,...globals})(name=>{if(!(name in deps))throw Error(name);return deps[name];},mod,mod.exports);return mod.exports;}
const publishing=await moduleOf('lib/channel-publishing.ts',{zod:{z}});
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000003';
const actor={type:'user',id:owner,ownerId:owner};
const posts=['첫 줄\n\n본문은 여기.','관점\n구체적인 장면.','적용 질문.'];
function source(){return{id,owner_id:owner,version:4,status:'ready',title:'제목',description:'',parent_id:'topic',metadata:{space:'personal',channel:'threads',posts:[...posts]}};}
async function setup(options={}){
 const env={THREADS_AUTOMATION_PUBLISH_ENABLED:'true',...options.env};
 const row=options.source??source(),mode=options.mode??'mock';
 const connection={owner_id:owner,platform:'threads',external_account_id:'fake-account',account_name:'test',account_type:mode==='mock'?'MOCK':'THREADS',updated_at:'2026-10-29T00:00:00Z',status:'connected',team_shared:false,token_expires_at:new Date(Date.now()+86400000).toISOString(),...options.connection};
 let run=options.run??null,created=0,published=0;const calls=[],rpcCalls=[];
 const db={from(table){const query={select(){return this;},eq(){return this;},in(){return this;},or(){return this;},order(){return this;},limit(){return this;},maybeSingle(){return this;},then(resolve,reject){let result;
 if(table==='os_threads_publication_runs')result=options.schemaMissing?{error:{code:'42P01'}}:{data:run};
 else if(table==='os_meta_connections')result={data:options.noConnection?[]:[connection]};
 else if(table==='os_profiles')result=options.profileLookupError?{error:{code:'DB_UNAVAILABLE'}}:{data:[{id:connection.owner_id,is_active:!options.inactiveOwner}]};
 else if(table==='os_content_review_log')result={data:options.noReview?null:{content_version:3,result:'ready'}};
 else if(table==='os_record_events')result={data:{snapshot:options.approved??row}};
 else throw Error(table);return Promise.resolve(result).then(resolve,reject);}};return query;},
 async rpc(name,args){rpcCalls.push({name,args});if(options.rpcError===name)return{error:{code:'PT409',message:options.rpcErrorMessage??'THREADS_REVIEW_REQUIRED'}};
 if(name==='os_threads_publication_claim'){
 if(options.claimError)return{error:{code:'PT409',message:options.claimError}};
 if(run?.state==='published')return{data:structuredClone(run)};
 if(run?.state==='running'||run?.state==='uncertain')return{error:{code:'PT409',message:'THREADS_RESULT_UNCERTAIN'}};
 if(row.status!=='ready'||args.p_expected_version!==row.version)return{error:{code:'PT409',message:'THREADS_REVIEW_REQUIRED'}};
 if(run&&run.checkpoint.receipts.length&&(args.p_account_owner!==run.account_owner_id||args.p_external_account_id!==run.external_account_id))return{error:{code:'PT409',message:'THREADS_SNAPSHOT_CHANGED'}};
 run={publication_id:id,owner_id:owner,source_version:4,review_id:'review',posts:[...posts],account_owner_id:connection.owner_id,external_account_id:connection.external_account_id,account_name:'test',mode,state:'running',operation_id:'operation',checkpoint:run?.checkpoint??{receipts:[]},error_code:null};
 }else if(name==='os_threads_publication_checkpoint')run.checkpoint=structuredClone(args.p_checkpoint);
 else if(name==='os_threads_publication_finish'){run.state=args.p_error_code?(args.p_uncertain?'uncertain':'retryable'):(mode==='mock'?'mock_complete':'published');run.error_code=args.p_error_code??null;}
 else throw Error(name);return{data:structuredClone(run)};}};
 const provider={create:async(index,parent)=>{calls.push({index,parent,text:posts[index]});return`container-${created++}`;},inspect:async()=>options.processing?'processing':'ready',publish:async container=>{if(options.failAt===published++)throw options.publishError??new publishing.PublicationError('META_PUBLISH_REJECTED','rejected');return{id:`post-${container}`,permalink:''};}};
 const mod=await moduleOf('lib/server/threads-publication.ts',{
 'node:crypto':{createHash,randomUUID:()=> 'operation'},'@/lib/http':{ApiError},'@/lib/channel-publishing':publishing,
 '@/lib/threads-posts':{threadsPostsProblem:(value)=>!Array.isArray(value)||!value.length||value.length>30||value.some(text=>typeof text!=='string'||!text.trim()||Array.from(text).length>500)?'invalid':null},
 '@/lib/supabase/server':{createServiceSupabase:()=>db},'./content-automation-v07':{assertHumanOwner:a=>{if(a.type!=='user')throw new ApiError(403,'USER_SESSION_REQUIRED','human');return a.ownerId;},getPersonalRecord:async(a,target)=>{if(target!==id||a.ownerId!==owner)throw new ApiError(404,'AUTOMATION_NOT_FOUND','own');return row;}},
 './meta-oauth':{metaMode:()=>mode,assertMetaModeMatches:()=>{if((connection.account_type==='MOCK')!==(mode==='mock'))throw new ApiError(409,'META_MODE_MISMATCH','mode');},authorizeMetaConnection:async(a,selected)=>{if(selected!==owner&&!connection.team_shared)throw new ApiError(403,'CHANNEL_ACCESS_DENIED','account');return connection;},publicMetaConnection:c=>({ownerId:c.owner_id,platform:'threads',accountName:c.account_name,mock:c.account_type==='MOCK'})},
 './meta-publishing':{metaPublishProvider:(_c,settings)=>{assert.deepEqual(Array.from(settings.parts),posts);return provider;}}
 },{process:{env}});
 return{mod,row,calls,rpcCalls,getRun:()=>run,getPublished:()=>published};
}
const input={expectedVersion:4,accountOwnerId:owner,expectedAccountKey:createHash('sha256').update(JSON.stringify([owner,'fake-account','2026-10-29T00:00:00Z','test'])).digest('hex'),confirm:true};
test('GET is fail-closed before migration and does not fail the editor',async()=>{const h=await setup({schemaMissing:true});const result=await h.mod.readThreadsPublicationStatus(actor,id);assert.equal(result.ready,false);assert.match(result.reason,/저장소/);assert.equal(h.rpcCalls.length,0);});
test('all external dispatch defaults off, including separate live gate',async()=>{for(const options of [{env:{THREADS_AUTOMATION_PUBLISH_ENABLED:undefined}},{mode:'live'}]){const h=await setup(options);await assert.rejects(h.mod.publishPersonalThreads(actor,id,input),error=>error.code==='THREADS_PUBLICATION_DISABLED');assert.equal(h.calls.length,0);assert.equal(h.rpcCalls.length,0);}});
test('agent, other owner, wrong target, no explicit confirm cannot dispatch',async()=>{const h=await setup();for(const [a,target,body]of [[{...actor,type:'agent'},id,input],[{...actor,ownerId:other},id,input],[actor,other,input],[actor,id,{...input,confirm:false}]])await assert.rejects(h.mod.publishPersonalThreads(a,target,body));assert.equal(h.calls.length,0);assert.equal(h.rpcCalls.length,0);});
test('fresh approval and account permission are mandatory',async()=>{for(const options of [{source:{...source(),status:'draft'}},{claimError:'THREADS_REVIEW_REQUIRED'},{claimError:'THREADS_SNAPSHOT_CHANGED'},{connection:{token_expires_at:'2000-01-01'}}]){const h=await setup(options);await assert.rejects(h.mod.publishPersonalThreads(actor,id,input));assert.equal(h.calls.length,0);}const h=await setup();await assert.rejects(h.mod.publishPersonalThreads(actor,id,{...input,accountOwnerId:other}),e=>e.code==='CHANNEL_ACCESS_DENIED');});
test('GET readiness checks approved text, not just ready status',async()=>{for(const options of [{noReview:true},{approved:{...source(),metadata:{posts:['changed']}}}]){const h=await setup(options);assert.equal((await h.mod.readThreadsPublicationStatus(actor,id)).ready,false);assert.equal(h.calls.length,0);}});
test('mock chain preserves paragraphs and links each reply to the preceding receipt',async()=>{const h=await setup();const result=await h.mod.publishPersonalThreads(actor,id,input);assert.equal(result.publication.state,'mock_complete');assert.equal(result.publication.publishedCount,3);assert.equal(h.row.status,'ready');assert.deepEqual(h.calls.map(x=>x.parent),[undefined,'post-container-0','post-container-1']);assert.deepEqual(Array.from(result.publication.posts),posts);assert.equal(JSON.stringify(result).includes('external_account_id'),false);});
test('definitive partial failure keeps receipts then retries unfinished part only',async()=>{const h=await setup({failAt:1});await assert.rejects(h.mod.publishPersonalThreads(actor,id,input),e=>e.code==='THREADS_PUBLICATION_PAUSED');assert.equal(h.getRun().state,'retryable');assert.equal(h.getRun().checkpoint.receipts.length,1);const result=await h.mod.publishPersonalThreads(actor,id,input);assert.equal(result.publication.publishedCount,3);assert.deepEqual(h.calls.map(x=>x.index),[0,1,2]);});
test('ambiguous response preserves lock, a second click cannot republish',async()=>{const h=await setup({failAt:0,publishError:new publishing.PublicationError('META_REQUEST_UNCERTAIN','network')});await assert.rejects(h.mod.publishPersonalThreads(actor,id,input),e=>e.code==='THREADS_RESULT_UNCERTAIN');assert.equal(h.getRun().state,'uncertain');const before=h.calls.length;await assert.rejects(h.mod.publishPersonalThreads(actor,id,input));assert.equal(h.calls.length,before);assert.equal((await h.mod.readThreadsPublicationStatus(actor,id)).ready,false);});
test('checkpoint persistence failure prevents publish and leaves reconciliation required',async()=>{const h=await setup({rpcError:'os_threads_publication_checkpoint'});await assert.rejects(h.mod.publishPersonalThreads(actor,id,input),e=>e.code==='THREADS_RESULT_UNCERTAIN');assert.equal(h.getPublished(),0);assert.equal(h.getRun().state,'uncertain');});
test('processing container pauses without calling publish',async()=>{const h=await setup({processing:true});await assert.rejects(h.mod.publishPersonalThreads(actor,id,input),e=>e.code==='THREADS_PUBLICATION_PAUSED');assert.equal(h.getPublished(),0);assert.equal(h.getRun().checkpoint.container.phase,'created');});
test('completed live run is idempotent with no additional provider calls',async()=>{const h=await setup({mode:'live',env:{META_LIVE_PUBLISH_ENABLED:'true'},run:{state:'published',mode:'live',posts,account_owner_id:owner,account_name:'test',checkpoint:{receipts:[{id:'existing',permalink:''}]}}});const result=await h.mod.publishPersonalThreads(actor,id,input);assert.equal(result.publication.state,'published');assert.equal(h.calls.length,0);});

test('safe stale attempts are omitted so approval preview matches the new source',async()=>{
 for(const run of [
  {state:'retryable',mode:'mock',source_version:3,posts:['old'],checkpoint:{receipts:[]}},
  {state:'mock_complete',mode:'live',source_version:4,posts,checkpoint:{receipts:[]}},
  {state:'mock_complete',mode:'mock',source_version:3,posts:['old'],checkpoint:{receipts:[{id:'mock',permalink:''}]}}
 ]){const h=await setup({run});const result=await h.mod.readThreadsPublicationStatus(actor,id);assert.equal(result.publication,null);assert.equal(result.ready,true);}
});
test('live partial and uncertain snapshots remain visible and frozen even if source differs',async()=>{
 for(const state of ['retryable','uncertain']){const h=await setup({mode:'live',env:{META_LIVE_PUBLISH_ENABLED:'true'},run:{state,mode:'live',source_version:3,posts:['old'],account_owner_id:owner,external_account_id:'fake-account',account_name:'test',checkpoint:{receipts:[{id:'published',permalink:''}]}}});
 const result=await h.mod.readThreadsPublicationStatus(actor,id);assert.deepEqual(Array.from(result.publication.posts),['old']);assert.equal(result.ready,false);}
});

test('official provider sends text containers then publishes, and preserves reply chain',async()=>{
 const calls=[];let container=0,publish=0;
 const providerModule=await moduleOf('lib/server/meta-publishing.ts',{
 'node:crypto':{},'@/lib/http':{ApiError},'@/lib/channel-publishing':publishing,
 './meta-oauth':{assertMetaModeMatches:()=>{},metaMode:()=> 'live',metaAccessToken:()=> 'test-only-token'}
 },{URLSearchParams,AbortSignal,process:{env:{}},fetch:async(url,options)=>{
  const body=options.body?Object.fromEntries(options.body.entries()):null;calls.push({url,method:options.method,body});
  if(options.method==='POST'&&url.endsWith('/threads'))return Response.json({id:`container-${container++}`});
  if(options.method==='POST'&&url.endsWith('/threads_publish'))return Response.json({id:`post-${publish++}`});
  if(url.includes('fields=status'))return Response.json({status:'FINISHED'});
  if(url.includes('fields=permalink'))return Response.json({permalink:'https://www.threads.com/@test/post/fake'});
  throw Error('unexpected mocked request');
 }});
 const settings={account:{platform:'threads',ownerId:owner},platformFormat:'threads_chain',parts:posts,caption:'',hashtags:'',firstComment:'',replyControl:'everyone',media:[],publishMode:'now'};
 await publishing.executePublication(settings,{receipts:[]},providerModule.metaPublishProvider({platform:'threads',external_account_id:'test-account'},settings,id,[]),async()=>{});
 const creates=calls.filter(call=>call.method==='POST'&&call.url.endsWith('/threads'));
 assert.deepEqual(creates.map(call=>call.body.text),posts);
 assert.deepEqual(creates.map(call=>call.body.reply_to_id),[undefined,'post-0','post-1']);
 assert.equal(creates.every(call=>call.body.media_type==='TEXT'&&call.body.auto_publish_text===undefined),true);
 assert.equal(calls.filter(call=>call.method==='POST'&&call.url.endsWith('/threads_publish')).length,3);
 assert.equal(calls.every(call=>call.url.startsWith('https://graph.threads.net/')),true);
});
test('provider classifies quota rejection as definite, timeout/server error as uncertain',async()=>{
 for(const [status,expected]of [[429,'META_PUBLISH_REJECTED'],[503,'META_REQUEST_UNCERTAIN']]){
 const providerModule=await moduleOf('lib/server/meta-publishing.ts',{'node:crypto':{},'@/lib/http':{ApiError},'@/lib/channel-publishing':publishing,'./meta-oauth':{assertMetaModeMatches:()=>{},metaMode:()=> 'live',metaAccessToken:()=> 'test-only-token'}},{URLSearchParams,AbortSignal,process:{env:{}},fetch:async()=>Response.json({error:{message:'not emitted'}},{status})});
 await assert.rejects(providerModule.metaPublishProvider({platform:'threads',external_account_id:'test'}, {platformFormat:'threads_text',caption:'text',hashtags:''},id,[]).publish('container'),error=>error.code===expected);
 }
});
test('route rejects foreign origin, invalid confirmation and agent sessions; verifies session before POST',async()=>{
 let invoked=0,verify=false;let authenticated=actor;
 const route=await moduleOf('app/api/v1/content/automation/threads-publication/[id]/route.ts',{
 'next/server':{NextResponse:Response},zod:{z,ZodError:z.ZodError},'@/lib/http':{ApiError,apiErrorResponse:e=>Response.json({code:e.code},{status:e.status??500}),parseJson:request=>request.json()},
 '@/lib/server/auth':{authenticateRequest:async(_request,options)=>{verify=options?.verifySession===true;return authenticated;}},
 '@/lib/server/content-automation-v07':{assertHumanOwner:a=>{if(a.type!=='user')throw new ApiError(403,'USER_SESSION_REQUIRED','human');},assertSameOrigin:request=>{if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'ORIGIN_FORBIDDEN','origin');}},
 '@/lib/server/threads-publication':{readThreadsPublicationStatus:async()=>({ready:true}),publishPersonalThreads:async()=>{invoked++;return{ready:false};}}
 },{Response,URL});
 const request=(body,origin='https://os.test')=>new Request(`https://os.test/api/v1/content/automation/threads-publication/${id}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const params={params:Promise.resolve({id})};
 assert.equal((await route.POST(request(input,'https://evil.test'),params)).status,403);
 assert.equal((await route.POST(request({...input,confirm:false}),params)).status,422);
 authenticated={...actor,type:'agent'};assert.equal((await route.POST(request(input),params)).status,403);
 authenticated=actor;assert.equal((await route.POST(request(input),params)).status,200);assert.equal(verify,true);assert.equal(invoked,1);
});

test('account fingerprint changes require confirmation again before claim or provider use',async()=>{
 for(const connection of [{external_account_id:'replacement'},{updated_at:'2026-10-30T00:00:00Z'},{account_name:'renamed'}]){
 const h=await setup({connection});await assert.rejects(h.mod.publishPersonalThreads(actor,id,input),e=>e.code==='THREADS_ACCOUNT_CHANGED');assert.equal(h.calls.length,0);assert.equal(h.rpcCalls.length,0);
 }
});

test('GET omits an inactive shared owner and never reports it ready',async()=>{
 const h=await setup({connection:{owner_id:other,team_shared:true},inactiveOwner:true});
 const result=await h.mod.readThreadsPublicationStatus(actor,id);
 assert.equal(result.ready,false);assert.equal(result.connections.length,0);assert.match(result.reason,/소유자/);assert.equal(h.rpcCalls.length,0);
});
test('GET fails closed when owner active-state lookup fails',async()=>{
 const h=await setup({profileLookupError:true});const result=await h.mod.readThreadsPublicationStatus(actor,id);
 assert.equal(result.ready,false);assert.equal(result.connections.length,0);assert.match(result.reason,/이용 상태/);assert.equal(h.rpcCalls.length,0);
});

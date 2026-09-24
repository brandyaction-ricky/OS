import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import { graphView, changedLineRange } from '../lib/knowledge-graph-view.ts';
import { buildKnowledgeGraph, extractWikiLinks } from '../lib/knowledge-links.ts';
import * as importing from '../lib/knowledge-import.ts';
import * as diagnostics from '../lib/search-diagnostics.ts';
import * as relevance from '../lib/search-relevance.ts';

const document = (id, overrides={}) => ({id,title:id,folder:'Library',content_md:'content',status:'draft',owner_id:'owner',source_ref:null,current_version:1,...overrides});
class ApiError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
const http = {ApiError,parseJson:request=>request.json(),apiErrorResponse:error=>Response.json({error:{code:error.code??'INVALID_REQUEST',message:error.message}},{status:error.status??400})};
function moduleFor(path, modules, globals={}) {
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,require:name=>{if(!(name in modules))throw Error('Unexpected module '+name);return modules[name];},URL,Response,AbortSignal,console:{error(){}},process:{env:{}},...globals});
  return exports;
}

test('graph cap includes every neighbor of a high-degree center and leaves complete list available',()=>{
  const docs=[document('center',{content_md:Array.from({length:307},(_,i)=>`[[node${i}]]`).join(' ')}),...Array.from({length:307},(_,i)=>document('node'+i))];
  const graph=buildKnowledgeGraph(docs);
  for(const limit of [24,48,72,500]){
    const view=graphView(graph,'center','','',1,limit);
    assert.equal(view.nodes.length,Math.min(limit,72));assert.equal(view.matches.length,308);assert.ok(view.ids.has('center'));
  }
});
test('graph filters cannot retain unrelated selected nodes and depth is bounded',()=>{
  const graph=buildKnowledgeGraph([document('a',{content_md:'[[b]]'}),document('b',{content_md:'[[c]]'}),document('c'),document('outside',{folder:'Other'})]);
  assert.equal(graphView(graph,'a','','',1,72).nodes.length,2);
  assert.equal(graphView(graph,'a','','',2,72).nodes.length,3);
  assert.equal(graphView(graph,'a','missing','',2,72).nodes.length,0);
  assert.deepEqual(graphView(graph,'a','','Other',2,72).nodes.map(row=>row.id),['outside']);
});
test('broken links distinguish missing and ambiguous, exclude image embeds and resolve after a fix',()=>{
  const source=document('source',{folder:'Third',content_md:'![[picture.png]] [[Same]] [[Missing]]'});
  const graph=buildKnowledgeGraph([source,document('one',{title:'Same',folder:'First'}),document('two',{title:'Same',folder:'Second'})]);
  assert.deepEqual(extractWikiLinks(source.content_md),['Same','Missing']);
  assert.equal(graph.broken[0].reason,'ambiguous');assert.equal(graph.broken[0].candidates.length,2);assert.equal(graph.broken[1].reason,'missing');
  assert.equal(buildKnowledgeGraph([{...source,content_md:'[[First/Same]]'},document('one',{title:'Same',folder:'First'})]).broken.length,0);
});
test('search excerpts include a distant actual hit and the containing heading',()=>{
  const body='# Intro\n'+ 'plain text '.repeat(150)+'\n## Answer\n'+ 'target answer '+ 'context '.repeat(150);
  const excerpt=diagnostics.matchingExcerpt(body,['target']);assert.match(excerpt.text,/target answer/);assert.equal(excerpt.heading,'Answer');assert.ok(excerpt.text.startsWith('…'));assert.ok(excerpt.text.length<=702);
});
test('version comparison handles insertions, removals, CRLF and unchanged content',()=>{
  assert.equal(changedLineRange('a\r\nb','a\nb').same,true);
  assert.deepEqual(changedLineRange('a\nb','a\nx\nb'),{start:2,removed:[],added:['x'],same:false});
  assert.deepEqual(changedLineRange('a\nx\nb','a\nb').removed,['x']);
  const large='x\n'.repeat(100000);assert.equal(changedLineRange(large,large+'end').start,100001);
});
test('imports compare normalized content and never reject different content solely by filename',async()=>{
  const same=await importing.importContentHash('\uFEFF# Title\r\nbody\n');assert.equal(same,await importing.importContentHash('# Title\nbody'));
  const different=await importing.importContentHash('# Title\nother');assert.notEqual(same,different);
  assert.equal(importing.defaultImportAction(different,[{sameContent:false}],new Set([same])),'create');
  assert.equal(importing.defaultImportAction(same,[{sameContent:true}],new Set()),'skip');
  assert.equal(importing.defaultImportAction(same,[],new Set([same])),'skip');
  assert.equal(importing.normalizeImportPath('Folder\\Note.md'),'Folder/Note.md');
  for(const path of ['../Note.md','/Note.md','Folder/../Note.md','Folder//Note.md'])assert.throws(()=>importing.normalizeImportPath(path));
});

function searchModule({rpcRows=[],rpcError=null,fallbackRows=[],fallbackError=null,embeddingError=null,configured=false}={}){
  let fallbackCalls=0;
  const builder={select(){return this;},in(){return this;},or(){return this;},order(){return this;},limit(){return this;},eq(){return this;},abortSignal(signal){assert.ok(signal);fallbackCalls++;return Promise.resolve({data:fallbackRows,error:fallbackError});},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
  const db={from:()=>builder,rpc:()=>({abortSignal(signal){assert.ok(signal);return Promise.resolve({data:rpcRows,error:rpcError});}})};
  const loaded=moduleFor('lib/server/search.ts',{'@/lib/http':http,'@/lib/search-diagnostics':diagnostics,'@/lib/search-relevance':relevance,'@/lib/supabase/server':{createServiceSupabase:()=>db},'./embeddings':{createEmbeddings:async(_text,timeout)=>{assert.equal(timeout,3000);if(embeddingError)throw embeddingError;return [[1]];},toPgVector:()=> '[1]'}},{process:{env:configured?{OPENAI_API_KEY:'synthetic'}:{}}});
  return {run:(mode='hybrid',topK=2)=>loaded.searchDocuments({type:'user',id:'owner',allowedStatuses:['canonical'],supabase:db},{query:'target',mode,topK,filters:{statuses:['canonical']}}),calls:()=>fallbackCalls};
}
const resultRow={document_id:'one',title:'target',chunk_text:'target result',status:'canonical',score:0.9};
test('full keyword results avoid an unnecessary fallback query',async()=>{
  const search=searchModule({rpcRows:[resultRow]});const result=await search.run('keyword',1);assert.equal(result.results.length,1);assert.equal(search.calls(),0);assert.equal(result.degraded,false);
});
test('unconfigured semantic search returns useful keyword results with an explicit reason',async()=>{
  const search=searchModule({rpcRows:[resultRow]});const result=await search.run('semantic',1);assert.equal(result.degradationReasons[0],'embeddings_unconfigured');assert.equal(result.results.length,1);
});
test('embedding timeout and search timeout report different causes',async()=>{
  const embedding=await searchModule({configured:true,embeddingError:new ApiError(504,'EMBEDDING_TIMEOUT','timeout'),rpcRows:[resultRow]}).run('hybrid',1);assert.equal(embedding.degradationReasons[0],'embedding_timeout');
  const search=await searchModule({rpcError:{code:'57014',message:'timeout'},fallbackRows:[document('fallback',{title:'target',content_md:'target'})]}).run('keyword');assert.equal(search.degradationReasons[0],'search_timeout');assert.equal(search.results[0].documentId,'fallback');
});
test('supplement failure preserves good results, complete search failure is not shown as zero matches',async()=>{
  const partial=await searchModule({rpcRows:[resultRow],fallbackError:{message:'offline'}}).run('keyword');assert.equal(partial.results.length,1);assert.equal(partial.degradationReasons[0],'supplement_failed');
  await assert.rejects(searchModule({rpcError:{message:'offline'},fallbackError:{message:'offline'}}).run('keyword'),error=>error.code==='SEARCH_FALLBACK_FAILED');
});

function previewModule(rows,{error=null,deny=false}={}){
  const db={from(){let field,values;return{select(){return this;},in(key,list){field=key;values=list;return this;},limit(limit){return Promise.resolve({data:rows.filter(row=>values.includes(row[field])).slice(0,limit),error});}};}};
  return moduleFor('app/api/v1/documents/import-preview/route.ts',{'next/server':{NextResponse:Response},zod,'@/lib/http':http,'@/lib/knowledge-import':importing,'@/lib/server/auth':{authenticateRequest:async()=>{if(deny)throw new ApiError(401,'AUTH_REQUIRED','Sign in');return{id:"owner",role:"member",supabase:db};}}});
}
const requestFor=files=>new Request('http://localhost/api/v1/documents/import-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({files})});
test('import preflight reads server candidates beyond the loaded client list and sends no body content back',async()=>{
  const hash=await importing.importContentHash('same');const api=previewModule([document('server-only',{title:'Note',source_ref:'Folder/Note.md',content_md:'same'}),document('other',{title:'Note',source_ref:'Other/Note.md',content_md:'different',owner_id:'other-owner'})]);
  const response=await api.POST(requestFor([{id:'file',path:'Folder/Note.md',title:'Note',hash}]));assert.equal(response.status,200);const body=await response.json();assert.equal(body.files[0].candidates.length,2);assert.equal(body.files[0].candidates[0].sameContent,true);assert.equal(body.files[0].candidates[1].sameContent,false);assert.equal(body.files[0].candidates[0].canUpdate,true);assert.equal(body.files[0].candidates[1].canUpdate,false);assert.ok(body.files[0].candidates.every(row=>!('content_md' in row)&&!('hash' in row)));
});
test('import preflight fails closed for authentication, DB failure, oversized candidate sets and traversal paths',async()=>{
  const probe={id:'file',path:'Note.md',title:'Note',hash:'a'.repeat(64)};
  assert.equal((await previewModule([],{deny:true}).POST(requestFor([probe]))).status,401);
  assert.equal((await previewModule([],{error:{message:'offline'}}).POST(requestFor([probe]))).status,503);
  assert.equal((await previewModule(Array.from({length:201},(_,i)=>document(String(i),{title:'Note'}))).POST(requestFor([probe]))).status,400);
  assert.equal((await previewModule([]).POST(requestFor([{...probe,path:'../Note.md'}]))).status,400);
});
test('Skill links validate new sources but preserve unchanged legacy references',async()=>{
  const api=moduleFor('lib/server/skill-source.ts',{zod,'@/lib/http':http});
  let reads=0;const db=status=>({from(){reads++;return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id:'source',status},error:null})};}});
  const id='00000000-0000-4000-8000-000000000001';
  await api.assertSkillSource(db('canonical'),'skill',{sourceDocumentId:id});assert.equal(reads,1);
  await assert.rejects(api.assertSkillSource(db('archived'),'skill',{sourceDocumentId:id}),error=>error.code==='SKILL_SOURCE_UNAVAILABLE');
  await assert.rejects(api.assertSkillSource(db('canonical'),'skill',{sourceDocumentId:'bad'}),error=>error.code==='INVALID_SKILL_SOURCE');
  const before=reads;await api.assertSkillSource(db('archived'),'skill',{sourceDocumentId:id},{sourceDocumentId:id});assert.equal(reads,before);
});

test('partial import failure retains exact item identity and retries only unfinished choices',async()=>{
  const items=[{id:'first',path:'note.md',action:'create'},{id:'second',path:'note.md',action:'create'},{id:'skip',action:'skip'}];
  const writes=[];const results=new Map();
  await importing.executeImports(items,async item=>{writes.push(item.id);if(item.id==='second')throw Error('Conflict');return{id:item.id};},(item,result)=>results.set(item.id,result));
  assert.equal(results.get('second').error,'Conflict');
  const retried=items.map(item=>({...item,done:!!results.get(item.id)?.value}));
  await importing.executeImports(retried,async item=>{writes.push(item.id);return{id:item.id};},()=>{});
  assert.deepEqual(writes,['first','second','second']);
});

test('version restore conflicts return 409 rather than implying the old version was restored',async()=>{
  const api=moduleFor('app/api/v1/documents/[id]/versions/route.ts',{'next/server':{NextResponse:Response},zod,'@/lib/http':http,'@/lib/supabase/server':{},'@/lib/server/auth':{authenticateRequest:async()=>({supabase:{rpc:async()=>({data:null,error:{message:'OS_VERSION_CONFLICT:4'}})}})}});
  const response=await api.POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({version:1,expectedVersion:3})}),{params:Promise.resolve({id:'test-document'})});
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,'VERSION_CONFLICT');
});

test('conflict rebasing retains deliberate edits and adopts newer untouched metadata',async()=>{
  const {rebaseKnowledgeDraft}=await import('../lib/knowledge-workspace-state.ts');
  const baseline={title:'Title',content:'Old',folder:'Library',team:'A',brand:'Brand',tags:'one'};
  const mine={...baseline,content:'My edit',tags:'one, two'};
  const latest={...baseline,content:'Their edit',folder:'Library/New',team:'B'};
  const merged=rebaseKnowledgeDraft(mine,baseline,latest);
  assert.equal(merged.content,'My edit');assert.equal(merged.folder,'Library/New');assert.equal(merged.team,'B');assert.equal(merged.tags,'one, two');
});

test('classification suggestions include actual folders, teams, brands and unique tags',async()=>{
  const {knowledgeFacets}=await import('../lib/knowledge-facets.ts');
  const result=knowledgeFacets([{folder:'A/B',team:'Team',brand:'Brand',tags:['one','two']},{folder:'',team:'Team',brand:'',tags:['two']}]);
  assert.deepEqual(result.teams,['Team']);assert.deepEqual(result.tags,['one','two']);assert.ok(result.folders.includes('분류 없음'));assert.deepEqual(result.brands,['Brand']);
});

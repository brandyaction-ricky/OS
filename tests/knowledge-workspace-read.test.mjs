import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import {emptyKnowledgeState} from '../lib/knowledge/model.ts';

class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function workspace({failureTable,code='57014',authenticated=true,documents=[],proposals=[]}={}) {
  const logs=[],calls=[],selects=[];
  const db={from(table){
    calls.push(table);
    let cursor='',from='',to='\uffff',start=0,end=499,lim=500,only=null,cols='*';
    const builder=new Proxy({}, {get:(_,key)=>{
      if(key==='then')return resolve=>resolve(table===failureTable?{data:null,error:{code,message:'private document SQL text'}}:{data:table==='os_documents'?(only?documents.filter(d=>only.includes(d.id)):documents.filter(d=>d.id>cursor&&d.id>=from&&d.id<to).slice(0,lim)):table==='os_document_proposals'?proposals.filter(p=>!only||only.includes(p.status)).map(p=>cols==='*'?p:Object.fromEntries(cols.split(',').map(c=>[c,p[c]]))).slice(start,end+1):[].slice(start,end+1),error:null});
      return (...args)=>{if(key==='select'){cols=args[0];selects.push([table,cols]);}if(key==='gt')cursor=args[1];if(key==='gte')from=args[1];if(key==='in')only=args[1];if(key==='lt')to=args[1];if(key==='limit')lim=args[0];if(key==='range')[start,end]=args;return builder;};
    }});return builder;
  },rpc:async()=>({data:null,error:{code,message:'private command SQL'}})};
  const modules={
    'next/server':{NextResponse:Response},zod,
    '@/lib/http':{ApiError,parseJson:r=>r.json(),apiErrorResponse:e=>Response.json({error:{code:e.code,message:e.message}},{status:e.status??500})},
    '@/lib/server/auth':{authenticateRequest:async()=>{if(!authenticated)throw new ApiError(401,'AUTH_REQUIRED','로그인 필요');return {ownerId:'synthetic-owner',supabase:db};}},
    '@/lib/supabase/server':{createServiceSupabase:()=>db},
    '@/lib/server/knowledge-access':{knowledgeAccessContext:async()=>({actor:{ownerId:'synthetic-owner'}})},
    '@/lib/server/document-proposals':{isDesignatedApprover:async()=>false},
    '@/lib/server/knowledge-page-access':{POLICY_FIELDS:'id,owner_id,status',readableKnowledgePages:async(_user,rows)=>new Set(rows.filter(d=>d.owner_id!=='hidden-owner').map(d=>d.id))},
    '@/lib/knowledge/default-templates':{DEFAULT_TEMPLATES:[]},
    '@/lib/knowledge/model':{emptyKnowledgeState},
    '@/lib/knowledge/meetings':{projectMeetings:()=>[]},
  };
  const exports={};
  const codeJS=ts.transpileModule(readFileSync(new URL('../app/api/v1/knowledge/workspace/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(codeJS,{exports,require:name=>{assert.ok(name in modules,name);return modules[name];},Response,console:{warn:(...args)=>logs.push(args)}});
  return {...exports,logs,calls,selects};
}
test('workspace GET returns retryable read errors, never saving errors or SQL contents',async()=>{
  for(const [table,stage] of [['os_documents','documents'],['os_doc_categories','categories'],['os_profiles','people']]){
    const api=workspace({failureTable:table}),response=await api.GET(new Request('http://localhost/api/v1/knowledge/workspace'));
    assert.equal(response.status,503);const body=await response.text();assert.match(body,/KNOWLEDGE_READ_FAILED/);assert.doesNotMatch(body,/저장|private document/);
    assert.equal(api.logs[0][1].stage,stage);assert.equal(api.logs[0][1].code,'57014');assert.doesNotMatch(JSON.stringify(api.logs),/private document/);
  }
});
test('workspace permission failures stay forbidden and auth runs before any database query',async()=>{
  const forbidden=workspace({failureTable:'os_documents',code:'42501'});
  assert.equal((await forbidden.GET(new Request('http://localhost'))).status,403);
  const signedOut=workspace({authenticated:false});assert.equal((await signedOut.GET(new Request('http://localhost'))).status,401);assert.deepEqual(signedOut.calls,[]);
  const unknown=workspace({failureTable:'os_documents',code:'private-id-or-token'});await unknown.GET(new Request('http://localhost'));assert.equal(unknown.logs[0][1].code,'UNKNOWN');
});
test('workspace keyset inventory returns every authorized page without body data',async()=>{
  const docs=Array.from({length:1105},(_,i)=>({id:`10000000-0000-0000-0000-${String(i).padStart(12,'0')}`,content_md:'private body',owner_id:i===1001?'hidden-owner':'synthetic-owner'}));
  const api=workspace({documents:docs}),response=await api.GET(new Request('http://localhost')),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.state.documents.length,1104);assert.equal(new Set(body.state.documents.map(d=>d.id)).size,1104);
  // Eight id ranges side by side: the range holding all 1,105 ids takes two pages, the seven empty ranges one read each.
  assert.ok(body.state.documents.every(d=>d.content_md===''));assert.equal(api.calls.filter(t=>t==='os_documents').length,9);
});
// 바뀐 것만 (2026-11-02): a browser that kept the list gets the documents written since and every visible id.
test('workspace since read returns only changed documents and the visible ids',async()=>{
  const at=(minutes)=>new Date(Date.parse('2026-11-02T10:00:00Z')+minutes*60_000).toISOString();
  const docs=[['10000000-0000-0000-0000-000000000001',-90,'synthetic-owner'],['10000000-0000-0000-0000-000000000002',-5,'synthetic-owner'],['10000000-0000-0000-0000-000000000003',-1,'hidden-owner']]
    .map(([id,minutes,owner])=>({id,updated_at:at(minutes),owner_id:owner,content_md:'private body'}));
  const api=workspace({documents:docs}),response=await api.GET(new Request(`http://localhost/api?since=${encodeURIComponent(at(-10))}`)),body=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(body.state.documents.map(d=>d.id),['10000000-0000-0000-0000-000000000002']);
  assert.ok(body.state.documents.every(d=>d.content_md===''));
  assert.deepEqual(body.delta.visibleIds,['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002']);
  assert.ok(Date.parse(body.syncedAt)<=Date.now()-29_000);
  // a full read carries no delta
  const full=await (await workspace({documents:docs}).GET(new Request('http://localhost'))).json();
  assert.equal(full.delta,undefined);assert.equal(full.state.documents.length,2);
});
// Decided proposals go out without their text, so their text is not read either (2026-11-03).
test('workspace reads proposal text only for open and returned proposals, newest first',async()=>{
  const doc='10000000-0000-0000-0000-000000000001';
  const proposal=(id,status,created_at)=>({id,document_id:doc,status,created_at,content_md:'private body',agent_key_id:null});
  const api=workspace({documents:[{id:doc,owner_id:'synthetic-owner'}],proposals:[proposal('p1','open','2026-11-02T10:00:00Z'),proposal('p2','approved','2026-11-01T10:00:00Z'),proposal('p3','withdrawn','2026-11-03T10:00:00Z'),proposal('p4','returned','2026-10-30T10:00:00Z')]});
  const body=await (await api.GET(new Request('http://localhost'))).json();
  assert.deepEqual(body.state.proposals.map(p=>[p.id,p.content_md,p.content_omitted===true]),[['p3','',true],['p1','private body',false],['p2','',true],['p4','private body',false]]);
  const reads=api.selects.filter(([table])=>table==='os_document_proposals').map(([,cols])=>cols);
  assert.equal(reads.length,2);assert.equal(reads[0],'*');assert.doesNotMatch(reads[1],/content_md|\*/);
});
test('workspace command failure contract remains unchanged',async()=>{
  const api=workspace(),response=await api.POST(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'document.create'})}));
  assert.equal(response.status,400);assert.equal((await response.json()).error.code,'KNOWLEDGE_COMMAND_FAILED');assert.deepEqual(api.logs,[]);
});

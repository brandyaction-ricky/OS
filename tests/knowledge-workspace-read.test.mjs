import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import {emptyKnowledgeState} from '../lib/knowledge/model.ts';

class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function workspace({failureTable,code='57014',authenticated=true,documents=[]}={}) {
  const logs=[],calls=[];
  const db={from(table){
    calls.push(table);
    let cursor='',start=0,end=499;
    const builder=new Proxy({}, {get:(_,key)=>{
      if(key==='then')return resolve=>resolve(table===failureTable?{data:null,error:{code,message:'private document SQL text'}}:{data:table==='os_documents'?documents.filter(d=>d.id>cursor).slice(0,500):[].slice(start,end+1),error:null});
      return (...args)=>{if(key==='gt')cursor=args[1];if(key==='range')[start,end]=args;return builder;};
    }});return builder;
  },rpc:async()=>({data:null,error:{code,message:'private command SQL'}})};
  const modules={
    'next/server':{NextResponse:Response},zod,
    '@/lib/http':{ApiError,parseJson:r=>r.json(),apiErrorResponse:e=>Response.json({error:{code:e.code,message:e.message}},{status:e.status??500})},
    '@/lib/server/auth':{authenticateRequest:async()=>{if(!authenticated)throw new ApiError(401,'AUTH_REQUIRED','로그인 필요');return {ownerId:'synthetic-owner',supabase:db};}},
    '@/lib/supabase/server':{createServiceSupabase:()=>db},
    '@/lib/server/knowledge-access':{knowledgeAccessContext:async()=>({actor:{ownerId:'synthetic-owner'}})},
    '@/lib/server/knowledge-page-access':{readableKnowledgePages:async(_user,rows)=>new Set(rows.filter(d=>d.owner_id!=='hidden-owner').map(d=>d.id))},
    '@/lib/knowledge/default-templates':{DEFAULT_TEMPLATES:[]},
    '@/lib/knowledge/model':{emptyKnowledgeState},
    '@/lib/knowledge/meetings':{projectMeetings:()=>[]},
  };
  const exports={};
  const codeJS=ts.transpileModule(readFileSync(new URL('../app/api/v1/knowledge/workspace/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(codeJS,{exports,require:name=>{assert.ok(name in modules,name);return modules[name];},Response,console:{warn:(...args)=>logs.push(args)}});
  return {...exports,logs,calls};
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
  assert.ok(body.state.documents.every(d=>d.content_md===''));assert.equal(api.calls.filter(t=>t==='os_documents').length,3);
});
test('workspace command failure contract remains unchanged',async()=>{
  const api=workspace(),response=await api.POST(new Request('http://localhost',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'document.create'})}));
  assert.equal(response.status,400);assert.equal((await response.json()).error.code,'KNOWLEDGE_COMMAND_FAILED');assert.deepEqual(api.logs,[]);
});

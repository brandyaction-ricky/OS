import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as search from '../lib/knowledge/search.ts';

const doc = (i, overrides = {}) => ({id:String(i).padStart(8,'0'),title:'찾기 '+i,content_md:'실제 **본문** '+i,status:'team',owner_id:'owner',source:'manual',updated_at:'2026-11-16T00:00:00Z',content_hash:'h'+i,...overrides});
async function fixture(rows, {hidden=[],failBodies=false}={}) {
  const bodyReads=[]; let checks=0;
  class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
  const db={from(table){assert.equal(table,'os_documents');let fields='',cursor='',ids=null,limit=Infinity;const predicates=[];
    const builder={
      select(value){fields=value;return builder;},neq(key,value){predicates.push(row=>row[key]!==value);return builder;},
      gt(key,value){cursor=value;return builder;},order(){return builder;},limit(n){limit=n;return builder;},in(key,values){ids=values;return builder;},
      then(done){const bodies=fields.includes('content_md');if(bodies)bodyReads.push(...ids);
        const data=rows.filter(row=>row.id>cursor&&predicates.every(p=>p(row))&&(!ids||ids.includes(row.id))).slice(0,limit)
          .map(row=>Object.fromEntries(fields.split(',').map(key=>[key,row[key]??null])));
        return done({data,error:bodies&&failBodies?{message:'offline'}:null});},
    };return builder;}};
  const modules={
    'next/server':{NextResponse:Response},'@/lib/http':{ApiError,apiErrorResponse:e=>Response.json({code:e.code},{status:e.status??500})},
    '@/lib/server/auth':{authenticateRequest:async()=>({type:'user',ownerId:'owner',supabase:db})},
    '@/lib/server/knowledge-page-access':{POLICY_FIELDS:'id,status,owner_id,source,meeting_record_id',readableKnowledgePages:async(_a,docs)=>{checks++;return new Set(docs.filter(d=>!hidden.includes(d.id)).map(d=>d.id));}},
    '@/lib/server/knowledge-access':{knowledgeAccessContext:async()=>({actor:{memberKind:'staff'}})},
    '@/lib/knowledge/search':search,
  };
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../app/api/v1/knowledge/search/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,require:name=>modules[name],URL,performance,Response});
  return {bodyReads,checks:()=>checks,run:async(params='')=>exports.GET(new Request('https://example.invalid/api?q='+encodeURIComponent('찾기')+params))};
}

test('title autocomplete reads six bodies among 2500 documents and preserves results, excerpts and total',async()=>{
  const rows=Array.from({length:2500},(_,i)=>doc(i+1));const f=await fixture(rows);
  const body=await (await f.run('&titleOnly=true')).json();
  const expected=search.searchWorkspace(rows,'찾기',{titleOnly:true});
  assert.deepEqual(body.results,expected.slice(0,6));assert.equal(body.total,2500);
  assert.equal(f.bodyReads.length,6);assert.equal(f.checks(),1);
  const second=await (await f.run('&titleOnly=true&offset=6')).json();
  assert.deepEqual(second.results,expected.slice(6,12));assert.equal(second.total,2500);
  assert.equal(f.bodyReads.length,12);
  await f.run('&titleOnly=true&offset=6');assert.equal(f.bodyReads.length,12,'unchanged bodies reuse fingerprints');
});

test('scope and denied documents are removed before body fetches; no hit needs no bodies',async()=>{
  const rows=[doc(1),doc(2,{status:'canonical'}),doc(3,{status:'canonical'}),doc(4,{status:'draft'}),doc(5,{source:'mcp'})];
  const f=await fixture(rows,{hidden:[rows[2].id]});
  const result=await(await f.run('&space=canon')).json();
  assert.deepEqual(result.results.map(r=>r.id),[rows[1].id]);assert.deepEqual(f.bodyReads,[rows[1].id]);
  const no=await fixture([doc(1,{title:'다른 제목'})]);
  assert.equal((await(await no.run('&titleOnly=true')).json()).total,0);assert.deepEqual(no.bodyReads,[]);
});

test('body-only hits remain available in normal search and errors do not masquerade as empty results',async()=>{
  const rows=[doc(1,{title:'다른 제목',content_md:'찾기 본문 일치'}),doc(2)];const f=await fixture(rows);
  assert.deepEqual((await(await f.run()).json()).results,search.searchWorkspace(rows,'찾기'));
  assert.equal(f.bodyReads.length,2);
  assert.equal((await(await fixture(rows,{failBodies:true})).run('&titleOnly=true')).status,503);
});

test('revoked access is checked again before cached text can be returned',async()=>{
  const rows=[doc(1)];const hidden=[];const f=await fixture(rows,{hidden});
  await f.run('&titleOnly=true');hidden.push(rows[0].id);
  const body=await(await f.run('&titleOnly=true')).json();assert.equal(body.total,0);assert.deepEqual(body.results,[]);assert.equal(f.bodyReads.length,1);
});

test('a changed fingerprint refreshes the excerpt',async()=>{
  const rows=[doc(1)];const f=await fixture(rows);await f.run('&titleOnly=true');
  rows[0].content_md='바뀐 본문';rows[0].content_hash='new';
  const body=await(await f.run('&titleOnly=true')).json();assert.equal(body.results[0].excerpt,'바뀐 본문');assert.equal(f.bodyReads.length,2);
});

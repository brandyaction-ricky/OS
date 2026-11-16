import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';

function fixture(code, action='meeting.review') {
  const calls=[],scheduled=[];
  class ApiError extends Error {constructor(status,key,message){super(message);this.status=status;this.code=key;}}
  const modules={
    'next/server':{NextResponse:Response,after:fn=>scheduled.push(fn)},zod:{z},
    '@/lib/http':{ApiError,parseJson:r=>r.json(),apiErrorResponse:e=>Response.json({error:{code:e.code}},{status:e.status??500})},
    '@/lib/server/auth':{authenticateRequest:async()=>({type:'user',role:'admin',id:'actor',supabase:{rpc:async(name,args)=>{calls.push({name,args});return code?{error:{code,message:'OS_VERSION_CONFLICT'}}:{data:{id:'meeting',version:5}};}}})},
    '@/lib/team/gate':{teamV1Enabled:()=>true},
    '@/lib/server/meeting-telegram':{shareConfirmedMeeting:()=>{throw new Error('No real sends in tests');}},
  };
  const exports={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/v1/team/command/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:name=>{assert.ok(name in modules,name);return modules[name];},Response,URL,console});
  return {calls,scheduled,run:()=>exports.POST(new Request('https://example.invalid/api/v1/team/command',{method:'POST',body:JSON.stringify({action,id:'11111111-1111-4111-8111-111111111111',expectedVersion:3})}))};
}
for(const action of ['meeting.save','meeting.finish','meeting.review','meeting.archive']) {
  test(`${action}: PT409 returns one conflict response without retry or notification`,async()=>{
    const f=fixture('PT409',action),r=await f.run();
    assert.equal(r.status,409);assert.equal((await r.json()).error.code,'VERSION_CONFLICT');
    assert.equal(f.calls.length,1);assert.equal(f.scheduled.length,0);
  });
}
test('successful confirmation retains the existing deferred notification contract',async()=>{
  const f=fixture(),r=await f.run();assert.equal(r.status,200);assert.equal((await r.json()).version,5);
  assert.equal(f.calls.length,1);assert.equal(f.scheduled.length,1); // callback deliberately never invoked
});

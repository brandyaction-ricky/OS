import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import {projectMeetings} from '../lib/knowledge/meetings.ts';
const id='00000000-0000-4000-8000-000000000001';
class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code}}
function setup({authenticated=true,role='member',memberKind='staff',attendee=true,status='active',legacy=false,visible=false,key=true,upstream=true}={}){
 const calls=[];
 const record={id,title:'Synthetic QA',description:'',status,version:1,owner_id:'owner',created_by:'owner',updated_at:'2026-10-12',metadata:{workspace:legacy?'team':'knowledge',visibility:visible?'team':'attendees',agenda:'',items:[]}};
 const db={from(){const query={select(){return query},eq(){return query},is(){return query},maybeSingle:async()=>({data:record,error:null}),then(resolve){resolve({data:attendee?[{meeting_id:id,user_id:'owner'}]:[],error:null})}};return query}};
 const modules={zod,'@/lib/http':{ApiError,apiErrorResponse:e=>Response.json({error:{code:e.code,message:e.message}},{status:e.status??500})},'@/lib/server/auth':{authenticateRequest:async()=>{if(!authenticated)throw new ApiError(401,'AUTH_REQUIRED','Login');return {ownerId:'owner',supabase:db}}},'@/lib/server/knowledge-access':{knowledgeAccessContext:async()=>({actor:{ownerId:'owner',type:'user',active:true,role,memberKind}})},'@/lib/knowledge/meetings':{projectMeetings}};
 const source=readFileSync(new URL('../app/api/v1/knowledge/meetings/[id]/live-transcription/route.ts',import.meta.url),'utf8');const exports={};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(name in modules,name);return modules[name]},Response,Buffer,FormData,AbortSignal,process:{env:{OPENAI_API_KEY:key?'synthetic-test-key':''}},fetch:async(url,options)=>{calls.push({url,options});return new Response(upstream?'v=0\r\nm=audio':'private upstream diagnostic',{status:upstream?200:400})}});
 return {calls,post:(body='v=0\r\nm=audio',type='application/sdp')=>exports.POST(new Request('http://localhost/test',{method:'POST',headers:{'Content-Type':type},body}),{params:Promise.resolve({id})})};
}

test('live transcription uses server-only credential and fixed Korean transcription-only session',async()=>{
 const s=setup();const response=await s.post();assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('Content-Type'),'application/sdp');
 assert.equal(await response.text(),'v=0\r\nm=audio');assert.equal(s.calls.length,1);const {url,options}=s.calls[0];assert.equal(url,'https://api.openai.com/v1/realtime/calls');
 const config=JSON.parse(options.body.get('session'));assert.equal(config.type,'transcription');assert.equal(config.audio.input.transcription.language,'ko');assert.equal(config.audio.input.transcription.model,'gpt-4o-mini-transcribe');assert.equal(config.audio.input.turn_detection.type,'server_vad');assert.equal(options.body.get('sdp'),'v=0\r\nm=audio');
});
test('no upstream request for signed-out, nonattendee, private partner, closed or legacy meetings',async()=>{
 for(const [settings,status]of [[{authenticated:false},401],[{attendee:false,visible:true},403],[{attendee:false,memberKind:'partner',role:'admin'},403],[{status:'done'},403],[{legacy:true},403],[{key:false},503]]){
  const s=setup(settings);assert.equal((await s.post()).status,status,JSON.stringify(settings));assert.equal(s.calls.length,0);
 }
});
test('SDP body and content type are bounded before OpenAI, and upstream errors do not leak diagnostics',async()=>{
 for(const [body,type,status]of [['invalid','application/sdp',400],['v=0','application/json',415],['v=0\r\nm=audio'+ 'x'.repeat(64000),'application/sdp',413]]){const s=setup();assert.equal((await s.post(body,type)).status,status);assert.equal(s.calls.length,0)}
 const s=setup({upstream:false});const response=await s.post();assert.equal(response.status,502);assert.ok(!(await response.text()).includes('private upstream diagnostic'));
});
